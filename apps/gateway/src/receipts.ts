import { submitMessage, type TabClient } from '@tab/hedera'
import { encode, type TabMessage } from '@tab/protocol'

/**
 * The HCS receipt writer.
 *
 * HCS is the ledger — there is no other accounting store. Everything money
 * depends on goes through here, validated by `@tab/protocol` before it is
 * written, because a topic is append-only and a malformed message is permanent.
 */
export interface WrittenReceipt {
  sequenceNumber: number | null
  transactionId: string
  bytes: number
}

export class ReceiptWriter {
  private readonly tab: TabClient
  private readonly topicId: string

  constructor(tab: TabClient, topicId: string) {
    this.tab = tab
    this.topicId = topicId
  }

  async write(message: TabMessage): Promise<WrittenReceipt> {
    // encode() validates and refuses anything over the single-chunk limit.
    const bytes = encode(message)
    const sent = await submitMessage(this.tab.client, this.topicId, bytes, this.tab.operatorKey)
    return {
      sequenceNumber: sent.sequenceNumber,
      transactionId: sent.transactionId,
      bytes: bytes.length,
    }
  }
}

/** Consensus-style timestamp for entries created in-process. */
export function nowConsensus(): string {
  const ms = Date.now()
  return `${Math.floor(ms / 1000)}.${String((ms % 1000) * 1_000_000).padStart(9, '0')}`
}
