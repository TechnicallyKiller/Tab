import { usdc, type MicroUsdc } from '@tab/money'
import { decode, type CeilingUpdate, type WeightReason } from '@tab/protocol'
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
  /** Consensus-assigned and monotonic. Carried onto the entry for auditing. */
  sequenceNumber?: number
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

    /*
     * Audit fields, extracted ONCE and typed.
     *
     * Spread inline per case, TypeScript could not narrow `msg.req` across
     * message types that lack it and inferred `{}` — which then failed to
     * satisfy `Entry`. Pulling them out here types them properly and keeps the
     * cases readable.
     */
    const audit: { seq?: number; requestHash?: string; token?: string } = {
      ...(message.sequenceNumber !== undefined ? { seq: message.sequenceNumber } : {}),
      ...('req' in msg && typeof msg.req === 'string' ? { requestHash: msg.req } : {}),
      ...(msg.tok ? { token: msg.tok } : {}),
    }

    let entry: Entry | null = null

    switch (msg.t) {
      case 'hold':
        entry = {
          kind: 'hold', at: message.consensusTimestamp, window: msg.w, ...audit, holdId: msg.hold,
          counterparty: msg.cp, amount: usdc(msg.amt), expiresAt: msg.exp,
        }
        break
      case 'debit':
        entry = {
          kind: 'debit', at: message.consensusTimestamp, window: msg.w, ...audit, holdId: msg.hold,
          counterparty: msg.cp, amount: usdc(msg.amt), transactionId: msg.tx,
        }
        break
      case 'credit':
        entry = {
          kind: 'credit', at: message.consensusTimestamp, window: msg.w, ...audit,
          counterparty: msg.cp, amount: usdc(msg.amt), attested: msg.att, transactionId: msg.tx,
        }
        break
      case 'refused':
        entry = {
          kind: 'refusal', at: message.consensusTimestamp, window: msg.w, ...audit,
          counterparty: msg.cp, requested: usdc(msg.amt), rule: msg.rule,
        }
        break
      case 'repair':
        entry = {
          kind: 'repair', at: message.consensusTimestamp, window: msg.w, ...audit,
          counterparty: msg.cp, amount: usdc(msg.amt), transactionId: msg.tx, reason: msg.why,
        }
        break
      case 'settlement':
        entry = {
          kind: 'settlement', at: message.consensusTimestamp, window: msg.w, ...audit,
          net: usdc(msg.net), outcome: msg.outcome,
          rampFromBp: msg.rampFrom, rampToBp: msg.rampTo,
          // The gross legs, so a reader can see the netting rather than only
          // its result. Required by the schema, so always present here — the
          // entry types them optional for messages written before they were.
          credits: usdc(msg.credits), debits: usdc(msg.debits),
          interest: usdc(msg.interest), receiptCount: msg.n,
          outstanding: usdc(msg.outstanding),
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

/**
 * The published inputs a ceiling was computed from.
 *
 * Carried through verbatim in TYPE but not in SHAPE: `tools/verify` keeps its
 * own untyped reader precisely because it must rehash the object with its key
 * order intact, and a typed round-trip through this interface could reorder
 * keys. This copy is for READING — showing an operator the arithmetic — and
 * must never be rehashed.
 */
export interface PublishedCeilingInputs {
  /** Trailing revenue, and the split that makes the unattested discount auditable. */
  rev: MicroUsdc
  revAttested: MicroUsdc
  revUnattested: MicroUsdc
  tier: 'A' | 'B' | 'C' | 'Unrated'
  /** Tier multiple, basis points. 10000 = 1.0x. */
  multBp: number
  /** Ramp factor, basis points. */
  rampBp: number
  cap: MicroUsdc
  floor: MicroUsdc
  /** Has this tab ever missed a settlement? Absent on older messages = false. */
  defaulted: boolean
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
  /**
   * The numbers behind the decision.
   *
   * Published on the message itself, so a console can show the calculation
   * rather than only its result — a ceiling of `0.0000` with no arithmetic
   * beside it reads as a bug, and the whole claim of this rail is that a
   * refusal is explainable from the public record.
   */
  inputs: PublishedCeilingInputs
  /** HCS sequence number, the thing to cite in an audit. */
  seq?: number
}

/**
 * One ceiling message → a snapshot. Shared by both readers below.
 *
 * `def` is normalised to a boolean here rather than left optional. It is absent
 * on ceilings published before the field existed, and absent means false —
 * making that explicit at the decode boundary stops every downstream reader
 * from having to remember which of `undefined` and `false` it is looking at.
 * The distinction matters: a tab with no history and a tab that DEFAULTED both
 * read as Unrated, and only this flag separates "gets the starter floor" from
 * "gets exactly zero".
 */
function publishedCeiling(msg: CeilingUpdate, message: TopicMessage): PublishedCeiling {
  return {
    tab: msg.tab,
    ceiling: usdc(msg.ceil),
    ...(msg.computed ? { computed: usdc(msg.computed) } : {}),
    window: msg.w,
    binding: msg.bind,
    cause: msg.cause,
    at: message.consensusTimestamp,
    model: msg.model,
    hash: msg.hash,
    inputs: {
      rev: usdc(msg.inputs.rev),
      revAttested: usdc(msg.inputs.revAtt),
      revUnattested: usdc(msg.inputs.revUnatt),
      tier: msg.inputs.tier,
      multBp: msg.inputs.mult,
      rampBp: msg.inputs.ramp,
      cap: usdc(msg.inputs.cap),
      floor: usdc(msg.inputs.floor),
      defaulted: msg.inputs.def ?? false,
    },
    ...(message.sequenceNumber !== undefined ? { seq: message.sequenceNumber } : {}),
  }
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
    const snapshot = publishedCeiling(msg, message)
    const existing = byTab.get(msg.tab)
    if (!existing || snapshot.at > existing.at) byTab.set(msg.tab, snapshot)
  }
  return byTab
}

/**
 * Every ceiling ever published for a tab, in consensus order.
 *
 * A second function rather than a flag on `ceilingsFromMessages`, because the
 * two have genuinely different failure modes: the gateway wants ONE ceiling and
 * must be wrong deterministically if two engines published, while the console
 * wants the whole series and should show both. Collapsing them behind a
 * parameter would let a caller pass the wrong one and get a plausible answer.
 */
export function ceilingHistoryFromMessages(
  messages: readonly TopicMessage[],
): Map<string, PublishedCeiling[]> {
  const byTab = new Map<string, PublishedCeiling[]>()
  for (const message of messages) {
    const result = decode(utf8.decode(message.payload))
    if (!result.ok || result.message.t !== 'ceiling') continue
    const snapshot = publishedCeiling(result.message, message)
    const list = byTab.get(snapshot.tab)
    if (list) list.push(snapshot)
    else byTab.set(snapshot.tab, [snapshot])
  }
  // Ascending, so the last element is the one in force and a chart reads
  // left to right. Sorted on the consensus timestamp string, which is
  // lexicographically ordered because the nanos field is zero-padded.
  for (const [tab, list] of byTab) {
    byTab.set(tab, [...list].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)))
  }
  return byTab
}

