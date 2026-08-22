import { DECIMALS, type MicroUsdc } from './micro-usdc.ts'

/**
 * Presentation. The ONLY file in the package permitted to touch decimals, and
 * the one the no-float-money guard exempts by name.
 */

const DISPLAY_DECIMALS = 4
const DISPLAY_DIVISOR = 10n ** BigInt(DECIMALS - DISPLAY_DECIMALS)
const DISPLAY_SCALE = 10n ** BigInt(DISPLAY_DECIMALS)

export type SignMode = 'always' | 'negative-only' | 'none'

/**
 * Show 4 of the 6 decimals, TRUNCATED. Never rounds up — the docs promise this
 * ("truncated, not rounded") and a display that rounds while the ledger
 * truncates is how the two quietly disagree.
 *
 * Uses U+2212 MINUS SIGN rather than a hyphen: it is the same width as a digit
 * in tabular figures, so signed columns stay aligned.
 */
export function format(amount: MicroUsdc, opts: { sign?: SignMode } = {}): string {
  const sign = opts.sign ?? 'negative-only'
  const negative = amount < 0n
  const magnitude = negative ? -amount : amount
  const display = magnitude / DISPLAY_DIVISOR
  const whole = display / DISPLAY_SCALE
  const frac = (display % DISPLAY_SCALE).toString().padStart(DISPLAY_DECIMALS, '0')
  const body = `${whole}.${frac}`

  if (sign === 'none') return body
  if (sign === 'always') return `${negative ? '−' : '+'}${body}`
  return negative ? `−${body}` : body
}

/** Full 6-decimal form. This is what goes on the wire and into an HCS message. */
export function toWire(amount: MicroUsdc): string {
  const negative = amount < 0n
  const magnitude = negative ? -amount : amount
  const scale = 10n ** BigInt(DECIMALS)
  const whole = magnitude / scale
  const frac = (magnitude % scale).toString().padStart(DECIMALS, '0')
  return `${negative ? '-' : ''}${whole}.${frac}`
}
