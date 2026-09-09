'use client'

import type { CounterpartyWeight } from '@tab/sdk'
import { type Polled, usePolled } from './use-polled'

/**
 * Published independence weights.
 *
 * Not part of the console's shared 3-second receipt stream, because these come
 * from the CEILING topic rather than the receipt topic and change once a window
 * rather than every few seconds. Polling them at the stream's cadence would be
 * three hundred needless requests per window.
 *
 * Read from what the engine published, never recomputed — `apps/web` cannot
 * import `@tab/graph`, and that is the right constraint: a console that
 * recomputed weights would give a viewer a second answer to compare against the
 * topic, and two answers is worse than one even when they agree.
 */

const POLL_MS = 20_000
const EMPTY: readonly CounterpartyWeight[] = []

/** Kept as a named alias — several views destructure `rows`. */
export interface CounterpartiesState {
  rows: readonly CounterpartyWeight[]
  live: boolean
  error?: string
  loading: boolean
}

export function useCounterparties(): CounterpartiesState {
  const polled: Polled<readonly CounterpartyWeight[]> = usePolled(
    (tab, tabId) => tab.counterparties(tabId),
    EMPTY,
    POLL_MS,
  )
  const { value, ...rest } = polled
  return { rows: value, ...rest }
}
