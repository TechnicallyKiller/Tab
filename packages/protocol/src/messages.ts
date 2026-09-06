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
  /** Starter floor, applied unless Unrated. */
  floor: amount,
})

export const ceilingUpdate = base.extend({
  t: z.literal('ceiling'),
  /** The ceiling now in force. */
  ceil: amount,
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
export type RepairReceipt = z.infer<typeof repairReceipt>
export type Receipt = z.infer<typeof receipt>
export type CeilingInputs = z.infer<typeof ceilingInputs>
export type CeilingUpdate = z.infer<typeof ceilingUpdate>
export type Settlement = z.infer<typeof settlement>
export type Registration = z.infer<typeof registration>
export type TabMessage = z.infer<typeof tabMessage>

export { consensusTimestamp }
