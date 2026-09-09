import { type BasisPoints, type MicroUsdc, mulBp } from '@tab/money'

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

/*
 * The APR table used to live here. It now lives in `@tab/params`, which is
 * where every tunable number belongs — parameters are versioned because
 * `verify-ceiling` must recompute a published ceiling from byte-identical
 * inputs, and this package cannot import params (boundaries.json: ledger sees
 * only money and protocol).
 *
 * That boundary is the point, not an obstacle: `accrue` takes `aprBp` as an
 * ARGUMENT. Ledger does the arithmetic and never decides the policy, so a rate
 * change is a params version bump and touches no math.
 */

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
