/**
 * @tab/mirror — typed Hedera Mirror Node REST client.
 *
 * Background use ONLY. boundaries.json forbids @tab/fastpath from depending on
 * this package: one history call inside a path budgeted under 50ms spends the
 * whole budget, and the README calls that a hard rule rather than a target.
 *
 * Every shape here was transcribed from live testnet responses, not from docs.
 */

export {
  accountAgeDays,
  canReceiveToken,
  consensusToMillis,
  decimalsOf,
  getAccount,
  getBalanceSnapshot,
  getToken,
  getTokenRelationship,
  getUsdcBalance,
  type ReceiveCheck,
  waitForAccount,
} from './accounts.ts'
export {
  compareConsensus,
  MIRROR_URLS,
  MirrorClient,
  type MirrorConfig,
  MirrorError,
  type Network,
  type PageWalk,
  timestampRange,
} from './client.ts'
export { configureGlobalHttp } from './http.ts'
export {
  getSchedule,
  type MirrorSchedule,
  waitForScheduleExecution,
} from './schedules.ts'
export {
  type AssembledMessage,
  decodeUtf8,
  readTopic,
  reassembleChunks,
  type TopicQuery,
} from './topics.ts'
export {
  getTransactionAt,
  getTransactions,
  type HistoryQuery,
  hbarNetFor,
  normalizeTransactionId,
  outboundFrom,
  sameTransaction,
  type TransferEdge,
  toTransferEdges,
} from './transfers.ts'
export type * from './types.ts'
