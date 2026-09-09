'use client'

import type { Tab } from '@tab/sdk'
import { useEffect, useState } from 'react'
import { LIVE, TAB_ID, tabClient } from '../live/client'

/**
 * One poller, shared by the views that read once a window rather than once a
 * tick.
 *
 * Written after the third copy of the same `useEffect` — cancelled flag,
 * interval, keep-the-last-good-rows-on-failure — appeared. The duplication
 * itself was harmless; what was not is that each copy had to independently get
 * the failure behaviour right, and getting it wrong shows up as a console that
 * blanks a table on a transient timeout. A blank table reads as "no
 * settlements", which is a different and much worse claim than "the last poll
 * failed".
 *
 * So the contract is fixed here, once:
 *
 * - the previous value STAYS on screen when a poll fails
 * - `error` is set alongside it, for the view to show
 * - `loading` is true only until the FIRST poll resolves
 * - not live means never poll, and `loading` is false immediately
 *
 * Deliberately not on the console's 3-second receipt stream. A ceiling changes
 * when the engine runs and a settlement once per 600s window; polling either at
 * the stream's cadence would be hundreds of needless requests per window
 * against a Mirror Node read the gateway is already caching.
 */

export interface Polled<T> {
  value: T
  live: boolean
  /** Set when the LAST poll failed. The previous value is still in `value`. */
  error?: string
  /** True until the first poll resolves, so a view can say "waiting". */
  loading: boolean
}

export function usePolled<T>(
  read: (tab: Tab, tabId: string) => Promise<T>,
  initial: T,
  intervalMs: number,
): Polled<T> {
  const [value, setValue] = useState<T>(initial)
  const [error, setError] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(LIVE)

  useEffect(() => {
    if (!LIVE) return
    let cancelled = false
    const tab = tabClient()

    const poll = async () => {
      try {
        const next = await read(tab, TAB_ID)
        if (cancelled) return
        setValue(next)
        setError(undefined)
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void poll()
    const timer = setInterval(() => void poll(), intervalMs)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
    /*
     * `read` is deliberately NOT a dependency.
     *
     * Every caller passes an inline arrow, so a `read` in the dependency array
     * is a new function every render and the effect would tear down and
     * re-establish the interval on each one — polling on every render instead
     * of on the interval. The read is a pure call on the module-level client,
     * so a stale closure over it cannot go wrong.
     */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, read])

  return { value, live: LIVE, ...(error ? { error } : {}), loading }
}
