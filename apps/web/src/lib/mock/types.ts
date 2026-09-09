import type { BasisPoints, MicroUsdc } from '../money'

/**
 * Six legs, because the receipt topic has six message types.
 *
 * This listed three. `HOLD`, `REPAIR` and `SETTLEMENT` are on the topic and
 * showing them is not padding: a HOLD row immediately before its DEBIT is the
 * write-ahead ordering visible on screen, which is the property a stranger
 * would otherwise have to take on trust.
 */
export type Leg = 'HOLD' | 'DEBIT' | 'CREDIT' | 'REFUSED' | 'REPAIR' | 'SETTLEMENT'

export interface Receipt {
  /** Consensus timestamp — the real ordering key. */
  consensus: string
  leg: Leg
  counterparty: string
  amount: MicroUsdc
  attested: boolean
  /**
   * Optional, because they are only present once a receipt has been PUBLISHED.
   *
   * They were required, which forced the mock to invent both. Real data has a
   * gap here — an entry the gateway created a moment ago has no HCS sequence
   * number yet — and a UI that cannot render that gap would have to be lied to.
   */
  requestHash?: string
  seq?: number
  /**
   * The window this receipt was filed into.
   *
   * Carried so a view can compute this window's spend from the rows it already
   * has, rather than showing a hardcoded figure — the tab view's "window spend"
   * tile read `0.62 / 1.00` for its entire life. Optional because the mock
   * stream has no windows.
   */
  window?: number
  /** Set only on rows that arrived while the page was open, to drive the flash. */
  flash?: string
}

/*
 * The reason vocabulary comes from `@tab/protocol` via the SDK.
 *
 * This file defined its own: seven names, of which two existed in the system,
 * and no `COMMON_FUNDER` — the rule that actually fires on live data. The
 * console would have rendered reason codes that do not exist, and `chipTone`
 * matched `HARD_BLOCK*`, so every real hard block showed as a mere caution.
 */
export type { WeightReason } from '@tab/sdk'

import type { WeightReason } from '@tab/sdk'

export interface Counterparty {
  id: string
  firstSeen: string
  ageDays: number
  direction: 'buys from' | 'sells to' | 'both'
  volume: MicroUsdc
  /** Share of total volume, in basis points. 4000 = 40.00%. */
  shareBp: BasisPoints
  /** Independence weight, in basis points. 10000 = fully counted, 0 = hard block. */
  weightBp: BasisPoints
  reason: WeightReason
  hops: string[]
}

export type Outcome = 'CLEAN' | 'MISSED' | 'CARRIED'

export interface Settlement {
  window: string
  range: string
  credits: MicroUsdc
  debits: MicroUsdc
  interest: MicroUsdc
  net: MicroUsdc
  /** Ramp factor in basis points. 3000 = 30%. */
  rampFromBp: BasisPoints
  rampToBp: BasisPoints
  outcome: Outcome
  receiptCount: number
  transferId: string
}

export type RefusalRule =
  | 'CONTROL_CLUSTER'
  | 'PER_CALL_CAP'
  | 'CEILING_EXCEEDED'
  | 'WINDOW_CAP'
  | 'SELLER_NOT_ALLOWLISTED'
  | 'TAB_FROZEN'

export interface RefusalEvidence {
  label: string
  tone: 'neutral' | 'bad'
  arrow: string
}

export interface Refusal {
  rule: RefusalRule
  ruleDetail: string
  sentence: string
  consensus: string
  seq: string
  evidence: RefusalEvidence[]
  stamp?: string
}

export interface CeilingRow {
  label: string
  value: string
  emphasis: 'sub' | 'term' | 'total' | 'result'
  /** The constraint that actually bound. The most useful fact on the screen. */
  binding?: boolean
}
