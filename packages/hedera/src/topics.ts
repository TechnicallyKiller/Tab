import {
  PrivateKey,
  Status,
  TopicCreateTransaction,
  TopicId,
  TopicMessageSubmitTransaction,
  type Client,
} from '@hiero-ledger/sdk'

/**
 * HCS topic creation and submission.
 *
 * HCS is the ledger. There is no other accounting store, and no smart contract:
 * every receipt, ceiling change and settlement is a message here, consensus
 * ordered and replayable by anyone. See ADR-0007.
 */

export interface CreateTopicOptions {
  memo: string
  /**
   * When set, only this key may submit. Tab sets it so the topic is an
   * append-only log THE GATEWAY owns — without it anyone can write a message
   * that a naive replay would count as a receipt.
   */
  submitKey?: PrivateKey
  adminKey?: PrivateKey
}

export interface CreatedTopic {
  topicId: string
  transactionId: string
}

export async function createTopic(
  client: Client,
  options: CreateTopicOptions,
): Promise<CreatedTopic> {
  let tx = new TopicCreateTransaction().setTopicMemo(options.memo)
  if (options.submitKey) tx = tx.setSubmitKey(options.submitKey.publicKey)
  if (options.adminKey) tx = tx.setAdminKey(options.adminKey.publicKey)

  const response = await tx.execute(client)
  const receipt = await response.getReceipt(client)
  if (receipt.status !== Status.Success) {
    throw new Error(`Topic creation failed with status ${receipt.status.toString()}`)
  }
  const topicId = receipt.topicId
  if (!topicId) throw new Error('Topic creation returned no topic id')

  return { topicId: topicId.toString(), transactionId: response.transactionId.toString() }
}

export interface SubmittedMessage {
  topicId: string
  transactionId: string
  /**
   * Consensus-assigned sequence number, or null when the payload was chunked —
   * the receipt then reports only the first chunk, so read the real ordering
   * back from Mirror Node rather than trusting this.
   */
  sequenceNumber: number | null
  chunks: number
}

/** Payload bytes above this are split into chunks by the SDK. */
export const MAX_SINGLE_CHUNK_BYTES = 1024

export async function submitMessage(
  client: Client,
  topicId: string,
  payload: string | Uint8Array,
  submitKey?: PrivateKey,
): Promise<SubmittedMessage> {
  const bytes = typeof payload === 'string' ? new TextEncoder().encode(payload) : payload
  const chunks = Math.max(1, Math.ceil(bytes.length / MAX_SINGLE_CHUNK_BYTES))

  let tx: TopicMessageSubmitTransaction | ReturnType<TopicMessageSubmitTransaction['freezeWith']> =
    new TopicMessageSubmitTransaction()
      .setTopicId(TopicId.fromString(topicId))
      .setMessage(bytes)

  if (submitKey) {
    tx = (tx as TopicMessageSubmitTransaction).freezeWith(client)
    tx = await (tx as ReturnType<TopicMessageSubmitTransaction['freezeWith']>).sign(submitKey)
  }

  const response = await tx.execute(client)
  const receipt = await response.getReceipt(client)
  if (receipt.status !== Status.Success) {
    throw new Error(`Message submit failed with status ${receipt.status.toString()}`)
  }

  return {
    topicId,
    transactionId: response.transactionId.toString(),
    sequenceNumber: receipt.topicSequenceNumber ? Number(receipt.topicSequenceNumber) : null,
    chunks,
  }
}
