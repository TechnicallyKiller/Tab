'use client'

import { useEffect, useState } from 'react'
import type { CounterpartyWeight } from '@tab/sdk'
import { LIVE, TAB_ID, tabClient } from '../live/client'

/**
 * Published independence weights.
 *
 * A separate hook from `useConsole`, not part of the shared stream, because
 * these come from the CEILING topic rather than the receipt topic and change
 * once a window rather than every few seconds. Polling them at the console's
 * 3-second cadence would be three hundred needless requests per window.
 *
 * Read from what the engine published, never recomputed — `apps/web` cannot
 * import `@tab/graph`, and that is the right constraint: a console that
 * recomputed weights would give a viewer a second answer to compare against the
 * topic, and two answers is worse than one even when they agree.
 */

const POLL_MS = 20_000

export interface CounterpartiesState {
  rows: readonly CounterpartyWeight[]
  live: boolean
  /** Set when the last poll failed. The previous rows stay on screen. */
  error?: string
  /** True until the first poll resolves, so the view can say "waiting". */
  loading: boolean
}

export function useCounterparties(): CounterpartiesState {
  const [rows, setRows] = useState<readonly CounterpartyWeight[]>([])
  const [error, setError] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(LIVE)

  useEffect(() => {
    if (!LIVE) return
    let cancelled = false
    const tab = tabClient()

    const poll = async () => {
      try {
        const next = await tab.counterparties(TAB_ID)
        if (cancelled) return
        setRows(next)
        setError(undefined)
      } catch (e) {
        if (cancelled) return
        // Keep the last good rows. Blanking the table on a transient failure
        // would read as "no counterparties", which is a different claim.
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void poll()
    const t = setInterval(() => void poll(), POLL_MS)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [])

  return { rows, live: LIVE, ...(error ? { error } : {}), loading }
}
