import type { MicroUsdc } from '@tab/money'
import type { Tier } from '@tab/params'

/**
 * The contract: if it is not in here, it may not affect the ceiling.
 *
 * `verify-ceiling` claims a stranger can recompute a published ceiling and
 * check the hash. A stranger has HCS, the public Mirror Node and this repo —
 * they do not have our Postgres and they do not have our clock. So every number
 * that influences the result is published in the HCS ceiling message, and this
 * type is what gets published.
 *
 * The rule has teeth in one direction only, and it is the direction that
 * matters: adding a field here is cheap, but reading anything NOT here inside
 * `computeCeiling` silently breaks the transparency claim, and nobody finds out
 * until someone tries to verify — which, at a hackathon, is a judge.
 */
export interface CeilingInputs {
  /** Trailing attested revenue per window, after weighting. */
  revenue: MicroUsdc
  /** The split, so the unattested discount is auditable rather than asserted. */
  attested: MicroUsdc
  unattested: MicroUsdc
  tier: Tier
  /** Tier multiple, basis points. 10000 = 1.0x. */
  multipleBp: number
  /** Ramp factor, basis points. 3000 = 30%. */
  rampBp: number
  /** Hard cap for the tier. */
  hardCap: MicroUsdc
  /** Starter floor. Applied to any non-defaulted tab, including a new one. */
  starterFloor: MicroUsdc
  /**
   * Has this tab ever missed a settlement it was asked to make?
   *
   * The one input that forces a ceiling of exactly zero. Deliberately separate
   * from `tier === 'Unrated'`, because being new and having defaulted are not
   * the same thing and must not produce the same ceiling.
   */
  hasDefaulted: boolean
}

/**
 * Which constraint actually bound.
 *
 * The most useful fact on the screen, and the one an operator asks first: not
 * "what is my ceiling" but "what is holding it there". A number with no cause
 * gives nobody anything to act on.
 */
export type Binding = 'computed' | 'hard_cap' | 'starter_floor' | 'unrated'

export interface CeilingResult {
  ceiling: MicroUsdc
  binding: Binding
  inputs: CeilingInputs
  /** The set these numbers were computed under. Without it, unverifiable. */
  modelVersion: number
}
