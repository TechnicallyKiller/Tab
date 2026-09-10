import { type MicroUsdc, usdc } from '@tab/money'
import { type CeilingUpdate, decode, type WeightReason } from '@tab/protocol'
import { type Entry, inConsensusOrder } from './entries.ts'

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
          kind: 'hold',
          at: message.consensusTimestamp,
          window: msg.w,
          ...audit,
          holdId: msg.hold,
          counterparty: msg.cp,
          amount: usdc(msg.amt),
          expiresAt: msg.exp,
        }
        break
      case 'debit':
        entry = {
          kind: 'debit',
          at: message.consensusTimestamp,
          window: msg.w,
          ...audit,
          holdId: msg.hold,
          counterparty: msg.cp,
          amount: usdc(msg.amt),
          transactionId: msg.tx,
        }
        break
      case 'credit':
        entry = {
          kind: 'credit',
          at: message.consensusTimestamp,
          window: msg.w,
          ...audit,
          counterparty: msg.cp,
          amount: usdc(msg.amt),
          attested: msg.att,
          transactionId: msg.tx,
        }
        break
      case 'refused':
        entry = {
          kind: 'refusal',
          at: message.consensusTimestamp,
          window: msg.w,
          ...audit,
          counterparty: msg.cp,
          requested: usdc(msg.amt),
          rule: msg.rule,
        }
        break
      case 'repair':
        entry = {
          kind: 'repair',
          at: message.consensusTimestamp,
          window: msg.w,
          ...audit,
          counterparty: msg.cp,
          amount: usdc(msg.amt),
          transactionId: msg.tx,
          reason: msg.why,
        }
        break
      case 'settlement':
        entry = {
          kind: 'settlement',
          at: message.consensusTimestamp,
          window: msg.w,
          ...audit,
          net: usdc(msg.net),
          outcome: msg.outcome,
          rampFromBp: msg.rampFrom,
          rampToBp: msg.rampTo,
          // The gross legs, so a reader can see the netting rather than only
          // its result. Required by the schema, so always present here — the
          // entry types them optional for messages written before they were.
          credits: usdc(msg.credits),
          debits: usdc(msg.debits),
          interest: usdc(msg.interest),
          receiptCount: msg.n,
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
    byTab.set(
      tab,
      [...list].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)),
    )
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

/* ── graph facts ─────────────────────────────────────────────────────────── */

/**
 * One account's remembered graph facts.
 *
 * Shaped to drop straight into `@tab/graph`'s `AccountFacts`. `fundedBy` is an
 * array there because the graph walks chains; a published fact carries at most
 * one funder, so this holds one and the caller builds the chain by looking each
 * funder up in turn.
 */
export interface RememberedFacts {
  account: string
  createdAt?: string
  funder?: string
  /** Consensus timestamp of the message that first established the funder. */
  funderSeenAt?: string
  /** Sequence number of that message — the thing to cite. */
  funderSeq?: number
}

/**
 * Replay published graph facts, MERGING rather than replacing.
 *
 * This function is the whole point of publishing facts, and the merge is the
 * load-bearing line. The naive reader — keep the newest message per account —
 * would reintroduce the exact bug this closes: a Mirror Node outage publishes a
 * fact with no funder, that message is newest, and a funding edge correctly
 * observed a week ago is erased. One outage would un-catch the loop attacker
 * through the very mechanism meant to catch it.
 *
 * So a funder is **sticky**: once observed, later silence cannot remove it.
 * Absence in a message means "not observed", never "has no funder" — an account
 * created by nothing is not a thing on Hedera.
 *
 * ## What this deliberately does NOT do
 *
 * It never lets a later message CHANGE a known funder to a different one. An
 * account has exactly one creating payer, forever; two different answers means
 * one of them is wrong, and silently taking the newer would let a bad or
 * malicious publisher rewrite history. The first observation wins and the
 * conflict is reported, so a caller can surface it rather than absorb it.
 */
export interface FactsReplay {
  byAccount: Map<string, RememberedFacts>
  read: number
  /**
   * Accounts where two messages claimed DIFFERENT funders.
   *
   * Never expected — an account has one creating payer — so a non-empty list
   * means either a bug in whatever published, or someone writing to the topic
   * who should not be. Reported rather than resolved.
   */
  conflicts: { account: string; kept: string; rejected: string }[]
}

export function factsFromMessages(messages: readonly TopicMessage[]): FactsReplay {
  const byAccount = new Map<string, RememberedFacts>()
  const conflicts: FactsReplay['conflicts'] = []
  let read = 0

  for (const message of messages) {
    const result = decode(utf8.decode(message.payload))
    if (!result.ok || result.message.t !== 'fact') continue
    const msg = result.message
    read++

    const existing = byAccount.get(msg.acct)
    if (!existing) {
      byAccount.set(msg.acct, {
        account: msg.acct,
        ...(msg.born ? { createdAt: msg.born } : {}),
        ...(msg.by
          ? {
              funder: msg.by,
              funderSeenAt: message.consensusTimestamp,
              ...(message.sequenceNumber !== undefined
                ? { funderSeq: message.sequenceNumber }
                : {}),
            }
          : {}),
      })
      continue
    }

    // A creation time is immutable too, but harmless to fill in later — an
    // earlier pass may have had the funder and not the birth, or the reverse.
    if (existing.createdAt === undefined && msg.born) existing.createdAt = msg.born

    if (!msg.by) continue

    if (existing.funder === undefined) {
      existing.funder = msg.by
      existing.funderSeenAt = message.consensusTimestamp
      if (message.sequenceNumber !== undefined) existing.funderSeq = message.sequenceNumber
      continue
    }

    if (existing.funder !== msg.by) {
      // First observation wins. See the doc comment: taking the newer would let
      // a later writer rewrite an account's origin.
      conflicts.push({ account: msg.acct, kept: existing.funder, rejected: msg.by })
    }
  }

  return { byAccount, read, conflicts }
}

