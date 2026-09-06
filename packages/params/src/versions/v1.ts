import { parameterSet, type ParameterSet } from '../schema.ts'

/**
 * v1 — FROZEN.
 *
 * Do not edit a number in this file. A ceiling published under v1 carries
 * `model: 1`, and `verify-ceiling` recomputes it from exactly these values; if
 * they change, every historical ceiling becomes unverifiable and the audit
 * trail is worthless. To change a parameter, add `v2.ts` and bump
 * `MODEL_VERSION`. v1 stays here forever.
 *
 * The snapshot test in `params.test.ts` fails if any of this changes, which is
 * the entire point of the package.
 */
export const v1: ParameterSet = parameterSet.parse({
  version: 1,

  // Unrated pays the C rate. An unrated agent is not given the benefit of the
  // doubt — the rail's whole claim is that credit is earned, and defaulting an
  // unknown agent to a cheap rate would hand a fresh account the best terms.
  aprBp: { A: 600, B: 850, C: 1200, Unrated: 1200 },

  // Ceiling as a multiple of attested earnings. 10000bp = 1x.
  tierMultipleBp: { A: 30_000, B: 20_000, C: 12_500, Unrated: 10_000 },

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
    starterCeilingUsdc: '1.000000',
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
