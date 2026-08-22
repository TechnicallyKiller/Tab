import { micro, type MicroUsdc } from '@tab/money'
import { compareConsensus, timestampRange, type MirrorClient, type PageWalk } from './client.ts'
import type { ConsensusTimestamp, EntityId, MirrorTransaction, TransactionsPage } from './types.ts'

/** One directed movement of a token between two accounts. The graph's edge. */
export interface TransferEdge {
  consensusTimestamp: ConsensusTimestamp
  transactionId: string
  tokenId: EntityId
  from: EntityId
  to: EntityId
  amount: MicroUsdc
}

export interface HistoryQuery {
  accountId: EntityId
  tokenId?: EntityId
  from?: ConsensusTimestamp
  to?: ConsensusTimestamp
  /** Mirror Node caps this at 100. */
  pageSize?: number
}

/**
 * Every successful CRYPTOTRANSFER touching an account in a timestamp range.
 *
 * Failed transactions are returned by the API and are filtered here: a reverted
 * transfer never moved value, and counting one would put a phantom edge in the
 * independence graph.
 */
export async function getTransactions(
  client: MirrorClient,
  query: HistoryQuery,
): Promise<PageWalk<MirrorTransaction>> {
  const params = [
    `account.id=${query.accountId}`,
    'transactiontype=CRYPTOTRANSFER',
    `limit=${Math.min(query.pageSize ?? 100, 100)}`,
    'order=asc',
    ...timestampRange(query.from, query.to),
  ]
  const walk = await client.walk<MirrorTransaction>(
    `/api/v1/transactions?${params.join('&')}`,
    (body) => (body as unknown as TransactionsPage).transactions ?? [],
  )
  return { ...walk, items: walk.items.filter((t) => t.result === 'SUCCESS') }
}

/**
 * Turn transactions into directed edges for one token.
 *
 * Hedera transfer lists are net-settled per transaction: several accounts may
 * be debited and several credited in one transfer. Pairing is proportional —
 * each sender funds each receiver in proportion to what it put in — so the
 * amounts on the edges always sum back to the total moved.
 */
export function toTransferEdges(
  transactions: readonly MirrorTransaction[],
  tokenId: EntityId,
): TransferEdge[] {
  const edges: TransferEdge[] = []

  for (const tx of transactions) {
    const entries = (tx.token_transfers ?? []).filter((t) => t.token_id === tokenId)
    if (entries.length === 0) continue

    const senders = entries.filter((e) => e.amount < 0).map((e) => ({ id: e.account, amount: -BigInt(e.amount) }))
    const receivers = entries.filter((e) => e.amount > 0).map((e) => ({ id: e.account, amount: BigInt(e.amount) }))
    const totalSent = senders.reduce((sum, s) => sum + s.amount, 0n)
    if (totalSent === 0n) continue

    for (const sender of senders) {
      for (const receiver of receivers) {
        // Proportional split, truncated. Dust from truncation is dropped rather
        // than assigned arbitrarily; the common 1:1 case is exact.
        const amount = (receiver.amount * sender.amount) / totalSent
        if (amount === 0n) continue
        edges.push({
          consensusTimestamp: tx.consensus_timestamp,
          transactionId: tx.transaction_id,
          tokenId,
          from: sender.id,
          to: receiver.id,
          amount: micro(amount),
        })
      }
    }
  }

  return edges.sort((a, b) => compareConsensus(a.consensusTimestamp, b.consensusTimestamp))
}

/** Outbound edges only — what the reconciler diffs against the receipt topic. */
export function outboundFrom(edges: readonly TransferEdge[], accountId: EntityId): TransferEdge[] {
  return edges.filter((e) => e.from === accountId)
}