/* ── registrations ───────────────────────────────────────────────────────── */

/** One tab's claim on a funding root — the Starter Tab grant. */
export interface Registration {
  tab: string
  /** The agent's HCS-14 identifier, when the registration carried one. */
  uaid?: string
  /** The funding root this tab claimed. Absent on a rootless registration. */
  root?: string
  ceiling: MicroUsdc
  perCall: MicroUsdc
  allowlist: readonly string[]
  at: string
  seq?: number
}

export interface RegistrationReplay {
  /** By funding root. FIRST claim wins, forever. */
  byRoot: Map<string, Registration>
  /** By tab, so a tab can be asked what it holds. */
  byTab: Map<string, Registration>
  read: number
}

/**
 * Replay registrations. **First claim on a root wins, permanently.**
 *
 * This is the rule that makes bulk-minting pointless: one Starter Tab per
 * funding root, so a hundred agents minted from one wallet yield one starter
 * grant rather than a hundred. It was the last unenforced claim in the README
 * and the first thing a sharp reviewer would have found.
 *
 * ## Why FIRST, and why that has to be a rule rather than an implementation
 * detail
 *
 * "Latest wins" — the obvious default, and what every other reader here does
 * for ceilings and weights — would break the rule completely: an attacker mints
 * a hundred agents, each registers in turn, each overwrites the last, and every
 * one of them ends up holding the grant. The defence has to be a race that only
 * one participant can win, and consensus order is what decides it.
 *
 * Ties cannot happen: one topic gives a total order, and two messages cannot
 * share a consensus timestamp.
 *
 * A registration with NO root is kept in `byTab` but claims nothing. That is
 * the honest handling of a tab whose ancestry was never observed — it is not
 * evidence of independence, so it must not be able to lock out other tabs, and
 * `UNVERIFIED_FUNDING` already discounts what it earns.
 */
export function registrationsFromMessages(messages: readonly TopicMessage[]): RegistrationReplay {
  const byRoot = new Map<string, Registration>()
  const byTab = new Map<string, Registration>()
  let read = 0

  for (const message of messages) {
    const result = decode(utf8.decode(message.payload))
    if (!result.ok || result.message.t !== 'register') continue
    const msg = result.message
    read++

    const registration: Registration = {
      tab: msg.tab,
      // Absent stays absent: a registration published before HCS-14 existed
      // has no identifier, which is different from having an empty one.
      ...(msg.uaid ? { uaid: msg.uaid } : {}),
      ...(msg.root ? { root: msg.root } : {}),
      ceiling: usdc(msg.ceil),
      perCall: usdc(msg.perCall),
      allowlist: msg.allowlist,
      at: message.consensusTimestamp,
      ...(message.sequenceNumber !== undefined ? { seq: message.sequenceNumber } : {}),
    }

    // A tab re-registering updates its own record — harmless, and useful when
    // the allowlist or caps change.
    byTab.set(msg.tab, registration)

    // But a ROOT is claimed once. See the doc comment: latest-wins here would
    // let a hundred minted agents each overwrite the last and all hold the grant.
    if (msg.root && !byRoot.has(msg.root)) byRoot.set(msg.root, registration)
  }

  return { byRoot, byTab, read }
}

/**
 * Does this tab hold the Starter Tab grant for its funding root?
 *
 * The three answers are deliberately distinct, because they lead to different
 * ceilings and a caller must not collapse them:
 *
 *  - `granted` — this tab claimed the root, or the root is unclaimed and free.
 *  - `taken` — another tab already holds it. This tab gets NO starter floor and
 *    must earn its ceiling from independent revenue.
 *  - `unknown` — no funding root could be resolved. Granted, because refusing
 *    would mean an indexer outage stops every new agent from ever starting, and
 *    `UNVERIFIED_FUNDING` already discounts what such a tab earns.
 */
export function starterGrantFor(
  tab: string,
  root: string | undefined,
  registrations: RegistrationReplay,
): { status: 'granted' | 'taken' | 'unknown'; heldBy?: string; seq?: number } {
  if (!root) return { status: 'unknown' }
  const holder = registrations.byRoot.get(root)
  if (!holder) return { status: 'granted' }
  if (holder.tab === tab) {
    return { status: 'granted', ...(holder.seq !== undefined ? { seq: holder.seq } : {}) }
  }
  return {
    status: 'taken',
    heldBy: holder.tab,
    ...(holder.seq !== undefined ? { seq: holder.seq } : {}),
  }
}
