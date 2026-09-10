import { z } from 'zod'
import { amount, base, basisPoints, consensusTimestamp, entityId, shortHash } from './common.ts'
import { REFUSAL_CODES } from './refusal-codes.ts'
import { WEIGHT_REASONS } from './weight-reasons.ts'

/**
 * Every message Tab publishes to HCS.
 *
 * HCS is the ledger — there is no other accounting store and no contract. A
 * stranger replaying these topics must be able to reconstruct the net position,
 * recompute a ceiling, and check the float invariant. That is the whole
 * no-smart-contract argument, so anything money depends on has to be here.
 */

/* ── receipts topic ─────────────────────────────────────────────────────── */

/** Money left the float to pay a seller. The spend leg. */
/**
 * A hold, published BEFORE the payment it authorises.
 *
 * The write-ahead ordering — `reserve → pay → commit` — is the safety property
 * this rail rests on, and it was the one thing a stranger had to take on trust:
 * `verify-tab` could not assert `debit_has_hold` because holds lived only in
 * the gateway's memory, so an HCS replay showed debits appearing from nowhere.
 * Publishing the hold first is what makes the ordering auditable by someone
 * who does not trust us, which is the entire no-contract argument.
 *
 * The cost, stated: one extra message per attempted spend, and the gateway
 * AWAITS consensus on it before paying. That adds ~2-4s to a spend path
 * already taking 25-39s on the x402 HTS settlement, so it is roughly 10% —
 * and it does not touch the 50ms authorization budget, which is a cache read
 * that happens before this.
 *
 * At high volume this triples topic size and slows every replay. The
 * production answer is a rolling batch commitment — one message covering many
 * holds — not one message per hold. Recorded rather than pretended away.
 */
export const holdReceipt = base.extend({
  t: z.literal('hold'),
  /** The idempotency key the debit will reference. */
  hold: z.string().min(8).max(64),
  /** The seller this hold is reserved against. */
  cp: entityId,
  /** POSITIVE here, unlike a debit: a hold reserves, it does not move money. */
  amt: amount,
  /**
   * When this hold lapses.
   *
   * Published so a stranger can tell an EXPIRED hold from a stranded one. A
   * hold with no expiry that never commits looks identical to a gateway that
   * crashed holding an agent's ceiling hostage.
   */
  exp: consensusTimestamp,
  /** Hash of the request being authorised, never the request itself. */
  req: shortHash,
})

export const debitReceipt = base.extend({
  t: z.literal('debit'),
  /** The seller. Unmodified x402, unaware Tab exists. */
  cp: entityId,
  /** Negative, six decimals. */
  amt: amount,
  /** Ties this receipt to the hold that authorised it — the idempotency key. */
  hold: z.string().min(8).max(64),
  /** Hash of the request served, never the request itself. */
  req: shortHash,
  /** The on-chain transfer, so a stranger can match receipt to chain. */
  tx: z.string().min(8).max(80),
})

/** Money arrived for a request Tab actually served. The earn leg. */
export const creditReceipt = base.extend({
  t: z.literal('credit'),
  cp: entityId,
  /** Positive, six decimals. */
  amt: amount,
  /**
   * Attested means the gateway served the request this payment corresponds to.
   * Unattested inflows still count, at a discount, because nobody can prove a
   * purchase happened. It does NOT mean the payer is independent — that is the
   * graph's job.
   */
  att: z.boolean(),
  req: shortHash,
  tx: z.string().min(8).max(80),
})

/**
 * A spend was refused. Not an error — the product demonstrating that it works,
 * which is why it is published rather than logged.
 */
export const refusalReceipt = base.extend({
  t: z.literal('refused'),
  cp: entityId,
  /** What was asked for, positive. Nothing moved. */
  amt: amount,
  /** The single rule that fired. Never a prose message. */
  rule: z.enum(REFUSAL_CODES),
  /** Machine-readable evidence: the numbers the rule compared. */
  ev: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
})

