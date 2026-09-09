import type { MicroUsdc } from '@tab/money'
import { detectCluster, reciprocity } from './clusters.ts'
import type { AccountFacts, AccountId, TransferEdge, Weight, WeightReason } from './types.ts'

/**
 * Per-counterparty weight, and the reason it was assigned.
 *
 * The weight is how much a counterparty's payments count toward the revenue
 * that justifies a ceiling. `10000` bp counts in full; `0` does not count at
 * all and, on the spend leg, refuses the purchase.
 *
 * Discounts MULTIPLY. Two independent weaknesses are worse than one, and
 * taking the minimum — the obvious alternative — would make a young account
 * that also pays value back score exactly as well as a young account that does
 * not. That is the shape an attacker optimises into: accumulate flaws that each
 * stay under the worst single one, and pay nothing for any but the largest.
 */

/** Discount steps, basis points of the running weight. */
export interface WeightPolicy {
  /** Value flows back toward the agent above the reciprocity threshold. */
  reciprocalBp: number
  /** Reciprocity ratio at which the discount applies. */
  reciprocalThresholdBp: number
  /** Funded from the same root as the agent within the hop limit. */
  sharedRootBp: number
  /** Account younger than the age threshold. */
  youngBp: number
  /** Over the single-counterparty share cap. */
  concentratedBp: number
  /** No gateway receipt for the inflow. */
  unattestedBp: number
  /**
   * No funding provenance observed or published — the rules could not be asked.
   *
   * Optional so a caller on a pre-v3 parameter set can omit it; omitted means
   * the discount is not applied, which is the pre-v3 behaviour exactly. It is
   * NOT defaulted to a number here, because a default would silently impose a
   * policy on a version that never had one.
   */
  unverifiedBp?: number
}

/**
 * Applied in a fixed order so the result is deterministic.
 *
 * Multiplication is commutative but integer truncation is not: applying 6000
 * then 8000 can differ by a micro-unit from 8000 then 6000. Same inputs must
 * give the same ceiling byte for byte, or `verify-ceiling` fails on a rounding
 * artefact and looks like it caught fraud.
 */
const ORDER: readonly WeightReason[] = [
  /*
   * FIRST, and the position is part of the frozen model.
   *
   * "I cannot establish who this counterparty is" is logically prior to any
   * specific finding about it — the other reasons are things we learned, this
   * one is that we could not learn them. Order only changes the result by a
   * micro-unit through truncation, but it does change it, so this sequence is
   * frozen alongside the numbers in `@tab/params`: moving an entry needs a
   * version bump exactly as changing a step does.
   */
  'UNVERIFIED_FUNDING',
  'RECIPROCAL_FLOW',
  'SHARED_FUNDING_ROOT',
  'YOUNG_ACCOUNT',
  'CONCENTRATED',
  'UNATTESTED',
]

export interface WeightInputs {
  agent: AccountId
  counterparty: AccountId
  edges: readonly TransferEdge[]
  facts: ReadonlyMap<AccountId, AccountFacts>
  maxHops: number
  policy: WeightPolicy
  /** Set by the caller from `concentration()`. */
  concentrated?: boolean
  /** Set by the caller from `sharedFundingRoot()`. */
  sharedRoot?: boolean
  /** Set by the caller from account age against `ageFullDays`. */
  young?: boolean
  /** Set by the caller: does this inflow have a gateway receipt? */
  unattested?: boolean
  /**
   * Set by the caller: was funding provenance neither observed NOR published?
   *
   * Not "does this account have a funder" — that is a different claim. This is
   * "the funding rules could not be evaluated", which is why it discounts
   * rather than blocks.
   */
  unverified?: boolean
}

export function weightOf(inputs: WeightInputs): Weight {
  const { agent, counterparty, edges, facts, maxHops, policy } = inputs

  /*
   * A blocking reason short-circuits at zero.
   *
   * Not merely an optimisation: continuing to apply discounts to a weight of 0
   * would produce a Weight carrying five reasons, of which only one mattered,
   * and the dashboard would show a wall of noise around the one line that
   * explains the refusal.
   */
  const cluster = detectCluster({ agent, counterparty, edges, facts, maxHops })
  if (cluster.clustered) {
    return { counterparty, bp: 0, reasons: cluster.reasons, blocking: true }
  }

  const applied: WeightReason[] = []
  const flags = new Map<WeightReason, { hit: boolean; bp: number }>([
    [
      'RECIPROCAL_FLOW',
      {
        hit: reciprocity(agent, counterparty, edges, policy.reciprocalThresholdBp).reciprocal,
        bp: policy.reciprocalBp,
      },
    ],
    ['SHARED_FUNDING_ROOT', { hit: inputs.sharedRoot === true, bp: policy.sharedRootBp }],
    ['YOUNG_ACCOUNT', { hit: inputs.young === true, bp: policy.youngBp }],
    ['CONCENTRATED', { hit: inputs.concentrated === true, bp: policy.concentratedBp }],
    ['UNATTESTED', { hit: inputs.unattested === true, bp: policy.unattestedBp }],
    /*
     * Applies only when the policy CARRIES a step for it.
     *
     * A pre-v3 parameter set has no `unverifiedBp`, and inventing one would
     * impose a policy retroactively on a version that never had it — the same
     * mistake as back-filling the weight block into v1. Absent step, no
     * discount, which is precisely the pre-v3 behaviour.
     */
    [
      'UNVERIFIED_FUNDING',
      {
        hit: inputs.unverified === true && policy.unverifiedBp !== undefined,
        bp: policy.unverifiedBp ?? 10_000,
      },
    ],
  ])

  let bp = 10_000
  for (const reason of ORDER) {
    const flag = flags.get(reason)
    if (!flag?.hit) continue
    // Integer throughout. Truncating is the safe direction — it can only weight
    // a counterparty lower than the exact figure, never higher.
    bp = Math.floor((bp * flag.bp) / 10_000)
    applied.push(reason)
  }

  return {
    counterparty,
    bp,
    reasons: applied.length > 0 ? applied : ['INDEPENDENT'],
    blocking: false,
  }
}

/**
 * Apply a weight to an amount.
 *
 * Rounds DOWN, always. The weighted figure feeds a credit ceiling, so rounding
 * up would extend credit against revenue that was never quite earned — small
 * per counterparty, and systematically in the agent's favour across thousands
 * of them, which is how a rail bleeds.
 */
export function applyWeight(amount: MicroUsdc, weight: Weight): MicroUsdc {
  return ((amount * BigInt(weight.bp)) / 10_000n) as MicroUsdc
}
