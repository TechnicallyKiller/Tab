import type { BasisPoints, MicroUsdc } from '../money'

export type Leg = 'DEBIT' | 'CREDIT' | 'REFUSED'

export interface Receipt {
  consensus: string
  leg: Leg
  counterparty: string
  amount: MicroUsdc
  attested: boolean
  requestHash: string
  seq: number
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