/** Repairs a crash between paying a seller and recording the debit. */
export const repairReceipt = base.extend({
  t: z.literal('repair'),
  cp: entityId,
  amt: amount,
  tx: z.string().min(8).max(80),
  /**
   * Why the reconciler had to write this.
   *
   * `missing_transfer` is the strict direction and was missing from the first
   * version of this enum: a debit receipt naming a transfer that never reached
   * consensus. Its repair REVERSES the debit (positive `amt`), where the other
   * three add or adjust one. See @tab/ledger's netting, which routes a repair
   * by the sign of its amount for exactly this reason.
   */
  why: z.enum(['missing_debit', 'missing_transfer', 'orphan_hold', 'amount_mismatch']),
})

export const receipt = z.discriminatedUnion('t', [
  holdReceipt,
  debitReceipt,
  creditReceipt,
  refusalReceipt,
  repairReceipt,
])

/* ── ceilings topic ─────────────────────────────────────────────────────── */

/**
 * One counterparty's independence weight, published.
 *
 * ONE MESSAGE PER COUNTERPARTY, deliberately. The obvious alternative — an
 * array of weights inside the ceiling message — hits the **1024-byte
 * single-chunk limit** the moment an agent has a handful of counterparties, and
 * `encode()` refuses anything larger because a chunked payload read partially
 * parses as truncated JSON. A message per counterparty is small, incremental,
 * and cannot overflow.
 *
 * The cost, as with holds: N messages per window rather than one. At scale the
 * answer is a batch commitment, not a bigger message.
 *
 * Published because the engine computed these and published them NOWHERE — the
 * strongest artifact in the demo, the three-way weight table, existed only in
 * engine stdout. A number nobody can read is a number nobody can check.
 */
export const weightUpdate = base.extend({
  t: z.literal('weight'),
  /** The counterparty being weighted. */
  cp: entityId,
  /** Independence weight in basis points. 10000 counts in full, 0 blocks. */
  bp: basisPoints,
  /**
   * Every reason that applied, most severe first. Never empty.
   *
   * A weight with no reason is useless in the console and useless in a dispute:
   * the question an operator asks is not "what weight" but "why".
   */
  why: z.array(z.enum(WEIGHT_REASONS)).min(1).max(9),
  /** True when a reason is fatal — the spend is refused, not discounted. */
  block: z.boolean(),
  /** Revenue attributed to this counterparty over the trailing span. */
  rev: amount,
  /** Its share of total revenue, basis points. */
  share: basisPoints,
  /**
   * The parameter set the discount steps came from, e.g. `tab-v3`.
   *
   * Without this a published weight is not verifiable, only readable. The
   * message says `bp 3360 · why [SHARED_FUNDING_ROOT, YOUNG_ACCOUNT,
   * CONCENTRATED]` — and checking that 3360 follows from those reasons needs
   * the discount steps, which are frozen per version. A reader with no version
   * cannot know which set to resolve, so `verify-weights` reports such a
   * message as NOT VERIFIABLE rather than guessing at the current one.
   *
   * Optional for backward compatibility with the weight messages published
   * before it existed, and with those published under v1 and v2, which had no
   * frozen weight policy at all. Absent means unverifiable — never "assume
   * current", which would check an old weight against numbers that were not in
   * force when it was written.
   */
  model: z.string().min(3).max(32).optional(),
})

