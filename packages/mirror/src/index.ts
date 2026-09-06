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
  MirrorClient,
  MirrorError,
  MIRROR_URLS,
  compareConsensus,
  timestampRange,
  type MirrorConfig,
  type Network,
  type PageWalk,
} from './client.ts'

export {
  accountAgeDays,
  canReceiveToken,
  consensusToMillis,
  getAccount,
  getToken,
  getTokenRelationship,
  getBalanceSnapshot,
  getUsdcBalance,
  waitForAccount,
  type ReceiveCheck,
} from './accounts.ts'

export {
  getTransactionAt,
  getTransactions,
  hbarNetFor,
  normalizeTransactionId,
  sameTransaction,
  outboundFrom,
  toTransferEdges,
  type HistoryQuery,
  type TransferEdge,
} from './transfers.ts'

export {
  decodeUtf8,
  readTopic,
  reassembleChunks,
  type AssembledMessage,
  type TopicQuery,
} from './topics.ts'

export type * from './types.ts'

export {
  getSchedule,
  waitForScheduleExecution,
  type MirrorSchedule,
} from './schedules.ts'

export { configureGlobalHttp } from './http.ts'
