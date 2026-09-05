import { mulBp, type BasisPoints, type MicroUsdc } from '@tab/money'

/**
 * Interest on carried outstanding.
 *
 * Only charged on a window the agent did not settle. Rounding is DOWN
 * throughout, so an inexact accrual resolves in the agent's favour — the house
 * can afford to under-charge by a micro-USDC; over-charging is a number the
 * operator cannot explain.
 *
 * Interest compounds across windows, so a rounding direction chosen twice
 * differently diverges slowly and breaks `verify-tab` in a way that is very
 * hard to trace. It is fixed here, once.
 */

/** Base APR per tier, in basis points. 600 = 6%. */
export const TIER_APR_BP: Record<string, BasisPoints> = {
  A: 600 as BasisPoints,
  B: 850 as BasisPoints,
  C: 1200 as BasisPoints,
  // Unrated has no ceiling, so it can hold no new outstanding — but a tab that
  // collapsed to Unrated may still be carrying a balance from before, and that
  // balance still accrues at the worst rate.
  Unrated: 1200 as BasisPoints,
}

export const SECONDS_PER_YEAR = 31_536_000n

export interface AccrualInput {
  /** Positive. What is owed at the start of the window. */
  outstanding: MicroUsdc
  aprBp: BasisPoints
  /** Length of the accrual period. Partial windows are normal at settlement. */
  seconds: number
}

/**
 * Simple interest for a period, truncated toward zero.
 *
 * Not compounded within a window — a window is minutes, and pro-rating simple
 * interest is what an operator can check by hand. Compounding happens across
 * windows because each one accrues on the new outstanding.
 */
export function accrue({ outstanding, aprBp, seconds }: AccrualInput): MicroUsdc {
  if (outstanding <= 0n) return 0n as MicroUsdc
  if (seconds <= 0) return 0n as MicroUsdc

  // (outstanding × apr × seconds) / (10000 × secondsPerYear), truncated.
  const annual = mulBp(outstanding, aprBp, 'down')
  const scaled = (annual * BigInt(Math.floor(seconds))) / SECONDS_PER_YEAR
  return scaled as MicroUsdc
}

/** What a full window costs at this rate. Used to show a projected cost. */
export function accrueWindow(
  outstanding: MicroUsdc,
  aprBp: BasisPoints,
  windowSeconds: number,
): MicroUsdc {
  return accrue({ outstanding, aprBp, seconds: windowSeconds })
}
