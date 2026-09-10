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
