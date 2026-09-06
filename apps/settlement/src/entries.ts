import { inConsensusOrder, type Entry } from '@tab/ledger'
import { usdc } from '@tab/money'
import { decode } from '@tab/protocol'
import { decodeUtf8, readTopic, reassembleChunks, type MirrorClient } from '@tab/mirror'

/**
 * Rebuild ledger entries from the receipt topic.
 *
 * The settlement worker never trusts the gateway's memory. It replays HCS, the
 * same way a stranger running `verify-tab` would — so a settlement is computed
 * from the public record rather than from our own process state. If those two
 * ever disagreed, the public record is the one that counts.
 */
export interface Replay {
  byTab: Map<string, Entry[]>
  replayed: number
  skipped: number
}

export async function replayEntries(mirror: MirrorClient, topicId: string): Promise<Replay> {
  const walk = await readTopic(mirror, { topicId })
  const { assembled } = reassembleChunks(walk.items)

  const byTab = new Map<string, Entry[]>()
  let replayed = 0
  let skipped = 0

  for (const message of assembled) {
    const result = decode(decodeUtf8(message.payload))
    if (!result.ok) {
      skipped++
      continue
    }
    const msg = result.message
    let entry: Entry | null = null

    switch (msg.t) {
      case 'debit':
        entry = {
          kind: 'debit', at: message.consensusTimestamp, window: msg.w, holdId: msg.hold,
          counterparty: msg.cp, amount: usdc(msg.amt), transactionId: msg.tx,
        }
        break
      case 'credit':
        entry = {
          kind: 'credit', at: message.consensusTimestamp, window: msg.w,
          counterparty: msg.cp, amount: usdc(msg.amt), attested: msg.att, transactionId: msg.tx,
        }
        break
      case 'refused':
        entry = {
          kind: 'refusal', at: message.consensusTimestamp, window: msg.w,
          counterparty: msg.cp, requested: usdc(msg.amt), rule: msg.rule,
        }
        break
      case 'repair':
        entry = {
          kind: 'repair', at: message.consensusTimestamp, window: msg.w,
          counterparty: msg.cp, amount: usdc(msg.amt), transactionId: msg.tx, reason: msg.why,
        }
        break
      case 'settlement':
        entry = {
          kind: 'settlement', at: message.consensusTimestamp, window: msg.w,
          net: usdc(msg.net), outcome: msg.outcome,
          ...(msg.tx ? { transactionId: msg.tx } : {}),
        }
        break
      default:
        continue
    }

    const list = byTab.get(msg.tab)
    if (list) list.push(entry)
    else byTab.set(msg.tab, [entry])
    replayed++
  }

  for (const [tab, entries] of byTab) byTab.set(tab, inConsensusOrder(entries))
  return { byTab, replayed, skipped }
}

/** Windows that have receipts but no settlement message yet. */
export function unsettledWindows(entries: readonly Entry[], currentWindow: number): number[] {
  const settled = new Set(entries.filter((e) => e.kind === 'settlement').map((e) => e.window))
  const seen = new Set(
    entries
      .filter((e) => e.kind === 'debit' || e.kind === 'credit' || e.kind === 'interest' || e.kind === 'repair')
      .map((e) => e.window),
  )
  // Never settle the window still in progress — receipts are still arriving.
  return [...seen].filter((w) => !settled.has(w) && w < currentWindow).sort((a, b) => a - b)
}
