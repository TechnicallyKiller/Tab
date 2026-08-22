import type { MirrorClient, PageWalk } from './client.ts'
import { compareConsensus, timestampRange } from './client.ts'
import type { ConsensusTimestamp, EntityId, TopicMessage, TopicMessagesPage } from './types.ts'

export interface TopicQuery {
  topicId: EntityId
  from?: ConsensusTimestamp
  to?: ConsensusTimestamp
  /** Mirror Node caps this at 100. */
  pageSize?: number
}

/**
 * Replay a topic in consensus order — ascending, always.
 *
 * This is how `verify-tab` reconstructs the ledger, and how the indexer builds
 * its projection. Consensus timestamp is the ordering key, never our own
 * sequence numbers: consensus gives a total order for free and it is the one
 * ordering a stranger can reproduce.
 */
export async function readTopic(
  client: MirrorClient,
  query: TopicQuery,
): Promise<PageWalk<TopicMessage>> {
  const params = [
    `limit=${Math.min(query.pageSize ?? 100, 100)}`,
    'order=asc',
    ...timestampRange(query.from, query.to),
  ]
  return client.walk<TopicMessage>(
    `/api/v1/topics/${query.topicId}/messages?${params.join('&')}`,
    (body) => (body as unknown as TopicMessagesPage).messages ?? [],
  )
}

export interface AssembledMessage {
  topicId: EntityId
  /** Timestamp of the LAST chunk — the point the whole message reached consensus. */
  consensusTimestamp: ConsensusTimestamp
  sequenceNumber: number
  payerAccountId: EntityId
  payload: Uint8Array
  chunks: number
}

/**
 * Reassemble chunked messages.
 *
 * An HCS payload over roughly 1KB is split across several messages, each with
 * its own sequence number and a `chunk_info` of `{number, total}`. Parsing a
 * chunk on its own yields truncated JSON — which fails loudly if you are lucky
 * and silently if you are not. Every topic read must go through this.
 *
 * Incomplete groups are dropped and reported rather than parsed: a receipt
 * missing its tail is not a receipt.
 */
export function reassembleChunks(messages: readonly TopicMessage[]): {
  assembled: AssembledMessage[]
  incomplete: { initialTransactionId: string; got: number; expected: number }[]
} {
  const singles: AssembledMessage[] = []
  const groups = new Map<string, TopicMessage[]>()

  for (const m of messages) {
    const info = m.chunk_info
    if (!info || info.total <= 1) {
      singles.push(toAssembled(m, [m]))
      continue
    }
    const tx = info.initial_transaction_id
    const key = `${tx.account_id}-${tx.transaction_valid_start}-${tx.nonce}`
    const bucket = groups.get(key)
    if (bucket) bucket.push(m)
    else groups.set(key, [m])
  }

  const assembled = [...singles]
  const incomplete: { initialTransactionId: string; got: number; expected: number }[] = []

  for (const [key, parts] of groups) {
    const expected = parts[0]?.chunk_info?.total ?? parts.length
    if (parts.length !== expected) {
      incomplete.push({ initialTransactionId: key, got: parts.length, expected })
      continue
    }
    const ordered = [...parts].sort(
      (a, b) => (a.chunk_info?.number ?? 0) - (b.chunk_info?.number ?? 0),
    )
    const last = ordered[ordered.length - 1]!
    assembled.push(toAssembled(last, ordered))
  }

  assembled.sort((a, b) => compareConsensus(a.consensusTimestamp, b.consensusTimestamp))
  return { assembled, incomplete }
}

function toAssembled(anchor: TopicMessage, parts: readonly TopicMessage[]): AssembledMessage {
  const buffers = parts.map((p) => decodeBase64(p.message))
  const total = buffers.reduce((n, b) => n + b.length, 0)
  const payload = new Uint8Array(total)
  let offset = 0
  for (const b of buffers) {
    payload.set(b, offset)
    offset += b.length
  }
  return {
    topicId: anchor.topic_id,
    consensusTimestamp: anchor.consensus_timestamp,
    sequenceNumber: anchor.sequence_number,
    payerAccountId: anchor.payer_account_id,
    payload,
    chunks: parts.length,
  }
}

function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, 'base64'))
}

export function decodeUtf8(payload: Uint8Array): string {
  return new TextDecoder().decode(payload)
}
