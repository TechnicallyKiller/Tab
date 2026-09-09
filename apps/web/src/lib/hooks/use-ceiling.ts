'use client'

import type { CeilingView } from '@tab/sdk'
import { type Polled, usePolled } from './use-polled'

/**
 * The published ceiling, its arithmetic, and the series behind it.
 *
 * Read from what the ENGINE published to HCS, never recomputed — `apps/web`
 * cannot import `@tab/scoring`, and that is the right constraint: a console
 * that recomputed the ceiling would give a viewer a second answer to compare
 * against the topic, and two answers is worse than one even when they agree.
 *
 * Polled faster than the settlements view because the demo's central moment is
 * a MID-WINDOW collapse: the engine publishes a zero and the very next spend is
 * refused. The gateway picks that up on a 15s poll of its own, so 10s here
 * means the screen is at most a few seconds behind the number being enforced.
 */

const POLL_MS = 10_000

const EMPTY: CeilingView = {
  tab: '',
  published: false,
  // Zero until the first poll resolves — NOT the starter ceiling. Showing a
  // plausible number before hearing one would put a figure on screen that no
  // topic and no gateway ever said, which is the exact failure this console's
  // LIVE badge exists to prevent. Views gate on `loading`.
  enforced: 0n as CeilingView['enforced'],
  history: [],
}

export function useCeiling(): Polled<CeilingView> {
  return usePolled((tab, tabId) => tab.ceiling(tabId), EMPTY, POLL_MS)
}
