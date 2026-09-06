/**
 * Window bucketing.
 *
 * This lives in `@tab/params` because the gateway and the settlement worker
 * MUST agree on which window a receipt belongs to, and until now each computed
 * it inline. Two copies of `Math.floor(now / windowSeconds)` is fine right up
 * until one of them is handed milliseconds, or a different window length from a
 * different env file — and then the gateway files receipts into window 2981234
 * while the worker settles 2981233 and the tab never settles at all.
 *
 * Pure functions over an explicit timestamp. No clock: the caller passes the
 * time, so a test can settle a window from 2019 without mocking anything.
 */

/** Seconds since the epoch. Not milliseconds — the whole point of the type. */
export type EpochSeconds = number

export function windowOf(atSeconds: EpochSeconds, windowSeconds: number): number {
  if (!Number.isFinite(atSeconds) || atSeconds < 0) {
    throw new Error(`windowOf needs epoch SECONDS, got ${atSeconds}`)
  }
  // A millisecond timestamp is the mistake this catches. Anything past the year
  // 2200 in seconds is almost certainly milliseconds passed by accident, and
  // silently bucketing it produces a window number nothing else will ever match.
  if (atSeconds > 7_258_118_400) {
    throw new Error(
      `windowOf got ${atSeconds}, which is past the year 2200 — that is milliseconds, ` +
        'not seconds. Divide by 1000.',
    )
  }
  if (!Number.isInteger(windowSeconds) || windowSeconds <= 0) {
    throw new Error(`windowSeconds must be a positive integer, got ${windowSeconds}`)
  }
  return Math.floor(atSeconds / windowSeconds)
}

/** First second of a window, inclusive. */
export function windowStart(window: number, windowSeconds: number): EpochSeconds {
  return window * windowSeconds
}

/** First second of the NEXT window — the exclusive end. */
export function windowEnd(window: number, windowSeconds: number): EpochSeconds {
  return (window + 1) * windowSeconds
}

/**
 * A window's bounds as HCS consensus timestamps, for a Mirror Node range.
 *
 * Returned as `[from, to)` matching Mirror's own half-open convention, so a
 * receipt landing exactly on a boundary is counted once rather than in both
 * windows.
 */
export function windowConsensusRange(
  window: number,
  windowSeconds: number,
): { from: string; to: string } {
  return {
    from: `${windowStart(window, windowSeconds)}.000000000`,
    to: `${windowEnd(window, windowSeconds)}.000000000`,
  }
}
