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

  /**
   * The independence discount steps, in basis points of the RUNNING weight.
   *
   * These decide every published weight, and they lived in
   * `apps/engine/src/recompute.ts` until v3 — five numbers that determine a
   * ceiling, sitting outside the versioned set that `verify-ceiling` resolves.
   * The engine's own comment named it as a gap: *"they influence a published
   * ceiling, so by the rule this project set itself they belong in the
   * versioned parameter set."*
   *
   * It is not a stylistic gap. A published weight message says
   * `bp 3360 · why [SHARED_FUNDING_ROOT, YOUNG_ACCOUNT, CONCENTRATED]`, and a
   * stranger could not check that 3360 followed from those three reasons
   * because the steps were not anywhere they could read. Freezing them here is
   * what makes a weight reproducible rather than merely published.
   *
   * Discounts MULTIPLY and truncate DOWN, in the fixed order declared by
   * `@tab/graph`'s ORDER. Multiplication commutes but integer truncation does
   * not, so the ORDER is part of the frozen model too — changing it changes
   * results by a micro-unit and needs a version bump exactly as these numbers
   * do.
   */
  /*
   * THE ONE OPTIONAL FIELD, and the exception needs its reason on the record.
   *
   * This schema's rule is that every field is required, because a default is a
   * parameter nobody chose. `weights` is optional anyway — because v1 and v2
   * genuinely did not have a frozen weight policy. It lived in the engine.
   *
   * Back-filling it into those sets would be rewriting history: it would claim
   * a weight published under `tab-v1` is reproducible from the frozen record
   * when it is not. Absence is the accurate representation, and a consumer that
   * needs the policy must report a pre-v3 weight as NOT VERIFIABLE rather than
   * checking it against numbers that were not in force as parameters.
   *
   * Same principle as the settlement gross legs and an unpublished tier: absent
   * means not published, never a default.
   */
  weights: z
    .object({
      /** Value flows back toward the agent above the reciprocity threshold. */
      reciprocalBp: basisPoints,
      /** Reciprocity ratio at which that discount applies. */
      reciprocalThresholdBp: basisPoints,
      /** Funded from the same root as the agent within the hop limit. */
      sharedRootBp: basisPoints,
      /** Account younger than `ageFullDays`. */
      youngBp: basisPoints,
      /** Over `caps.concentrationCapBp` of the agent's total. */
      concentratedBp: basisPoints,
      /**
       * No funding provenance observed or published — the rules could not be
       * asked. A discount, never a block: see `UNVERIFIED_FUNDING`.
       */
      unverifiedBp: basisPoints,
    })
    .optional(),

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
