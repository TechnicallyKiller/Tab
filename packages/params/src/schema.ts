import { z } from 'zod'

/**
 * The shape of a parameter set.
 *
 * Exists so a new version cannot quietly omit a field. `verify-ceiling`
 * recomputes a published ceiling and compares hashes; that only means anything
 * if the recomputation used byte-identical inputs, so a v2 that forgot
 * `concentrationCapBp` must fail at import rather than silently recompute a
 * different number.
 *
 * Every field is required. There are no defaults here on purpose — a default is
 * a parameter nobody chose, and this package exists to make every number a
 * deliberate, recorded decision.
 */

const basisPoints = z.number().int().min(0).max(1_000_000)
const microUsdc = z.string().regex(/^\d+\.\d{6}$/, 'six decimal places, as a string')
const rounding = z.enum(['down', 'up', 'half-up'])

export const tier = z.enum(['A', 'B', 'C', 'Unrated'])
export type Tier = z.infer<typeof tier>

export const parameterSet = z.object({
  /** Bumped on ANY change below. Carried on every published ceiling. */
  version: z.number().int().positive(),

  /** Base APR by tier, basis points. Charged on a carried balance. */
  aprBp: z.record(tier, basisPoints),

  /** Ceiling multiple of attested earnings, by tier. Basis points. */
  tierMultipleBp: z.record(tier, basisPoints),

  ramp: z.object({
    /** Where a new tab opens. Earned upward, not granted. */
    startBp: basisPoints,
    /** Added after a clean settlement. */
    cleanStepBp: basisPoints,
    /** Subtracted after a missed one. Asymmetric on purpose: trust is slower
     *  to earn than to lose, and a rail that forgives instantly is a rail an
     *  attacker cycles. */
    missedStepBp: basisPoints,
    minBp: basisPoints,
    maxBp: basisPoints,
    /** Pinned because the ramp compounds. */
    rounding,
  }),

  caps: z.object({
    perCallUsdc: microUsdc,
    perWindowUsdc: microUsdc,
    starterCeilingUsdc: microUsdc,
    /** No single counterparty may be more than this share of attested
     *  earnings. Integer basis points, never a float — 0.4 is not
     *  representable and the comparison flips at exactly 40%. */
    concentrationCapBp: basisPoints,
  }),

  /** Earnings from an unattested counterparty count for less. */
  unattestedDiscountBp: basisPoints,

  /** Account age at which the age factor reaches 1. See the invariant below. */
  ageFullDays: z.number().int().positive(),

  /** Hops of funding ancestry walked when looking for a control cluster. */
  fundingAncestryHops: z.number().int().positive(),

  window: z.object({
    seconds: z.number().int().positive(),
    holdTtlSeconds: z.number().int().positive(),
  }),

  /** Pinned because interest compounds across windows. */
  interestRounding: rounding,
})

export type ParameterSet = z.infer<typeof parameterSet>
