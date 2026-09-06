/**
 * The recompute: gathered inputs → graph → scoring → a ceiling.
 *
 * **This file adds no math of its own**, per the README, and the reason is not
 * tidiness: `@tab/graph` and `@tab/scoring` are pure so a stranger can rerun
 * them from public data, and any arithmetic that leaks into this app is
 * arithmetic nobody outside can verify. So what happens here is sequencing and
 * bookkeeping — deciding which counterparties to ask about, and assembling the
 * published input record.
 */
import { micro, type MicroUsdc } from '@tab/money'
import { MODEL_ID, caps, params, tierMultipleBpFor, type Tier } from '@tab/params'
import {
  applyWeight, concentration, sharedFundingRoot, weightOf,
  type AccountFacts, type AccountId, type TransferEdge, type Weight, type WeightPolicy,
} from '@tab/graph'
import {
  computeCeiling, effectiveRevenue, tierOf,
  type CeilingInputs, type CeilingResult, type WindowRevenue,
} from '@tab/scoring'

/**
 * Discount steps.
 *
 * These live here rather than in `@tab/params` for now, and that is a gap worth
 * naming rather than hiding: they influence a published ceiling, so by the rule
 * this project set itself they belong in the versioned parameter set where
 * `verify-ceiling` can find them. Moving them is a params version bump, which
 * is exactly the ceremony that rule exists to impose.
 */
export const WEIGHT_POLICY: WeightPolicy = {
  reciprocalBp: 5000,
  reciprocalThresholdBp: 2500,
  sharedRootBp: 7000,
  youngBp: 6000,
  concentratedBp: 8000,
  unattestedBp: params.unattestedDiscountBp,
}

export interface RecomputeInputs {
  tab: AccountId
  edges: readonly TransferEdge[]
  facts: ReadonlyMap<AccountId, AccountFacts>
  history: readonly WindowRevenue[]
  attestedCounterparties: ReadonlySet<AccountId>
  revenueByCounterparty: ReadonlyMap<AccountId, MicroUsdc>
  /** Accounts known to be younger than the age threshold. */
  young: ReadonlySet<AccountId>
  /** Ramp in force, basis points, from the settlement history. */
  rampBp: number
  cleanStreak: number
  hasDefaulted: boolean
  /** Trailing windows to average revenue over. */
  windowCount: number
  hardCap: MicroUsdc
}

export interface Recomputation {
  ceiling: CeilingResult
  tier: Tier
  tierReason: string
  /** Per-counterparty weights, each with the reason it was assigned. */
  weights: readonly Weight[]
  /** Counterparties whose weight is zero — the spend-leg blocks. */
  blocked: readonly AccountId[]
  /** The published model identifier. */
  modelId: string
}

export function recompute(inputs: RecomputeInputs): Recomputation {
  const cap = params.caps.concentrationCapBp
  const shares = concentration(inputs.revenueByCounterparty, cap)
  const overCap = new Set(shares.overCap.map((e) => e.counterparty))

  /*
   * Weigh every counterparty that contributed revenue.
   *
   * Not every account in the edge list: the edge list also contains sellers the
   * agent BUYS from, and weighting those as revenue sources would let an
   * outbound payment discount a ceiling it has nothing to do with. The spend
   * leg asks about a seller at the moment of the spend; this asks about the
   * revenue that justifies the ceiling.
   */
  const weights: Weight[] = []
  for (const counterparty of inputs.revenueByCounterparty.keys()) {
    const shared = sharedFundingRoot(inputs.tab, counterparty, inputs.facts, params.fundingAncestryHops)
    weights.push(
      weightOf({
        agent: inputs.tab,
        counterparty,
        edges: inputs.edges,
        facts: inputs.facts,
        maxHops: params.fundingAncestryHops,
        policy: WEIGHT_POLICY,
        concentrated: overCap.has(counterparty),
        sharedRoot: shared.shared,
        young: inputs.young.has(counterparty),
        // Attestation is per-RECEIPT, not per-counterparty, and it is already
        // applied by the unattested discount inside effectiveRevenue. Applying
        // it again here would discount the same weakness twice.
        unattested: false,
      }),
    )
  }

  const weightByCounterparty = new Map(weights.map((w) => [w.counterparty, w]))

  /*
   * Apply weights to the revenue history.
   *
   * Attested revenue from a counterparty weighted at 0 contributes nothing —
   * which is the loop attack's whole defeat: the payments were real, so they
   * are in the history, and they count for zero because the payer was not
   * independent.
   */
  const weighted: WindowRevenue[] = inputs.history.map((w) => ({ ...w }))
  const totalRevenue = [...inputs.revenueByCounterparty.values()].reduce((a, b) => a + b, 0n)
  if (totalRevenue > 0n) {
    for (const window of weighted) {
      let attested = 0n
      for (const [counterparty, amount] of inputs.revenueByCounterparty) {
        const weight = weightByCounterparty.get(counterparty)
        if (!weight) continue
        // This counterparty's share of the window, weighted. Integer
        // throughout, truncating — never crediting a partial micro-unit.
        const share = (window.attested * amount) / totalRevenue
        attested += applyWeight(micro(share), weight)
      }
      window.attested = micro(attested)
    }
  }

  const revenue = effectiveRevenue(weighted, inputs.windowCount, params.unattestedDiscountBp)

  const tier = tierOf({
    perWindow: revenue.perWindow,
    // Only counterparties that survived weighting count toward diversity. Five
    // buyers the agent funded are not five buyers.
    counterparties: [...inputs.attestedCounterparties].filter(
      (c) => (weightByCounterparty.get(c)?.bp ?? 0) > 0,
    ).length,
    cleanStreak: inputs.cleanStreak,
    hasDefaulted: inputs.hasDefaulted,
  })

  const ceilingInputs: CeilingInputs = {
    revenue: revenue.perWindow,
    attested: revenue.attested,
    unattested: revenue.unattested,
    tier: tier.tier,
    multipleBp: tierMultipleBpFor(tier.tier),
    rampBp: inputs.rampBp,
    hardCap: inputs.hardCap,
    // `caps.starterCeiling` is already parsed money. Re-parsing the string
    // form by stripping the decimal point would work today and break silently
    // the moment a cap is written with a different number of decimals.
    // The floor applies to a new tab too. Withholding it from Unrated made a
    // new agent unable to ever start — see computeCeiling.
    starterFloor: caps.starterCeiling,
    hasDefaulted: inputs.hasDefaulted,
  }

  return {
    ceiling: computeCeiling(ceilingInputs),
    tier: tier.tier,
    tierReason: tier.reason,
    weights,
    blocked: weights.filter((w) => w.bp === 0).map((w) => w.counterparty),
    modelId: MODEL_ID,
  }
}
