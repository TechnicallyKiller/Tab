import { type ParameterSet, parameterSet } from '../schema.ts'

/**
 * v3 — the set in force. FROZEN once a ceiling is published under it.
 *
 * Identical to v2 except that the independence discount steps are now IN the
 * parameter set, and one of them is new. See `weights` below.
 *
 * ## Why this is a new file and not an edit
 *
 * Ceilings are published under `tab-v1` and `tab-v2`, and `verify-ceiling`
 * recomputes each from the numbers of the set its own `model` field names —
 * forever. Editing an earlier set would make every ceiling published under it
 * unverifiable, and the tool caught exactly that mistake once already, when
 * `computeCeiling`'s behaviour changed without a version bump. `v1.ts` and
 * `v2.ts` stay byte-identical beside this file, permanently, and their hashes
 * are pinned in `params.test.ts` as a tripwire.
 *
 * The check worth running after this lands: `pnpm verify-ceiling` should still
 * PASS every ceiling published under `tab-v1` and `tab-v2`.
 */
export const v3: ParameterSet = parameterSet.parse({
  version: 3,

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
    // Unchanged from v2. See v2.ts for why it moved from 1.000000.
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

  /*
   * THE CHANGE FROM v2: the discount steps move IN, and one is new.
   *
   * ## Why they moved
   *
   * These five numbers decided every published weight and lived in
   * `apps/engine/src/recompute.ts`. The engine's own comment named it: *"they
   * influence a published ceiling, so by the rule this project set itself they
   * belong in the versioned parameter set where verify-ceiling can find them."*
   *
   * It was not a stylistic gap. A weight message says
   * `bp 3360 · why [SHARED_FUNDING_ROOT, YOUNG_ACCOUNT, CONCENTRATED]`, and no
   * stranger could check that 3360 follows from those three reasons, because
   * the steps were not anywhere readable. Freezing them is what makes a weight
   * REPRODUCIBLE rather than merely published — 0.7 × 0.6 × 0.8 = 0.336.
   *
   * The first five values are exactly what the engine used, so no weight
   * changes by moving them.
   *
   * ## What is new: `unverifiedBp`
   *
   * A counterparty whose funding provenance was never observed and never
   * published used to be weighted INDEPENDENT — full credit — because absent
   * ancestry read as absent relationship. That is the unsafe direction, and the
   * loop attacker went uncaught on its first full run because of it.
   *
   * Publishing observed facts (`graphFact`) closed the case where a funder was
   * once seen and Mirror Node later would not answer. This closes the case
   * where it was never seen at all, where there is nothing to remember.
   *
   * 5000bp — half credit. The reasoning for that number specifically:
   *
   *  - NOT 0. Blocking would turn routine Mirror Node lag into a simultaneous
   *    refusal for every counterparty, which is an outage caused by an indexer
   *    hiccup. The fail-open existed partly for that reason and the reason was
   *    sound; only its magnitude was wrong.
   *  - Not gentler than the unattested discount (6000bp = 60%). "I cannot tell
   *    you who this counterparty is" is a weaker position than "money arrived
   *    without a receipt", so it should not count for more.
   *  - Self-healing, which is what makes a discount this size safe to impose:
   *    the moment provenance IS observed it is published, and a published fact
   *    is never forgotten, so this discount can never apply to the same account
   *    twice. An agent is not permanently penalised for our indexer's bad day.
   *
   * The starter floor still binds for a new or small agent, so this cannot stop
   * one from opening. It shrinks a LARGE agent's ceiling during an outage,
   * which is the correct conservative direction, and recovers on its own.
   */
  weights: {
    reciprocalBp: 5000,
    reciprocalThresholdBp: 2500,
    sharedRootBp: 7000,
    youngBp: 6000,
    concentratedBp: 8000,
    unverifiedBp: 5000,
  },
})
