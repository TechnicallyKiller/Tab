'use client'

import type { SettlementView } from '@tab/sdk'
import { type Polled, usePolled } from './use-polled'

/**
 * Settled windows, from the settlements topic.
 *
 * A settlement happens once per 600s window, so this polls slowly. The gateway
 * reads the settlements topic on a 120s timer of its own; polling faster here
 * would only ask the same cached answer more often.
 *
 * Rows arrive ascending by WINDOW, not by arrival time — a repaired or late
 * settlement lands on the topic after the windows that follow it, and a table
 * sorted by timestamp would put window 41 above window 39 with no explanation.
 * The view reverses for display so the newest window is on top.
 */

const POLL_MS = 30_000
const EMPTY: readonly SettlementView[] = []

export function useSettlements(): Polled<readonly SettlementView[]> {
  return usePolled((tab, tabId) => tab.settlements(tabId), EMPTY, POLL_MS)
}
