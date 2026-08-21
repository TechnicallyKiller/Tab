import { usdc } from '../money'
import type { CeilingRow, ConfigRow } from './types'

export const AGENT_ID = '0.0.4482091'
export const MODEL_VERSION = 'ceiling-v0.4.1'
export const WINDOW_LABEL = '0148'
export const WINDOW_SECONDS = 600
export const MAX_SNAPSHOT_AGE_S = 15

export const TOPICS = {
  receipts: '0.0.4881203',
  ceilings: '0.0.4881204',
  float: '0.0.4881190',
}

export const CEILING = usdc('1.0000')
export const PER_CALL_CAP = usdc('0.0500')
export const OPENING_BALANCE = usdc('-0.4821')
export const HOLDS = usdc('0.0900')

export const INPUT_HASH =
  '9f2c41b0d7e8a35c1146bb90ee2d7a04c8f31d5b6e07a9224fbb1c0d3e5a7788'
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

export const STARTER_TAB = [
  { k: 'ceiling', v: '1.0000' },
  { k: 'per-call cap', v: '0.0500' },
  { k: 'sellers', v: 'allowlist' },
  { k: 'graduates', v: 'first clean settlement' },
]

export const CONFIG_GROUPS: { name: string; rows: ConfigRow[] }[] = [
  {
    name: 'Credit',
    rows: [
      { key: 'CEILING_MODEL', value: MODEL_VERSION },
      { key: 'STARTER_CEILING', value: '1.0000' },
      { key: 'HARD_CAP_C', value: '2.0000' },
      { key: 'RAMP_STEP_CLEAN', value: '+15%' },
      { key: 'RAMP_STEP_MISSED', value: '−30%' },
    ],
  },
  {
    name: 'Independence',
    rows: [
      { key: 'MAX_FUNDING_HOPS', value: '3' },
      { key: 'CONCENTRATION_CAP', value: '40.00%' },
      // Stated, not hidden. On testnet every account is young, so a naive age
      // factor rejects everyone.
      { key: 'AGE_FULL_DAYS', value: '3', overridden: true },
      { key: 'UNATTESTED_WEIGHT', value: '0.6' },
    ],
  },
  {
    name: 'Windows',
    rows: [
      { key: 'WINDOW_SECONDS', value: '600' },
      { key: 'SETTLE_MODE', value: 'scheduled_tx' },
      { key: 'MAX_SNAPSHOT_AGE_S', value: '15' },
      { key: 'PER_CALL_CAP', value: '0.0500' },
    ],
  },
]

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
