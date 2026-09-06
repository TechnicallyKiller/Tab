import { parameterSet, type ParameterSet } from '../schema.ts'

/**
 * v2 — the set in force. FROZEN once a ceiling is published under it.
 *
 * Identical to v1 except the starter floor. See `starterCeilingUsdc` below for
 * why it moved.
 *
 * ## Why this is a new file and not an edit
 *
 * Ceilings were already published under `tab-v1`, and `verify-ceiling` will
 * recompute them from v1's numbers forever. Editing v1 would make every one of
 * them unverifiable — and the tool caught exactly that mistake once already,
 * when `computeCeiling`'s behaviour changed without a version bump. `v1.ts`
 * stays byte-identical beside this file, permanently.
 *
 * That is also the check worth running after this lands: `pnpm verify-ceiling`
 * should still PASS every ceiling published under `tab-v1`, because it resolves
 * each message's own `model` field rather than using whatever is current.
 */
export const v2: ParameterSet = parameterSet.parse({
  version: 2,

  // Unrated pays the C rate. An unrated agent is not given the benefit of the
  // doubt — the rail's whole claim is that credit is earned, and defaulting an
  // unknown agent to a cheap rate would hand a fresh account the best terms.
  aprBp: { A: 600, B: 850, C: 1200, Unrated: 1200 },

  /*
   * Ceiling as a multiple of attested earnings. 10000bp = 1x.
   *
   * Unrated is ZERO, which is what makes a default absolute: the multiple is
   * the term the ceiling is proportional to, so zero means zero credit however
   * much revenue an agent has. `computeCeiling` also short-circuits Unrated to
   * zero, and both belong — the short-circuit is the guarantee, this is the
   * arithmetic agreeing with it.
   *
   * The first version of this table had `C: 12_500, Unrated: 10_000`, which
   * contradicted the documented formula and made the engine print `Unrated ×1`.
   * The ceiling was still zero because of the short-circuit, so nothing was
   * mispriced — but the published `mult` input said 1x for a tier that gets
   * nothing, and an audit record that disagrees with the model is worse than no
   * audit record.
   */
  tierMultipleBp: { A: 30_000, B: 20_000, C: 10_000, Unrated: 0 },

  ramp: {
    startBp: 2500,
    cleanStepBp: 1500,
    missedStepBp: 3000,
    minBp: 0,
    maxBp: 10_000,
    // DOWN, so the ramp never rounds in the agent's favour. Compounds.
    rounding: 'down',
  },

  caps: {
    perCallUsdc: '0.050000',
    perWindowUsdc: '1.000000',
    /*
     * THE ONE CHANGE FROM v1: 1.000000 → 0.250000.
     *
     * v1's floor made the product's central claim untestable. Tab's thesis is
     * that credit is EARNED, and earned credit for one young customer computes
     * to `1.0000 × 0.336 × 1.0 × 0.70 = 0.2352` — so a 1.0000 floor decided a
     * new agent's ceiling for its entire early life, and the GRANT dominated
     * the EARNING. Beating it needed >4.25 of raw revenue from a single
     * customer, about nine calls at the demo price.
     *
     * At 0.250000 the floor still lets a brand-new agent make its first calls,
     * which is the whole purpose of a starter floor, and earned credit becomes
     * visible after three or four. Nothing else in the set moves: one
     * deliberate change per version is easier to defend and easier to verify.
     */
    starterCeilingUsdc: '0.250000',
    // 40%, as integer basis points.
    concentrationCapBp: 4000,
  },

  // Earnings from a counterparty that did not attest count for 60%. An
  // unattested credit is our word alone; a Sybil ring can manufacture those.
  unattestedDiscountBp: 6000,

  // TUNED DOWN FOR TESTNET, and said out loud rather than hidden. Every testnet
  // account is days old, so a mainnet-realistic age factor rejects every agent
  // including the honest one, and the demo would show nothing. This value
  // appears in the config dump and is named in the demo.
  ageFullDays: 7,

  fundingAncestryHops: 3,

  window: { seconds: 600, holdTtlSeconds: 60 },

  // DOWN. Interest compounds window over window, so two call sites rounding
  // differently diverge by an amount small enough to pass review and large
  // enough to break verify-tab.
  interestRounding: 'down',
})
