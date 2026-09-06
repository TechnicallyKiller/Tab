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

/**
 * Fetch the single transaction at an exact consensus timestamp.
 *
 * Use this to assert what a transaction actually DID, rather than diffing
 * account balances. Two reasons balances are the wrong tool:
 *
 *  - Mirror Node account balances are SNAPSHOTS. `balance.timestamp` is the
 *    last activity that updated them, so a read taken moments after a transfer
 *    can still return the pre-transfer figure.
 *  - A scheduled transaction can fire while its inner transaction fails, so
 *    "the schedule executed" and "value moved" are different claims. Only the
 *    transfer list settles the second one.
 */
export async function getTransactionAt(
  client: MirrorClient,
  consensusTimestamp: ConsensusTimestamp,
): Promise<MirrorTransaction | null> {
  const page = await client.get<TransactionsPage>(
    `/api/v1/transactions?timestamp=${consensusTimestamp}`,
  )
  return page.transactions?.[0] ?? null
}

/** Net movement for one account within a single transaction, in tinybars. */
export function hbarNetFor(tx: MirrorTransaction, accountId: EntityId): bigint {
  let net = 0n
  for (const t of tx.transfers ?? []) {
    if (t.account === accountId) net += BigInt(t.amount)
  }
  return net
}

/**
 * Normalise a Hedera transaction id.
 *
 * The same transaction has two spellings depending on where you read it:
 *
 *   SDK / receipts   0.0.10379287@1788620574.542753968
 *   Mirror Node      0.0.10379287-1788620574-542753968
 *
 * Comparing them raw makes every transfer look unreceipted, which is exactly
 * how the reconciler first reported 16 phantom discrepancies against a
 * perfectly reconciled ledger. Always normalise before matching.
 */
export function normalizeTransactionId(id: string): string {
  return id.replace('@', '-').replace(/\.(?=\d+$)/, '-')
}

/** True when two ids refer to the same transaction, whichever spelling. */
export function sameTransaction(a: string, b: string): boolean {
  return normalizeTransactionId(a) === normalizeTransactionId(b)
}
