import { type MicroUsdc, micro } from '@tab/money'

/**
 * Effective revenue: attested and unattested, averaged over trailing windows.
 *
 * "Attested" means the inflow has a matching HCS gateway receipt — we served a
 * request and recorded it at the time. Unattested means money arrived and
 * nobody can prove a purchase happened. Both are real money; only one is
 * evidence of demand, and it is demand that a ceiling is extended against.
 *
 * The discount is not a fraud accusation. An unattested inflow is most often a
 * refund, a top-up, or a payer routing around the gateway. It is simply worth
 * less as proof, and a Sybil ring can manufacture unattested inflows for the
 * cost of gas.
 */

export interface WindowRevenue {
  window: number
  attested: MicroUsdc
  unattested: MicroUsdc
}

export interface EffectiveRevenue {
  /** Weighted revenue per window, averaged over the trailing set. */
  perWindow: MicroUsdc
  attested: MicroUsdc
  unattested: MicroUsdc
  /** How many windows were averaged over. */
  windows: number
}

/**
 * Average weighted revenue per window over the trailing `windowCount`.
 *
 * @param history            per-window revenue, any order.
 * @param windowCount        how many trailing windows to average over.
 * @param unattestedDiscountBp  from `@tab/params`. 6000 = counts at 60%.
 */
export function effectiveRevenue(
  history: readonly WindowRevenue[],
  windowCount: number,
  unattestedDiscountBp: number,
): EffectiveRevenue {
  if (!Number.isInteger(windowCount) || windowCount <= 0) {
    throw new Error(`windowCount must be a positive integer, got ${windowCount}`)
  }

  /*
   * Sorted by window number, then take the last N.
   *
   * Explicitly rather than trusting caller order: this must be deterministic,
   * and "the trailing 6 windows" computed from a differently-ordered array
   * would produce a different ceiling from the same facts — which
   * `verify-ceiling` would report as a mismatch that looks like fraud.
   */
  const trailing = [...history].sort((a, b) => a.window - b.window).slice(-windowCount)

  if (trailing.length === 0) {
    return { perWindow: micro(0n), attested: micro(0n), unattested: micro(0n), windows: 0 }
  }

  let attested = 0n
  let unattested = 0n
  for (const w of trailing) {
    if (w.attested < 0n || w.unattested < 0n) {
      throw new Error(`window ${w.window} has negative revenue — revenue cannot be negative`)
    }
    attested += w.attested
    unattested += w.unattested
  }

  const discounted = (unattested * BigInt(unattestedDiscountBp)) / 10_000n

  /*
   * Divided by `windowCount`, NOT by how many windows had activity.
   *
   * An agent that earned in one window out of six has a lower run-rate than one
   * that earned the same amount in each of six, and dividing by the count of
   * non-empty windows would rate them identically. It would also hand an
   * attacker a trivial lever: earn once, report a single-window average, borrow
   * against a run-rate that never existed.
   *
   * Truncating, so a partial micro-unit is never credited.
   */
  const perWindow = (attested + discounted) / BigInt(windowCount)

  return {
    perWindow: micro(perWindow),
    attested: micro(attested),
    unattested: micro(unattested),
    windows: trailing.length,
  }
}
