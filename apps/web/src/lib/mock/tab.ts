import { usdc } from '../money'
import type { CeilingRow } from './types'

export const AGENT_ID = '0.0.4482091'
export const WINDOW_LABEL = '0148'
export const WINDOW_SECONDS = 600
export const MAX_SNAPSHOT_AGE_S = 15

export const CEILING = usdc('1.0000')
export const PER_CALL_CAP = usdc('0.0500')
export const OPENING_BALANCE = usdc('-0.4821')
export const HOLDS = usdc('0.0900')

export const INPUT_HASH = '9f2c41b0d7e8a35c1146bb90ee2d7a04c8f31d5b6e07a9224fbb1c0d3e5a7788'
export const CEILING_SEQ = 41862

/**
 * The ceiling inputs, exactly as the CEILING view publishes them. Rule weight
 * carries the arithmetic: hairline for sub-terms, 2.5px for the total, double
 * rule before the result.
 */
export const CEILING_ROWS: CeilingRow[] = [
  { label: 'Trailing attested revenue / window', value: '0.3340', emphasis: 'term' },
  { label: '├ attested inflows × 1.0', value: '0.3340', emphasis: 'sub' },
  { label: '└ unattested inflows × 0.6', value: '0.0000', emphasis: 'sub' },
  { label: 'Tier multiple · C', value: '1.0×', emphasis: 'sub' },
  { label: 'Ramp factor', value: '30%', emphasis: 'total' },
  { label: 'Computed', value: '0.3340', emphasis: 'term' },
  { label: 'Hard cap, tier C', value: '2.0000', emphasis: 'sub' },
  { label: 'Starter floor', value: '1.0000', emphasis: 'sub', binding: true },
  { label: 'CEILING IN FORCE', value: '1.0000', emphasis: 'result' },
]

export const BINDING_NOTE =
  'the starter floor, not the computed value, is what the agent spends against'

/** Stepped, because a ceiling changes discretely. A smooth curve would lie. */
export const CEILING_HISTORY = {
  path:
    'M66 120 L172 120 L278 120 L278 106 L384 106 L384 78 L490 78 L490 210 ' +
    'L544 210 L544 120 L650 120 L650 92 L706 92',
  endpoint: { x: 706, y: 92 },
  annotations: [
    { x: 284, y: 100, text: 'clean +15%', tone: 'muted' as const },
    { x: 390, y: 72, text: 'clean +15%', tone: 'muted' as const },
    { x: 496, y: 228, text: 'control cluster → 0', tone: 'debit' as const },
    { x: 550, y: 114, text: 'starter floor restored', tone: 'muted' as const },
  ],
}
