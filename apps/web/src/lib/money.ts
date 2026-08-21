/**
 * Money for the frontend.
 *
 * USDC on Hedera has 6 decimals, so an amount is an integer count of
 * micro-USDC carried as a bigint. The design prototype used JS floats; this
 * does not, because ADR-0006 makes the rule repo-wide and a display layer that
 * rounds differently from the ledger is how "reconciles to the cent" stops
 * being true on screen.
 *
 * Display shows 4 of the 6 decimals and TRUNCATES. It never rounds up —
 * the docs state this explicitly, so the code has to mean it.
 */

export type MicroUsdc = bigint & { readonly __brand: 'MicroUsdc' }

const SCALE = 1_000_000n
const DISPLAY_DIVISOR = 100n // 6dp -> 4dp

export function micro(raw: bigint): MicroUsdc {
  return raw as MicroUsdc
}

/** Parse a decimal string like "-0.4821" or "1.0000". No floats involved. */
export function usdc(decimal: string): MicroUsdc {
  const trimmed = decimal.trim()
  const negative = trimmed.startsWith('-') || trimmed.startsWith('−')
  const digits = negative ? trimmed.slice(1) : trimmed
  const [whole = '0', frac = ''] = digits.split('.')
  const padded = (frac + '000000').slice(0, 6)
  const total = BigInt(whole) * SCALE + BigInt(padded)
  return micro(negative ? -total : total)
}

export function add(a: MicroUsdc, b: MicroUsdc): MicroUsdc {
  return micro(a + b)
}

export function sub(a: MicroUsdc, b: MicroUsdc): MicroUsdc {
  return micro(a - b)
}

/** Available balance can never be shown negative — a hold already reserved it. */
export function atLeastZero(a: MicroUsdc): MicroUsdc {
  return micro(a > 0n ? a : 0n)
}

export function abs(a: MicroUsdc): MicroUsdc {
  return micro(a < 0n ? -a : a)
}

export function isNegative(a: MicroUsdc): boolean {
  return a < 0n
}

/** Basis-point multiply, truncating toward zero. Rounding is explicit. */
export function mulBp(amount: MicroUsdc, bp: number): MicroUsdc {
  const sign = amount < 0n ? -1n : 1n
  return micro((sign * ((amount < 0n ? -amount : amount) * BigInt(bp))) / 10_000n)
}

/**
 * Format to 4 decimals, truncated. `sign: 'always'` prefixes + or the real
 * minus sign U+2212, which aligns in tabular figures where a hyphen does not.
 */
export function format(
  amount: MicroUsdc,
  opts: { sign?: 'always' | 'negative-only' | 'none' } = {},
): string {
  const sign = opts.sign ?? 'negative-only'
  const negative = amount < 0n
  const magnitude = negative ? -amount : amount
  const display = magnitude / DISPLAY_DIVISOR // truncate, never round
  const whole = display / 10_000n
  const frac = (display % 10_000n).toString().padStart(4, '0')
  const body = `${whole}.${frac}`
  if (sign === 'none') return body
  if (sign === 'always') return `${negative ? '−' : '+'}${body}`
  return negative ? `−${body}` : body
}

/** Percentage of a ceiling, clamped to [0,100], for meter widths. */
export function pctOf(part: MicroUsdc, whole: MicroUsdc): number {
  if (whole <= 0n) return 0
  const raw = Number((abs(part) * 10_000n) / whole) / 100
  return Math.max(0, Math.min(100, raw))
}
