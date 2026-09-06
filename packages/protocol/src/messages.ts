import { z } from 'zod'
import {
  amount,
  base,
  basisPoints,
  consensusTimestamp,
  entityId,
  shortHash,
} from './common.ts'
import { REFUSAL_CODES } from './refusal-codes.ts'

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
  cause: z.enum(['clean_settlement', 'missed_settlement', 'graph_change', 'registration', 'freeze']),
})

/* ── settlements topic ──────────────────────────────────────────────────── */

export const settlement = base.extend({
  t: z.literal('settlement'),
  credits: amount,
  debits: amount,
  interest: amount,
  /** credits − debits − interest. One transfer for the whole window. */
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
})

/* ── the union written to any topic ─────────────────────────────────────── */

export const tabMessage = z.discriminatedUnion('t', [
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
export type RepairReceipt = z.infer<typeof repairReceipt>
export type Receipt = z.infer<typeof receipt>
export type CeilingInputs = z.infer<typeof ceilingInputs>
export type CeilingUpdate = z.infer<typeof ceilingUpdate>
export type Settlement = z.infer<typeof settlement>
export type Registration = z.infer<typeof registration>
export type TabMessage = z.infer<typeof tabMessage>

export { consensusTimestamp }
