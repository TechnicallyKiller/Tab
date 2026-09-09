/**
 * Reading the settlements topic.
 *
 * The gateway has had `TOPIC_SETTLEMENTS` in its environment since the first
 * commit and never opened it. That was not an oversight to be embarrassed by —
 * the spend path genuinely does not need it, since `position()` derives the
 * balance from receipts and a settlement only collapses receipts that are
 * already counted. Reading it here is READ-ONLY and for the console.
 *
 * Which matters, because it is exactly the mistake that paid a window twice:
 * the settlement worker replayed only the receipts topic, so a window it had
 * already settled looked unsettled and it scheduled a second transfer. The
 * lesson was not "read more topics in the hot path" — it was that any component
 * making a claim about a window must read the topic where that claim is
 * recorded. The gateway makes no such claim, so this stays out of `spend`.
 */
import { type Entry, entriesFromMessages } from '@tab/ledger'
import { type MirrorClient, readTopic, reassembleChunks } from '@tab/mirror'

export type SettlementEntry = Extract<Entry, { kind: 'settlement' }>

export interface SettlementReplay {
  /** Settlements per tab, ascending by window. */
  byTab: Map<string, SettlementEntry[]>
  read: number
}

/**
 * Replay the settlements topic.
 *
 * Uses `entriesFromMessages` — the same decode every other reader uses. A
 * private copy here would be the fourth, and the previous three each lost a
 * message type: holds on gateway restart, settlements in the worker, and the
 * `weightUpdate` the console could not see.
 *
 * Ordered by WINDOW, not by consensus timestamp. A repaired or late settlement
 * lands on the topic after the windows that follow it, and a table sorted by
 * arrival would show window 41 above window 39 with no explanation. Ties break
 * on the timestamp so a double settlement — which has happened — still shows
 * both rows in the order they were written rather than collapsing to one.
 */
export async function replaySettlements(
  mirror: MirrorClient,
  topicId: string,
): Promise<SettlementReplay> {
  const walk = await readTopic(mirror, { topicId })
  const { assembled } = reassembleChunks(walk.items)
  const replay = entriesFromMessages(assembled)

  const byTab = new Map<string, SettlementEntry[]>()
  for (const [tab, entries] of replay.byTab) {
    const settlements = entries.filter((e): e is SettlementEntry => e.kind === 'settlement')
    if (settlements.length === 0) continue
    byTab.set(
      tab,
      [...settlements].sort(
        (a, b) => a.window - b.window || (a.at < b.at ? -1 : a.at > b.at ? 1 : 0),
      ),
    )
  }
  return { byTab, read: assembled.length }
}
