/**
 * @tab/ledger — double-entry accounting for a tab.
 *
 * Pure functions over entry lists: holds, position, netting, interest, and the
 * invariants verify-tab runs. No database, no clock — the caller supplies both
 * the entries and `now`, so replay is deterministic and the money math is
 * testable without standing up infrastructure.
 */
export {
  compareConsensus,
  compareEntries,
  inConsensusOrder,
  type ConsensusTimestamp,
  type CreditEntry,
  type DebitEntry,
  type Entry,
  type HoldEntry,
  type InterestEntry,
  type RefusalEntry,
  type RepairEntry,
  type SettlementEntry,
} from './entries.ts'

export {
  canReserve,
  pendingHoldTotal,
  position,
  resolveHolds,
  type HoldState,
  type HoldView,
  type Position,
  type ReserveDecision,
} from './holds.ts'

export {
  SECONDS_PER_YEAR,
  accrue,
  accrueWindow,
  type AccrualInput,
} from './interest.ts'

export {
  RAMP_CLEAN_STEP_BP,
  RAMP_MAX_BP,
  RAMP_MIN_BP,
  RAMP_MISSED_STEP_BP,
  RAMP_START_BP,
  netWindow,
  netWindows,
  planSettlement,
  rampAfter,
  type SettlementOutcome,
  type SettlementPlan,
  type WindowNet,
} from './netting.ts'

export {
  checkAvailableNonNegative,
  checkCommitAmountsMatch,
  checkDebitsHaveHolds,
  checkFloatInvariant,
  checkHoldsCommittedOnce,
  checkLedger,
  checkPublicLedger,
  checkWindowSettledOnce,
  LOCAL_ONLY_INVARIANTS,
  type CheckResult,
  type FloatInvariantInput,
  type Violation,
} from './invariants.ts'

export {
  ceilingsFromMessages,
  entriesFromMessages,
  type PublishedCeiling,
  type Replay,
  type TopicMessage,
} from './replay.ts'
