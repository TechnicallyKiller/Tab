/**
 * USDC on Hedera has 6 decimals — confirmed by HEDERA_USDC_DECIMALS exported
 * from @x402/hedera. Every amount is an integer count of micro-USDC carried as
 * a bigint, behind a branded type so a raw bigint (a timestamp, a sequence
 * number, a hop count) cannot be passed where an amount belongs.
 *
 * See docs/adr/0006-money-as-bigint.md.
 */

export type MicroUsdc = bigint & { readonly __brand: 'MicroUsdc' }

export const DECIMALS = 6
const SCALE = 1_000_000n

/** Construct from a raw micro-USDC count. The only widening cast in the package. */
export function micro(raw: bigint): MicroUsdc {
  return raw as MicroUsdc
}

export const ZERO: MicroUsdc = micro(0n)

/**
 * Parse a decimal string: "1.0000", "-0.4821", "0.018000".
 * Accepts both ASCII hyphen and U+2212 minus, since the formatter emits U+2212.
 * Digits beyond 6 decimal places are truncated, never rounded.
 */
export function usdc(decimal: string): MicroUsdc {
  const trimmed = decimal.trim()
  if (!/^[-−+]?\d*(\.\d*)?$/.test(trimmed) || trimmed === '') {
    throw new Error(`Not a decimal amount: ${JSON.stringify(decimal)}`)
  }
  const negative = trimmed.startsWith('-') || trimmed.startsWith('−')
  const digits = /^[-−+]/.test(trimmed) ? trimmed.slice(1) : trimmed
  const [whole = '0', frac = ''] = digits.split('.')
  const padded = (frac + '000000').slice(0, DECIMALS)
  const total = BigInt(whole || '0') * SCALE + BigInt(padded || '0')
  return micro(negative ? -total : total)
}

export function add(a: MicroUsdc, b: MicroUsdc): MicroUsdc {
  return micro(a + b)
}

export function sub(a: MicroUsdc, b: MicroUsdc): MicroUsdc {
  return micro(a - b)
}

export function neg(a: MicroUsdc): MicroUsdc {
  return micro(-a)
}

export function abs(a: MicroUsdc): MicroUsdc {
  return micro(a < 0n ? -a : a)
}

export function min(a: MicroUsdc, b: MicroUsdc): MicroUsdc {
  return micro(a < b ? a : b)
}

export function max(a: MicroUsdc, b: MicroUsdc): MicroUsdc {
  return micro(a > b ? a : b)
}

/** Available balance is never shown negative — a hold already reserved it. */
export function atLeastZero(a: MicroUsdc): MicroUsdc {
  return micro(a > 0n ? a : 0n)
}

export function isNegative(a: MicroUsdc): boolean {
  return a < 0n
}

export function isZero(a: MicroUsdc): boolean {
  return a === 0n
}

/** Fold a list. Order-independent by construction, unlike a float sum. */
export function sum(amounts: readonly MicroUsdc[]): MicroUsdc {
  let total = 0n
  for (const a of amounts) total += a
  return micro(total)
}