/** One counterparty's published independence weight. */
export interface PublishedWeight {
  tab: string
  counterparty: string
  /** Basis points. 10000 counts in full, 0 blocks. */
  bp: number
  reasons: readonly WeightReason[]
  blocking: boolean
  revenue: MicroUsdc
  /** Share of total revenue, basis points. */
  shareBp: number
  window: number
  at: string
  token?: string
}

/**
 * Latest published weight per counterparty.
 *
 * "Latest" by consensus timestamp, so a re-weighting in a later window
 * supersedes an earlier one — the console should show what the engine currently
 * believes, not a history. `verify-tab` is where history belongs.
 *
 * Shared here rather than written twice, for the same reason
 * `ceilingsFromMessages` is: the gateway serves these and the engine could read
 * them back, and a private copy of a shared decode has already lost a message
 * type three times in this project.
 */
export function weightsFromMessages(
  messages: readonly TopicMessage[],
): Map<string, PublishedWeight> {
  const byCounterparty = new Map<string, PublishedWeight>()
  for (const message of messages) {
    const result = decode(utf8.decode(message.payload))
    if (!result.ok || result.message.t !== 'weight') continue
    const msg = result.message
    const row: PublishedWeight = {
      tab: msg.tab,
      counterparty: msg.cp,
      bp: msg.bp,
      reasons: msg.why,
      blocking: msg.block,
      revenue: usdc(msg.rev),
      shareBp: msg.share,
      window: msg.w,
      at: message.consensusTimestamp,
      ...(msg.tok ? { token: msg.tok } : {}),
    }
    const existing = byCounterparty.get(msg.cp)
    if (!existing || row.at > existing.at) byCounterparty.set(msg.cp, row)
  }
  return byCounterparty
}
