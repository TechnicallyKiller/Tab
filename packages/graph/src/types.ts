import type { MicroUsdc } from '@tab/money'

/**
 * The shapes a caller must supply.
 *
 * This package never fetches. `boundaries.json` bars it from `mirror`, `db`
 * and `hedera`, and that is a product requirement rather than tidiness:
 * `tools/verify` must reproduce an independence decision from Mirror Node data
 * alone, so anything this package needs has to be expressible as data a
 * stranger can also fetch.
 */

/** A Hedera account id, `0.0.x`. Never an EVM address. */
export type AccountId = string

/**
 * One observed transfer. Direction matters — reciprocity is half the signal.
 */
export interface TransferEdge {
  from: AccountId
  to: AccountId
  amount: MicroUsdc
  /** Consensus timestamp, `seconds.nanos`. */
  at: string
}

/**
 * What is known about an account.
 *
 * `createdAt` comes from Mirror Node's `created_timestamp` on the accounts
 * endpoint — the exact creation time, not a first-operation heuristic. The
 * heuristic is wrong in the direction that matters: an attacker's freshly
 * minted seller looks older than it is the moment someone funds it, which is
 * precisely the account the age discount exists to catch.
 */
export interface AccountFacts {
  id: AccountId
  /** Consensus timestamp of account creation, or undefined if not fetched. */
  createdAt?: string
  /** Accounts that funded this one, nearest first. Supplied, not derived. */
  fundedBy?: readonly AccountId[]
}

/**
 * Why a counterparty was weighted the way it was.
 *
 * Every weight carries one. A bare `0.4` is useless in the Counterparties view
 * and useless in a dispute — the question a judge and an operator both ask is
 * not "what weight" but "why". `INDEPENDENT` is a reason too: counting a
 * counterparty in full is a decision that should be as auditable as discounting
 * one.
 *
 * These are graph-level reasons and deliberately distinct from
 * `@tab/protocol`'s `REFUSAL_CODES`. A refusal is a spend that did not happen;
 * a weight is how much an earning counts for. `FUNDED_BY_AGENT` and
 * `SOLE_COUNTERPARTY` map onto the `CONTROL_CLUSTER` refusal when the caller
 * is deciding a spend, and `weightOf` marks them `blocking` so the caller does
 * not have to know which reasons are fatal.
 */
export const WEIGHT_REASONS = [
  'INDEPENDENT',
  'FUNDED_BY_AGENT',
  'COMMON_FUNDER',
  'SOLE_COUNTERPARTY',
  'RECIPROCAL_FLOW',
  'SHARED_FUNDING_ROOT',
  'YOUNG_ACCOUNT',
  'CONCENTRATED',
  'UNATTESTED',
] as const

export type WeightReason = (typeof WEIGHT_REASONS)[number]

export interface Weight {
  counterparty: AccountId
  /**
   * Basis points. 10000 = counts in full, 0 = does not count at all.
   *
   * Integer basis points rather than a float multiplier, for the same reason
   * money is bigint: `0.4` is not representable, and a concentration test that
   * flips at exactly 40% because of a representation error is a bug nobody
   * finds until it decides a real ceiling. `guard:money` enforces this.
   */
  bp: number
  /** Every reason that applied, most severe first. Never empty. */
  reasons: readonly WeightReason[]
  /** True when a reason is fatal — the spend is refused, not merely discounted. */
  blocking: boolean
}

/** Human-readable explanation, for the dashboard and the refusal message. */
export const WEIGHT_REASON_DETAIL: Record<WeightReason, string> = {
  INDEPENDENT: 'no funding relationship, no reciprocal flow, counted in full',
  FUNDED_BY_AGENT: 'the agent funded this account — revenue from it is the agent paying itself',
  COMMON_FUNDER:
    'the same account funded both this counterparty and the agent’s tab — one operator on both ' +
    'sides of the trade, so the revenue is not independent demand',
  SOLE_COUNTERPARTY: 'the agent is this account’s only counterparty — it exists to trade with the agent',
  RECIPROCAL_FLOW: 'value flows back toward the agent — some of this revenue is circular',
  SHARED_FUNDING_ROOT: 'funded from the same root as the agent within the hop limit',
  YOUNG_ACCOUNT: 'account is newer than the age threshold — not yet independently established',
  CONCENTRATED: 'over the single-counterparty share cap of the agent’s total',
  UNATTESTED: 'no gateway receipt — money arrived, but no purchase can be proven',
}
