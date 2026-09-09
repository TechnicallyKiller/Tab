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

import {
  type AccountFacts,
  type AccountId,
  applyWeight,
  concentration,
  sharedFundingRoot,
  type TransferEdge,
  type Weight,
  type WeightPolicy,
  weightOf,
} from '@tab/graph'
import { type MicroUsdc, micro } from '@tab/money'
import { caps, MODEL_ID, params, type Tier, tierMultipleBpFor } from '@tab/params'
import {
  type CeilingInputs,
  type CeilingResult,
  computeCeiling,
  effectiveRevenue,
  tierOf,
  type WindowRevenue,
} from '@tab/scoring'

/**
 * Discount steps, FROM THE FROZEN PARAMETER SET.
 *
 * These were hardcoded here, and the comment that used to sit in this spot said
 * why that was wrong: *"they influence a published ceiling, so by the rule this
 * project set itself they belong in the versioned parameter set where
 * verify-ceiling can find them. Moving them is a params version bump, which is
 * exactly the ceremony that rule exists to impose."*
 *
 * v3 is that bump. The consequence is not cosmetic: a weight message says
 * `bp 3360 · why [SHARED_FUNDING_ROOT, YOUNG_ACCOUNT, CONCENTRATED]`, and until
 * the steps were in the frozen set no stranger could check that 3360 follows
 * from those reasons. Now they can — 0.7 × 0.6 × 0.8 = 0.336.
 *
 * Throws on a pre-v3 set rather than falling back to the old constants. A
 * fallback would let the engine keep running on numbers that are not in the
 * record, which is the exact condition this move exists to end.
 */
export const WEIGHT_POLICY: WeightPolicy = (() => {
  const frozen = params.weights
  if (!frozen) {
    throw new Error(
      `Parameter set v${params.version} carries no weight policy. The engine must not ` +
        'fall back to hardcoded discount steps: a published weight has to be reproducible ' +
        'from the frozen set, and numbers that live only in this file are not.',
    )
  }
  return {
    reciprocalBp: frozen.reciprocalBp,
    reciprocalThresholdBp: frozen.reciprocalThresholdBp,
    sharedRootBp: frozen.sharedRootBp,
    youngBp: frozen.youngBp,
    concentratedBp: frozen.concentratedBp,
    unverifiedBp: frozen.unverifiedBp,
    // Top-level in the set, not inside `weights` — it predates the block and
    // is referenced by the ceiling formula too, so it stays where it was.
    unattestedBp: params.unattestedDiscountBp,
  }
})()

export interface RecomputeInputs {
  tab: AccountId
  edges: readonly TransferEdge[]
  facts: ReadonlyMap<AccountId, AccountFacts>
  history: readonly WindowRevenue[]
  attestedCounterparties: ReadonlySet<AccountId>
  revenueByCounterparty: ReadonlyMap<AccountId, MicroUsdc>
  /** Accounts known to be younger than the age threshold. */
  young: ReadonlySet<AccountId>
  /**
   * Accounts whose funding provenance was neither observed NOR published.
   *
   * The funding rules could not be evaluated against these, so they are
   * discounted rather than trusted. Optional so a caller that does not track it
   * behaves exactly as before — but the engine always passes it, because
   * treating an unverifiable counterparty as independent is the failure that let
   * the loop attacker through on its first full run.
   */
  unverified?: ReadonlySet<AccountId>
  /** Ramp in force, basis points, from the settlement history. */
  rampBp: number
  cleanStreak: number
  hasDefaulted: boolean
  /**
   * Whether this tab holds the Starter Tab claim on its funding root.
   *
   * `taken` means another tab already claimed it, so the starter floor is zero
   * — one Starter Tab per funding root is what makes bulk-minting agents
   * pointless. `unknown` (no root resolved) GRANTS the floor, because refusing
   * would let an indexer outage stop every new agent from ever starting, and
   * `UNVERIFIED_FUNDING` already discounts what such a tab earns.
   *
   * Optional so a caller that does not resolve roots behaves exactly as before.
   */
  starterGrant?: 'granted' | 'taken' | 'unknown'
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
    const shared = sharedFundingRoot(
      inputs.tab,
      counterparty,
      inputs.facts,
      params.fundingAncestryHops,
    )
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
        unverified: inputs.unverified?.has(counterparty) === true,
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
    /*
     * The starter floor is granted ONCE PER FUNDING ROOT.
     *
     * `caps.starterCeiling` is already parsed money. Re-parsing the string form
     * by stripping the decimal point would work today and break silently the
     * moment a cap is written with a different number of decimals.
     *
     * The floor applies to a new tab too — withholding it from Unrated made a
     * new agent unable to ever start, see `computeCeiling`. But it is a GRANT,
     * and a grant handed out per-account is a grant an attacker mints accounts
     * to farm. When another tab already holds the claim on this tab's funding
     * root, the floor is zero and this tab must earn its ceiling from
     * independent revenue like any other.
     *
     * Zero rather than a refusal, deliberately: the tab still works, still
     * spends what it earns, and still settles. It is denied the free headroom,
     * not the rail.
     */
    starterFloor: inputs.starterGrant === 'taken' ? micro(0n) : caps.starterCeiling,
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
