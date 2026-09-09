/**
 * Topic replay, for a stranger.
 *
 * Reads an HCS topic through the public Mirror Node REST API and folds it into
 * ledger entries with the real `@tab/ledger` decode. No database, no cache, no
 * gateway — `boundaries.json` bars this package from all three, and that deny
 * list is the most load-bearing line in the file: the no-contract argument is
 * that a stranger can assert our invariants themselves, and that argument is
 * only true if this tool genuinely needs nothing from us.
 */
import { type Entry, entriesFromMessages, type Replay } from '@tab/ledger'
import { decodeUtf8, type MirrorClient, readTopic, reassembleChunks } from '@tab/mirror'
import { type MicroUsdc, usdc } from '@tab/money'
import { decode, type WeightReason } from '@tab/protocol'

export async function replayTopic(mirror: MirrorClient, topicId: string): Promise<Replay> {
  const walk = await readTopic(mirror, { topicId })
  const { assembled } = reassembleChunks(walk.items)
  // The REAL decode, imported. A second implementation here would prove the two
  // copies agree, not that the published record is right.
  return entriesFromMessages(assembled)
}

/** Merge two replays. Receipts and settlements live on separate topics. */
export function mergeReplays(...replays: readonly Replay[]): Map<string, Entry[]> {
  const byTab = new Map<string, Entry[]>()
  for (const replay of replays) {
    for (const [tab, entries] of replay.byTab) {
      byTab.set(tab, [...(byTab.get(tab) ?? []), ...entries])
    }
  }
  return byTab
}

/** One published ceiling, exactly as it appears on the topic. */
export interface PublishedCeiling {
  sequenceNumber: number
  consensusTimestamp: string
  tab: string
  window: number
  /** In force. */
  ceiling: MicroUsdc
  /** The formula's result, when the asymmetry rule held a growth back. */
  computed?: MicroUsdc
  binding: string
  cause: string
  model: string
  hash: string
  /** The published input record, verbatim — what gets recomputed and rehashed. */
  inputs: Record<string, unknown>
}

/**
 * Read published ceilings.
 *
 * Returns the raw `inputs` object rather than a parsed one, deliberately: the
 * hash is over the bytes as published, so re-serialising through a typed
 * structure risks changing key order or number formatting and failing the
 * comparison for a reason that has nothing to do with the ceiling.
 */
export async function readCeilings(
  mirror: MirrorClient,
  topicId: string,
): Promise<PublishedCeiling[]> {
  const walk = await readTopic(mirror, { topicId })
  const { assembled } = reassembleChunks(walk.items)

  const out: PublishedCeiling[] = []
  for (const message of assembled) {
    const result = decode(decodeUtf8(message.payload))
    if (!result.ok || result.message.t !== 'ceiling') continue
    const msg = result.message
    out.push({
      sequenceNumber: message.sequenceNumber,
      consensusTimestamp: message.consensusTimestamp,
      tab: msg.tab,
      window: msg.w,
      ceiling: usdc(msg.ceil),
      ...(msg.computed ? { computed: usdc(msg.computed) } : {}),
      binding: msg.bind,
      cause: msg.cause,
      model: msg.model,
      hash: msg.hash,
      inputs: msg.inputs as unknown as Record<string, unknown>,
    })
  }
  return out
}

/** One published weight, exactly as it appears on the topic. */
export interface PublishedWeightRecord {
  sequenceNumber: number
  consensusTimestamp: string
  tab: string
  window: number
  counterparty: string
  bp: number
  reasons: readonly WeightReason[]
  blocking: boolean
  /** Absent on messages published before the field existed. */
  model?: string
}

/**
 * Read published weights.
 *
 * On the same topic as the ceilings, so this walks it a second time rather than
 * threading two collectors through one pass. The cost is one extra Mirror Node
 * read in a tool nobody runs in a loop; the benefit is that a bug in one reader
 * cannot silently change what the other sees.
 */
export async function readWeights(
  mirror: MirrorClient,
  topicId: string,
): Promise<PublishedWeightRecord[]> {
  const walk = await readTopic(mirror, { topicId })
  const { assembled } = reassembleChunks(walk.items)

  const out: PublishedWeightRecord[] = []
  for (const message of assembled) {
    const result = decode(decodeUtf8(message.payload))
    if (!result.ok || result.message.t !== 'weight') continue
    const msg = result.message
    out.push({
      sequenceNumber: message.sequenceNumber,
      consensusTimestamp: message.consensusTimestamp,
      tab: msg.tab,
      window: msg.w,
      counterparty: msg.cp,
      bp: msg.bp,
      reasons: msg.why,
      blocking: msg.block,
      ...(msg.model ? { model: msg.model } : {}),
    })
  }
  return out
}
