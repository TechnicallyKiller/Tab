import { usdc, type MicroUsdc } from '@tab/money'
import { decode } from '@tab/protocol'
import { inConsensusOrder, type Entry } from './entries.ts'

/**
 * HCS messages → ledger entries.
 *
 * Pure, and here rather than in an app for a reason that bit us: the settlement
 * worker and the engine both need it, and `apps/engine` importing
 * `apps/settlement/src/entries.ts` is a cross-app dependency that
 * `boundaries.json` rightly refuses. Two apps needing the same logic means the
 * logic belongs in a package, not that the boundary is inconvenient.
 *
 * The FETCH stays in each app, because `@tab/ledger` may not import
 * `@tab/mirror` — a five-line `readTopic` call duplicated twice is a much
 * smaller cost than a pure accounting package that can make network requests.
 */

/** What a caller must supply, after reassembling any chunked messages. */
export interface TopicMessage {
  payload: Uint8Array
  consensusTimestamp: string
}

export interface Replay {
  byTab: Map<string, Entry[]>
  replayed: number
  /** Messages that did not decode — a pre-schema write, or another producer. */
  skipped: number
}

const utf8 = new TextDecoder()

/**
 * Never throws.
 *
 * A topic is append-only and shared: one malformed or pre-schema message must
 * not stop a replay, or a single bad write from months ago permanently bricks
 * every worker that reads the topic. Undecodable messages are counted and
 * reported instead.
 */
export function entriesFromMessages(messages: readonly TopicMessage[]): Replay {
  const byTab = new Map<string, Entry[]>()
  let replayed = 0
  let skipped = 0

  for (const message of messages) {
    const result = decode(utf8.decode(message.payload))
    if (!result.ok) {
      skipped++
      continue
    }
    const msg = result.message
    let entry: Entry | null = null

    switch (msg.t) {
      case 'hold':
        entry = {
          kind: 'hold', at: message.consensusTimestamp, window: msg.w, holdId: msg.hold,
          counterparty: msg.cp, amount: usdc(msg.amt), expiresAt: msg.exp,
        }
        break
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
          rampFromBp: msg.rampFrom, rampToBp: msg.rampTo,
          ...(msg.tx ? { transactionId: msg.tx } : {}),
        }
        break
      default:
        // A ceiling or registration message on the receipt topic is not an
        // entry. Not a failure — just not ours.
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

/** The ceiling in force for a tab, as published. */
export interface PublishedCeiling {
  tab: string
  ceiling: MicroUsdc
  /** The formula's result, when the asymmetry rule held a growth back. */
  computed?: MicroUsdc
  window: number
  binding: string
  cause: string
  at: string
  model: string
  hash: string
}

/**
 * Latest published ceiling per tab.
 *
 * Here rather than in an app because THREE readers wanted it — the gateway
 * enforces it, the engine seeds its asymmetry state from it, and a fourth
 * (`tools/verify`) deliberately does not use this one, because it needs the
 * `inputs` object VERBATIM to rehash and a typed round-trip would risk
 * changing key order. That difference is real, so verify keeps its own reader.
 *
 * "Latest" by consensus timestamp, strictly later only. An equal timestamp
 * cannot occur on one topic, and treating "not earlier" as "later" would let a
 * re-read flip between two messages depending on page boundaries.
 */
export function ceilingsFromMessages(
  messages: readonly TopicMessage[],
): Map<string, PublishedCeiling> {
  const byTab = new Map<string, PublishedCeiling>()
  for (const message of messages) {
    const result = decode(utf8.decode(message.payload))
    if (!result.ok || result.message.t !== 'ceiling') continue
    const msg = result.message
    const snapshot: PublishedCeiling = {
      tab: msg.tab,
      ceiling: usdc(msg.ceil),
      ...(msg.computed ? { computed: usdc(msg.computed) } : {}),
      window: msg.w,
      binding: msg.bind,
      cause: msg.cause,
      at: message.consensusTimestamp,
      model: msg.model,
      hash: msg.hash,
    }
    const existing = byTab.get(msg.tab)
    if (!existing || snapshot.at > existing.at) byTab.set(msg.tab, snapshot)
  }
  return byTab
}
