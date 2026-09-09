/**
 * @tab/ledger — double-entry accounting for a tab.
 *
 * Pure functions over entry lists: holds, position, netting, interest, and the
 * invariants verify-tab runs. No database, no clock — the caller supplies both
 * the entries and `now`, so replay is deterministic and the money math is
 * testable without standing up infrastructure.
 */
export {
  type ConsensusTimestamp,
  type CreditEntry,
  compareConsensus,
  compareEntries,
  type DebitEntry,
  type Entry,
  type HoldEntry,
  type InterestEntry,
  inConsensusOrder,
  type RefusalEntry,
  type RepairEntry,
  type SettlementEntry,
} from './entries.ts'

export {
  canReserve,
  type HoldState,
  type HoldView,
  type Position,
  pendingHoldTotal,
  position,
  type ReserveDecision,
  resolveHolds,
} from './holds.ts'

export {
  type AccrualInput,
  accrue,
  accrueWindow,
  SECONDS_PER_YEAR,
} from './interest.ts'
export {
  type CheckResult,
  checkAvailableNonNegative,
  checkCommitAmountsMatch,
  checkDebitsHaveHolds,
  checkFloatInvariant,
  checkHoldsCommittedOnce,
  checkLedger,
  checkPublicLedger,
  checkWindowSettledOnce,
  type FloatInvariantInput,
  LOCAL_ONLY_INVARIANTS,
  type Violation,
} from './invariants.ts'
export {
  netWindow,
  netWindows,
  planSettlement,
  RAMP_CLEAN_STEP_BP,
  RAMP_MAX_BP,
  RAMP_MIN_BP,
  RAMP_MISSED_STEP_BP,
  RAMP_START_BP,
  rampAfter,
  type SettlementOutcome,
  type SettlementPlan,
  type WindowNet,
} from './netting.ts'

export {
  ceilingHistoryFromMessages,
  ceilingsFromMessages,
  entriesFromMessages,
  type FactsReplay,
  factsFromMessages,
  type PublishedCeiling,
  type PublishedCeilingInputs,
  type PublishedWeight,
  type Registration,
  type RegistrationReplay,
  type RememberedFacts,
  type Replay,
  registrationsFromMessages,
  starterGrantFor,
  type TopicMessage,
  weightsFromMessages,
} from './replay.ts'