/**
 * One account's observed graph facts — creation time and funder.
 *
 * ## Why this exists
 *
 * The independence graph **failed open**. Funding ancestry was re-derived every
 * pass from Mirror Node's transactions-by-account index, which is *intermittent*
 * for new accounts — measured returning 5 transactions once and 0 both before
 * and after, minutes apart. When the lookup failed the counterparty was
 * weighted **independent**, the unsafe direction. That is not theoretical: the
 * loop attacker went uncaught on its first full run because of exactly this.
 *
 * The fix is to record a fact WHEN OBSERVED and never forget it. That was
 * scoped as `@tab/db`, and a private database would have worked — but it would
 * have put the graph's inputs somewhere a stranger cannot see, which
 * contradicts the entire no-contract argument. Every other input to a ceiling
 * is on a topic; the graph's inputs were the exception, and re-deriving them
 * from an eventually-consistent index is precisely why `verify-ceiling` could
 * check the arithmetic but never the graph.
 *
 * So they go on the topic. A published fact is durable, monotonic (see below),
 * free of a database, and checkable by anyone with a Mirror Node URL.
 *
 * ## Monotonic, and why a reader must enforce it
 *
 * These messages are **append-only and cumulative**: once `by` is known for an
 * account, a later message that omits it must NOT erase it. A reader that
 * blindly takes the newest message would let one Mirror Node outage — which
 * publishes a fact with no funder — wipe a funding edge that was correctly
 * observed a week ago, reproducing the fail-open through the very mechanism
 * meant to close it. `factsFromMessages` in `@tab/ledger` merges rather than
 * replaces, and that is the load-bearing property.
 *
 * ## What is published, and what is not
 *
 * This is a **derived index of already-public data**: every field is readable
 * by anyone from Mirror Node, and publishing it reveals no private
 * information — it only saves the next reader from an index that may not
 * answer. Nothing here is a private key, a request payload, or an amount.
 */
export const graphFact = base.extend({
  t: z.literal('fact'),
  /**
   * The account this fact is ABOUT — not the tab.
   *
   * `base` carries `tab` because every other message concerns one, and here it
   * means "the tab whose engine pass observed this". That is deliberate rather
   * than a workaround: a fact is evidence someone gathered at a moment, and
   * knowing which pass gathered it is what lets a reader re-run that pass.
   */
  acct: entityId,
  /** Consensus timestamp of account creation. Absent when Mirror had none. */
  born: consensusTimestamp.optional(),
  /**
   * The account that funded `acct`, when one was observed.
   *
   * Absent means NOT OBSERVED, never "has no funder" — an account genuinely
   * created by itself is not a thing on Hedera. A reader must therefore treat
   * absence as no information and keep whatever it already knew.
   */
  by: entityId.optional(),
})

/**
 * Every input that influenced the ceiling.
 *
 * If a number affected the result and is not in here, `verify-ceiling` cannot
 * reproduce it and the transparency claim is decoration. This shape is pinned
 * by the CEILING view, which renders exactly these rows.
 */
export const ceilingInputs = z.object({
  /** Trailing attested revenue per window. */
  rev: amount,
  /** Split of that revenue, so the 0.6 discount is auditable. */
  revAtt: amount,
  revUnatt: amount,
  tier: z.enum(['A', 'B', 'C', 'Unrated']),
  /** Tier multiple in basis points. 10000 = 1.0x. */
  mult: basisPoints,
  /** Ramp factor in basis points. 3000 = 30%. */
  ramp: basisPoints,
  /** Hard cap for the tier. */
  cap: amount,
  /** Starter floor. Applied to any non-defaulted tab, including a new one. */
  floor: amount,
  /**
   * Has this tab ever missed a settlement?
   *
   * An INPUT, not a derivation, and therefore published — it changes the output
   * on its own. Optional only for backward compatibility with ceilings
   * published before it existed; absent means false.
   *
   * It is separate from `tier` because two very different situations both read
   * as Unrated: a tab with no history yet, and a tab that defaulted. The first
   * gets the starter floor so it can make its first calls and earn its way up;
   * the second gets exactly zero. Collapsing them made a brand-new agent
   * unable to ever start — no revenue, so Unrated, so no ceiling, so no way to
   * earn revenue.
   */
  def: z.boolean().optional(),
})

