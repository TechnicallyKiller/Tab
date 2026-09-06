import {
  canReserve, inConsensusOrder, position, resolveHolds,
  type Entry, type HoldView, type Position, type ReserveDecision,
} from '@tab/ledger'
import { format, usdc, type MicroUsdc } from '@tab/money'
import { decode, type TabMessage } from '@tab/protocol'
import { decodeUtf8, readTopic, reassembleChunks, type MirrorClient } from '@tab/mirror'

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

  async rebuild(mirror: MirrorClient, topicId: string): Promise<RebuildResult> {
    const walk = await readTopic(mirror, { topicId })
    const { assembled } = reassembleChunks(walk.items)

    this.byTab.clear()
    let replayed = 0
    let skipped = 0

    for (const message of assembled) {
      const result = decode(decodeUtf8(message.payload))
      if (!result.ok) {
        // A bootstrap.hello from before the schema existed, or a future
        // version. One unrecognised message must not abort the reconstruction
        // of everything after it.
        skipped++
        continue
      }
      const entry = toEntry(result.message, message.consensusTimestamp)
      if (!entry) continue
      this.push(result.message.tab, entry)
      replayed++
    }

    for (const [tab, entries] of this.byTab) {
      this.byTab.set(tab, inConsensusOrder(entries))
    }
    return { replayed, skipped, tabs: this.byTab.size }
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
export function toEntry(message: TabMessage, at: string): Entry | null {
  const window = message.w
  switch (message.t) {
    case 'debit':
      return {
        kind: 'debit', at, window, holdId: message.hold,
        counterparty: message.cp, amount: usdc(message.amt), transactionId: message.tx,
      }
    case 'credit':
      return {
        kind: 'credit', at, window, counterparty: message.cp,
        amount: usdc(message.amt), attested: message.att, transactionId: message.tx,
      }
    case 'refused':
      return {
        kind: 'refusal', at, window, counterparty: message.cp,
        requested: usdc(message.amt), rule: message.rule,
      }
    case 'repair':
      return {
        kind: 'repair', at, window, counterparty: message.cp,
        amount: usdc(message.amt), transactionId: message.tx, reason: message.why,
      }
    default:
      return null
  }
}
