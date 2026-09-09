import { type MicroUsdc, micro } from './micro-usdc.ts'

/**
 * Rates are integer basis points, never decimals. A 0.6 unattested weight is
 * 6000bp; a 6% APR is 600bp; the 40% concentration cap is 4000bp.
 *
 * This matters beyond formatting: `share > 0.4` in floats can flip at exactly
 * 40% depending on how the ratio was computed. `shareBp > 4000` cannot.
 */
export type BasisPoints = number & { readonly __brand: 'BasisPoints' }

export const BP_ONE = 10_000
const BP_ONE_BIG = 10_000n

export function bp(value: number): BasisPoints {
  if (!Number.isInteger(value)) {
    throw new Error(`Basis points must be an integer, received ${value}`)
  }
  return value as BasisPoints
}

/** Build basis points from a ratio at construction time, once, explicitly. */
export function bpFromRatio(numerator: bigint, denominator: bigint): BasisPoints {
  if (denominator === 0n) return bp(0)
  return bp(Number((numerator * BP_ONE_BIG) / denominator))
}

export type Rounding = 'down' | 'up' | 'half-up'

/**
 * Multiply an amount by a rate. The rounding direction is a required argument,
 * because rounding is a decision and a default is an accident that compounds —
 * interest accrual and the ramp factor are both applied repeatedly.
 */
export function mulBp(amount: MicroUsdc, rate: BasisPoints, rounding: Rounding): MicroUsdc {
  const negative = amount < 0n
  const magnitude = negative ? -amount : amount
  const scaled = magnitude * BigInt(rate)

  let result: bigint
  if (rounding === 'down') {
    result = scaled / BP_ONE_BIG
  } else if (rounding === 'up') {
    result = (scaled + BP_ONE_BIG - 1n) / BP_ONE_BIG
  } else {
    result = (scaled + BP_ONE_BIG / 2n) / BP_ONE_BIG
  }
  return micro(negative ? -result : result)
}

/** Format basis points as a percentage: 4000 -> "40.00%". */
export function formatBpPercent(rate: BasisPoints, decimals: 0 | 1 | 2 = 2): string {
  const divisor = 10 ** (2 - decimals)
  const scaled = Math.trunc(rate / divisor)
  const whole = Math.trunc(scaled / 10 ** decimals)
  if (decimals === 0) return `${whole}%`
  const frac = Math.abs(scaled % 10 ** decimals)
    .toString()
    .padStart(decimals, '0')
  return `${whole}.${frac}%`
}

/**
 * Format basis points as a plain decimal: 10000 -> "1.00", 8000 -> "0.80".
 *
 * Used for independence weights. They sit next to a share column that is
 * already a percentage, and two adjacent percentage columns meaning different
 * things is a reliable way to be misread.
 */
export function formatBpDecimal(rate: BasisPoints): string {
  const negative = rate < 0
  const magnitude = Math.abs(rate)
  const whole = Math.trunc(magnitude / BP_ONE)
  const frac = Math.trunc((magnitude % BP_ONE) / 100)
    .toString()
    .padStart(2, '0')
  return `${negative ? '-' : ''}${whole}.${frac}`
}

/** Format basis points as a multiplier: 30000 -> "3.0x". */
export function formatBpMultiple(rate: BasisPoints): string {
  const whole = Math.trunc(rate / BP_ONE)
  const tenths = Math.abs(Math.trunc((rate % BP_ONE) / 1000))
  return `${whole}.${tenths}`
}
