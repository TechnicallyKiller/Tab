import {
  canReserve,
  type Entry,
  entriesFromMessages,
  type HoldView,
  type Position,
  position,
  type ReserveDecision,
  resolveHolds,
} from '@tab/ledger'
import { type MirrorClient, readTopic, reassembleChunks } from '@tab/mirror'
import { format, type MicroUsdc } from '@tab/money'

/**
 * In-memory ledger state, rebuilt from HCS on boot.
 *
 * There is no `@tab/db` or `@tab/cache` yet, and this is not a stopgap that
 * quietly becomes the design: HCS is the source of truth, so an in-memory
 * projection is exactly what the database will also be (ADR-0007). Restart the
 * gateway and it replays the receipt topic to the same position.
 *
 * What this loses versus Redis, stated plainly: holds live only in this
 * process, so two gateway instances would each allow up to the ceiling.
 * SINGLE INSTANCE ONLY until `@tab/cache` lands. Probe 5 explains why that hop
 * cannot be optimised away — a hold reserve must be atomic across instances.
 */
export interface RebuildResult {
  replayed: number
  skipped: number
  tabs: number
}

export class LedgerState {
  /** Entries per tab. A projection, rebuildable from HCS at any time. */
  private readonly byTab = new Map<string, Entry[]>()
  private readonly ceilings = new Map<string, MicroUsdc>()
  private readonly defaultCeiling: MicroUsdc

  constructor(defaultCeiling: MicroUsdc) {
    this.defaultCeiling = defaultCeiling
  }

  /**
   * Rebuild the projection from HCS.
   *
   * Uses `entriesFromMessages` from `@tab/ledger` — the SAME decode the
   * settlement worker, the engine and `tools/verify` use. This file had its own
   * copy (`toEntry`), and the copy had no `case 'hold'`, so **published holds
   * were silently dropped on every restart.** A pending hold vanished from the
   * projection, `available` came back overstated, and the agent could spend
   * headroom that was actually reserved — a double-spend window that opened
   * exactly when the gateway bounced.
   *
   * That is the third message type to go missing from a private replay copy,
   * after settlements in the worker. The lesson is now enforced structurally:
   * there is one decode, and it lives in the package every reader shares.
   */
  async rebuild(mirror: MirrorClient, topicId: string): Promise<RebuildResult> {
    const walk = await readTopic(mirror, { topicId })
    const { assembled } = reassembleChunks(walk.items)

    this.byTab.clear()
    const replay = entriesFromMessages(assembled)
    for (const [tab, entries] of replay.byTab) {
      // Already in consensus order from the shared decode.
      this.byTab.set(tab, [...entries])
    }

    return { replayed: replay.replayed, skipped: replay.skipped, tabs: this.byTab.size }
  }

  push(tab: string, entry: Entry): void {
    const list = this.byTab.get(tab)
    if (list) list.push(entry)
    else this.byTab.set(tab, [entry])
  }

  entriesFor(tab: string): readonly Entry[] {
    return this.byTab.get(tab) ?? []
  }

  tabs(): string[] {
    return [...this.byTab.keys()]
  }

  ceilingFor(tab: string): MicroUsdc {
    return this.ceilings.get(tab) ?? this.defaultCeiling
  }

  setCeiling(tab: string, ceiling: MicroUsdc): void {
    this.ceilings.set(tab, ceiling)
  }

  position(tab: string, now: string): Position {
    return position(this.entriesFor(tab), this.ceilingFor(tab), now)
  }

  holds(tab: string, now: string): HoldView[] {
    return resolveHolds(this.entriesFor(tab), now)
  }

  canSpend(tab: string, price: MicroUsdc, now: string): ReserveDecision {
    return canReserve(this.position(tab, now), price)
  }

  describe(tab: string, now: string): string {
    const p = this.position(tab, now)
    return (
      `balance ${format(p.balance)} · outstanding ${format(p.outstanding)} · ` +
      `holds ${format(p.holds)} · available ${format(p.available)} · ceiling ${format(p.ceiling)}`
    )
  }
}

/**
 * Turn a published message back into a ledger entry.
 *
 * Ceiling and settlement messages are not ledger entries — the caller applies
 * those separately — so they return null rather than being forced into shape.
 */
