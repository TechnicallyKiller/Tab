'use client'

import { type Polled, usePolled } from './use-polled'

/**
 * The HCS topics the gateway is actually reading.
 *
 * ## Why this is fetched rather than configured
 *
 * The console's "view on HashScan" links used to point at `0.0.4881203` — a
 * MOCK topic id left over from the mock data. Anyone who clicked one landed on
 * a topic that is not ours. On the screens whose whole job is *do not trust me,
 * go and look*, a link that goes somewhere else is worse than no link at all.
 *
 * Taking them from `/health` means they come from the same place the data comes
 * from: if the gateway is reading a topic, that is the topic it names, and the
 * two cannot drift apart again. A build-time `NEXT_PUBLIC_` value could — it is
 * inlined once and then silently stale.
 *
 * Polled slowly. A topic id changes when someone re-runs bootstrap, which is
 * approximately never.
 */

const POLL_MS = 60_000

export interface Topics {
  receipts?: string
  ceilings?: string
  settlements?: string
}

export function useTopics(): Polled<Topics> {
  return usePolled(async (tab) => (await tab.health()).topics ?? {}, {}, POLL_MS)
}

/** A HashScan URL, or `undefined` when the topic is unknown. Never a guess. */
export function topicUrl(id: string | undefined): string | undefined {
  return id ? `https://hashscan.io/testnet/topic/${id}` : undefined
}

/**
 * A HashScan transaction URL, in the form HashScan actually accepts.
 *
 * Hedera renders a transaction id as `0.0.8812188@1788696539.081352959`, and
 * that is what the gateway returns and what belongs on screen. HashScan's route
 * wants `0.0.8812188-1788696539-081352959` — the `@` and the nanosecond `.`
 * both become dashes.
 *
 * The console was linking the display form straight through, so every
 * settlement link resolved to nothing. Splitting on `@` rather than
 * find-and-replacing means an id in an unexpected shape returns `undefined` and
 * the caller renders plain text, instead of producing a confidently wrong URL.
 */
export function txUrl(transactionId: string | undefined): string | undefined {
  if (!transactionId) return undefined
  const [account, stamp] = transactionId.split('@')
  if (!account || !stamp) return undefined
  const [seconds, nanos] = stamp.split('.')
  if (!seconds || !nanos) return undefined
  return `https://hashscan.io/testnet/transaction/${account}-${seconds}-${nanos}`
}
