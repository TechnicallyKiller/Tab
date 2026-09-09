import { type MicroUsdc, micro } from '@tab/money'
import { MODEL_VERSION } from '@tab/params'
import type { Binding, CeilingInputs, CeilingResult } from './inputs.ts'

/**
 * The formula.
 *
 *   ceiling = revenue_per_window × tier_multiple × ramp_factor
 *           , floored at the starter floor, clamped by the tier hard cap
 *
 * Every input comes from `CeilingInputs` and nothing else — no clock, no
 * randomness, no map iteration order, no reading a parameter directly. That is
 * what makes `verify-ceiling` possible: same inputs and same MODEL_VERSION give
 * the same result, byte for byte, on a stranger's machine.
 */
export function computeCeiling(inputs: CeilingInputs): CeilingResult {
  /*
   * A DEFAULT is zero, and the floor does not rescue it.
   *
   * Keyed on `hasDefaulted`, NOT on `tier === 'Unrated'`, and the difference is
   * not cosmetic. Both a defaulted tab and a brand-new one read as Unrated, and
   * zeroing on the tier made a new agent unable to ever start: no revenue, so
   * Unrated, so a ceiling of zero, so no way to spend, so no way to EARN the
   * revenue that would rate it. The starter floor existed for exactly that case
   * and was unreachable.
   *
   * Applying the floor to a defaulted tab would be the opposite error — handing
   * back a working ceiling the moment after it proved it could not pay, turning
   * the harshest rule in the product into a brief inconvenience. So: new tabs
   * get the floor, defaulted tabs get zero.
   */
  if (inputs.hasDefaulted) {
    return {
      ceiling: micro(0n),
      binding: 'unrated',
      inputs,
      modelVersion: MODEL_VERSION,
    }
  }

  if (inputs.multipleBp < 0 || inputs.rampBp < 0) {
    throw new Error('tier multiple and ramp factor cannot be negative')
  }
  if (inputs.revenue < 0n) throw new Error('revenue cannot be negative')

  /*
   * Multiply first, divide once. `(revenue × multiple × ramp) / 10000²` rather
   * than two separate divisions: dividing twice truncates twice, and the loss
   * is not symmetric — it is always in the agent's disfavour and compounds with
   * the ramp, so a tab at 15% ramp would be shortchanged more than one at 90%
   * for no reason anybody could explain from the published inputs.
   */
  const computed =
    (inputs.revenue * BigInt(inputs.multipleBp) * BigInt(inputs.rampBp)) / 100_000_000n

  let ceiling = computed
  let binding: Binding = 'computed'

  // The floor lifts a rated tab that has not earned yet. It never lowers one.
  if (ceiling < inputs.starterFloor) {
    ceiling = inputs.starterFloor
    binding = 'starter_floor'
  }

  /*
   * The hard cap binds LAST, and beats the floor.
   *
   * Order matters and this is the order: a cap that could be overridden by the
   * floor is not a cap. If a tier's hard cap is below the starter floor, the
   * cap wins — that combination means the parameters say this tier may not
   * borrow that much, and a floor is not an argument against a limit.
   */
  if (ceiling > inputs.hardCap) {
    ceiling = inputs.hardCap
    binding = 'hard_cap'
  }

  return { ceiling: micro(ceiling), binding, inputs, modelVersion: MODEL_VERSION }
}

/**
 * May a new ceiling be applied mid-window?
 *
 * **Shrinking is a safety action and applies instantly. Growing is a trust
 * action and waits for a clean settlement.**
 *
 * The asymmetry is the whole point. If a ceiling could grow mid-window, the
 * loop attacker's fastest path is: fake some revenue, watch the ceiling rise
 * within the same window, spend against it before anything settles, repeat.
 * Making growth wait for a settlement means every increase is paid for by a
 * window that actually closed and cleared.
 *
 * This package computes a value; it does not decide when to apply it. The
 * engine enforces the transition, and this is the predicate it enforces.
 */
export function mayApplyMidWindow(
  current: MicroUsdc,
  next: MicroUsdc,
): { allowed: boolean; reason: string } {
  if (next < current) {
    return { allowed: true, reason: 'a shrink is a safety action and applies immediately' }
  }
  if (next === current) {
    return { allowed: true, reason: 'unchanged' }
  }
  return {
    allowed: false,
    reason:
      'a ceiling may not GROW mid-window — growth is a trust action and waits for a clean ' +
      'settlement, or an attacker could inflate revenue and spend against the increase before ' +
      'anything cleared',
  }
}