export const ceilingUpdate = base.extend({
  t: z.literal('ceiling'),
  /** The ceiling now in force — what the fast path enforces. */
  ceil: amount,
  /**
   * The formula's result, when the asymmetry rule is holding it back.
   *
   * Absent when it equals `ceil`, which is the normal case. Present when a
   * GROWTH was computed and held for a clean settlement: `ceil` is then the
   * lower value still in force and this is what the inputs recompute to.
   *
   * Without this the two claims on the message contradict each other. `ceil` is
   * defined as in force, but `hash` is over `inputs`, and inputs recompute to
   * the formula's result — so a held growth would make `verify-ceiling` report a
   * mismatch between a published ceiling and its own published inputs. That
   * looks exactly like fraud and is only the safety rule working.
   *
   * `verify-ceiling` therefore checks the inputs against `computed ?? ceil`.
   */
  computed: amount.optional(),
  /** Which constraint actually bound — the most useful fact on the screen. */
  bind: z.enum(['computed', 'hard_cap', 'starter_floor', 'unrated']),
  inputs: ceilingInputs,
  /** Pinned so a historical ceiling stays reproducible after params change. */
  model: z.string().min(3).max(32),
  /** SHA-256 of the canonical inputs. verify-ceiling recomputes and compares. */
  hash: shortHash,
  /** Why it moved, for the operator. Shrink is instant; growth waits. */
  cause: z.enum([
    'clean_settlement',
    'missed_settlement',
    'graph_change',
    'registration',
    'freeze',
  ]),
})

/* ── settlements topic ──────────────────────────────────────────────────── */

export const settlement = base.extend({
  t: z.literal('settlement'),
  credits: amount,
  /**
   * NEGATIVE, as `@tab/ledger`'s `WindowNet` holds it. So is `interest`.
   *
   * Stated because the comment below used to read `credits − debits −
   * interest`, which describes positive magnitudes and is not what is
   * published. A console built on that comment negated `debits`, turned a debit
   * into a credit on screen, and showed a netting panel summing to 0.190000
   * above a published net of 0.110000.
   */
  debits: amount,
  interest: amount,
  /** credits + debits + interest, the latter two negative. One transfer per window. */
  net: amount,
  /** How many receipts collapsed into that one movement. */
  n: z.number().int().nonnegative(),
  /** Absent when the window was missed and nothing moved. */
  tx: z.string().min(8).max(80).optional(),
  outcome: z.enum(['clean', 'missed', 'carried']),
  rampFrom: basisPoints,
  rampTo: basisPoints,
  /** Carried into the next window when net is negative. */
  outstanding: amount,
})

/* ── registrations topic (shares the receipts topic) ────────────────────── */

export const registration = base.extend({
  t: z.literal('register'),
  /** One Starter Tab per funding root — this is what makes bulk minting pointless. */
  root: entityId.optional(),
  ceil: amount,
  perCall: amount,
  /** Starter tabs may only buy from an allowlist until they graduate. */
  allowlist: z.array(entityId).max(16),
  /**
   * The agent's HCS-14 Universal Agent Identifier.
   *
   * Derived rather than issued: six canonical fields, SHA-384, Base58. Any
   * party computes the same id from the same inputs, which is what lets a
   * credit record travel between systems that do not know each other — today a
   * tab is keyed on a Hedera account, so a redeployment starts from zero.
   *
   * OPTIONAL, and on the message that already exists rather than a new one. A
   * reader that does not care ignores it, every registration published before
   * it still decodes, and no ceiling, weight or settlement changes. Adding an
   * identity should not be able to move a credit decision.
   */
  uaid: z.string().min(8).max(256).optional(),
})

/* ── the union written to any topic ─────────────────────────────────────── */

export const tabMessage = z.discriminatedUnion('t', [
  weightUpdate,
  graphFact,
  holdReceipt,
  debitReceipt,
  creditReceipt,
  refusalReceipt,
  repairReceipt,
  ceilingUpdate,
  settlement,
  registration,
])

export type DebitReceipt = z.infer<typeof debitReceipt>
export type CreditReceipt = z.infer<typeof creditReceipt>
export type RefusalReceipt = z.infer<typeof refusalReceipt>
export type HoldReceipt = z.infer<typeof holdReceipt>
export type WeightUpdate = z.infer<typeof weightUpdate>
export type GraphFact = z.infer<typeof graphFact>
export type RepairReceipt = z.infer<typeof repairReceipt>
export type Receipt = z.infer<typeof receipt>
export type CeilingInputs = z.infer<typeof ceilingInputs>
export type CeilingUpdate = z.infer<typeof ceilingUpdate>
export type Settlement = z.infer<typeof settlement>
export type Registration = z.infer<typeof registration>
export type TabMessage = z.infer<typeof tabMessage>

export { consensusTimestamp }
