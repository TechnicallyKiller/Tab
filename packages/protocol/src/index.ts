/**
 * @tab/protocol — the wire format for everything Tab publishes to HCS.
 *
 * Schema-only, no I/O. If this package could make a network call, the schema
 * could drift from what we actually publish and nothing would catch it. The
 * gateway writes through these types, the indexer reads through them, and
 * tools/verify — which a stranger runs with no access to our infrastructure —
 * validates against the same file.
 */
export {
  SCHEMA_VERSION,
  amount,
  base,
  basisPoints,
  consensusTimestamp,
  entityId,
  shortHash,
  windowIndex,
  type Base,
} from './common.ts'

export {
  REFUSAL_CODES,
  REFUSAL_GUIDANCE,
  isRetryable,
  type RefusalCode,
} from './refusal-codes.ts'

export { canonicalHash, canonicalize } from './canonical.ts'

export {
  ceilingInputs,
  ceilingUpdate,
  creditReceipt,
  debitReceipt,
  holdReceipt,
  receipt,
  refusalReceipt,
  registration,
  repairReceipt,
  settlement,
  tabMessage,
  type CeilingInputs,
  type CeilingUpdate,
  type CreditReceipt,
  type DebitReceipt,
  type HoldReceipt,
  type Receipt,
  type Registration,
  type RefusalReceipt,
  type RepairReceipt,
  type Settlement,
  type TabMessage,
} from './messages.ts'

export { encode, decode, MAX_MESSAGE_BYTES, type DecodeResult } from './wire.ts'
