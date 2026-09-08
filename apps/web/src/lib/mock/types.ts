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
  /** Set only on rows that arrived while the page was open, to drive the flash. */
  flash?: string
}

export type WeightReason =
  | 'INDEPENDENT'
  | 'AGE_DISCOUNT'
  | 'SHARED_ROOT'
  | 'RECIPROCAL_FLOW'
  | 'CONCENTRATION'
  | 'HARD_BLOCK_ANCESTRY'
  | 'HARD_BLOCK_SOLE_COUNTERPARTY'

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

export interface ConfigRow {
  key: string
  value: string
  overridden?: boolean
}
