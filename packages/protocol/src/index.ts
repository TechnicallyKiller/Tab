/**
 * @tab/protocol — the wire format for everything Tab publishes to HCS.
 *
 * Schema-only, no I/O. If this package could make a network call, the schema
 * could drift from what we actually publish and nothing would catch it. The
 * gateway writes through these types, the indexer reads through them, and
 * tools/verify — which a stranger runs with no access to our infrastructure —
 * validates against the same file.
 */

export { canonicalHash, canonicalize } from './canonical.ts'
export {
  amount,
  type Base,
  base,
  basisPoints,
  consensusTimestamp,
  entityId,
  SCHEMA_VERSION,
  shortHash,
  windowIndex,
} from './common.ts'
export {
  base58,
  type Hcs14Agent,
  hcs14Aid,
  hcs14Canonical,
  hcs14Uaid,
  tabAgent,
} from './hcs14.ts'
export {
  type CeilingInputs,
  type CeilingUpdate,
  type CreditReceipt,
  ceilingInputs,
  ceilingUpdate,
  creditReceipt,
  type DebitReceipt,
  debitReceipt,
  type GraphFact,
  graphFact,
  type HoldReceipt,
  holdReceipt,
  type Receipt,
  type RefusalReceipt,
  type Registration,
  type RepairReceipt,
  receipt,
  refusalReceipt,
  registration,
  repairReceipt,
  type Settlement,
  settlement,
  type TabMessage,
  tabMessage,
  type WeightUpdate,
  weightUpdate,
} from './messages.ts'
export {
  isRetryable,
  REFUSAL_CODES,
  REFUSAL_GUIDANCE,
  type RefusalCode,
} from './refusal-codes.ts'
export {
  BLOCKING_REASONS,
  isBlocking,
  WEIGHT_REASON_DETAIL,
  WEIGHT_REASONS,
  type WeightReason,
} from './weight-reasons.ts'
export { type DecodeResult, decode, encode, MAX_MESSAGE_BYTES } from './wire.ts'
