'use client'

import { windowOf } from '@tab/params'
import type { ReceiptRow } from '@tab/sdk'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LIVE, TAB_ID, tabClient, WINDOW_SECONDS } from '../live/client'
import type { Leg, Receipt } from '../mock/types'
import { type MicroUsdc, micro } from '../money'

/**
 * The console's live data, polled from the gateway through `@tab/sdk`.
 *
 * Returns the SAME shape as `useReceiptStream`, so every view keeps working
 * unchanged — the provider chooses between them. That symmetry is deliberate:
 * the mock has to stay usable, because a demo sometimes has to run with no
 * gateway, and a mock that has drifted out of shape is a mock nobody can fall
 * back to.
 *
 * Polling, not SSE. The gateway has no event stream yet, and inventing one for
 * the console would be a second transport to be wrong about on stage. A 3s poll
 * against a 300s window is far more resolution than the numbers need.
 */

const POLL_MS = 3_000

/** Older than this and the figures are marked stale on screen rather than shown as current. */
const MAX_SNAPSHOT_AGE_MS = 15_000

const LEG: Record<ReceiptRow['leg'], Leg> = {
  hold: 'HOLD',
  debit: 'DEBIT',
  credit: 'CREDIT',
  refusal: 'REFUSED',
  repair: 'REPAIR',
  settlement: 'SETTLEMENT',
}

/**
 * One SDK row becomes one table row.
 *
 * `amount` defaults to zero rather than being dropped, because a settlement
 * receipt for a carried window legitimately moves nothing and the table should
 * show `0.0000` rather than a blank cell that reads as missing data.
 */
function mapLeg(leg: ReceiptRow['leg']): Leg {
  const mapped = LEG[leg]
  if (!mapped) throw new Error(`Unmapped receipt leg "${leg}" — add it to LEG before rendering it`)
  return mapped
}

function toReceipt(row: ReceiptRow): Receipt {
  return {
    consensus: row.at,
    /*
     * `?? 'DEBIT'` would be wrong, not defensive.
     *
     * `LEG` covers every `ReceiptLeg`, so this cannot miss — but under
     * `noUncheckedIndexedAccess` the compiler cannot know that. Throwing on an
     * unmapped leg is the honest branch: a new message type should surface as a
     * loud failure, not as a row silently labelled DEBIT that a reader would
     * take for a spend.
     */
    leg: mapLeg(row.leg),
    counterparty: row.counterparty ?? '—',
    amount: row.amount ?? micro(0n),
    // A refusal moved nothing, so "attested" is not a question about it.
    attested: row.attested ?? false,
    ...(row.requestHash ? { requestHash: row.requestHash } : {}),
    ...(row.seq !== undefined ? { seq: row.seq } : {}),
    // Carried so the tab view can sum THIS window's spend from the rows it
    // already holds, instead of printing a constant.
    window: row.window,
  }
}

export function useLiveTab() {
  const [rows, setRows] = useState<Receipt[]>([])
  const [balance, setBalance] = useState<MicroUsdc>(micro(0n))
  const [outstanding, setOutstanding] = useState<MicroUsdc>(micro(0n))
  const [holds, setHolds] = useState<MicroUsdc>(micro(0n))
  const [ceiling, setCeiling] = useState<MicroUsdc>(micro(0n))
  const [perCallCap, setPerCallCap] = useState<MicroUsdc>(micro(0n))
  const [flashKey, setFlashKey] = useState('none')
  const [refusalStamp, setRefusalStamp] = useState('off')
  const [streaming, setStreaming] = useState(true)
  const [stale, setStale] = useState(false)
  const [seconds, setSeconds] = useState(WINDOW_SECONDS)
  const [error, setError] = useState<string | undefined>(undefined)

  const lastOkRef = useRef<number>(0)
  const topRef = useRef<string | undefined>(undefined)

  /*
   * The countdown is computed from the clock, not decremented.
   *
   * A decrementing counter drifts against the real window boundary — by a
   * second or two a minute, and by minutes over a long demo — so the number on
   * screen would stop matching the window the gateway is actually in. Derived
   * from the wall clock it cannot drift.
   */
  useEffect(() => {
    const tick = () => {
      const now = Math.floor(Date.now() / 1000)
      const next = (windowOf(now, WINDOW_SECONDS) + 1) * WINDOW_SECONDS
      setSeconds(next - now)
      setStale(lastOkRef.current > 0 && Date.now() - lastOkRef.current > MAX_SNAPSHOT_AGE_MS)
    }
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (!LIVE || !streaming) return
    let cancelled = false
    const tab = tabClient()

    const poll = async () => {
      try {
        const [state, entries] = await Promise.all([tab.state(TAB_ID), tab.receipts(TAB_ID)])
        if (cancelled) return

        setBalance(state.balance)
        setOutstanding(state.outstanding)
        setHolds(state.holds)
        setCeiling(state.ceiling)
        setPerCallCap(state.perCallCap)

        // Newest first, which is how the table reads.
        const mapped = entries.map(toReceipt).reverse()
        const newest = mapped[0]

        /*
         * Flash only on a row that is genuinely new.
         *
         * Comparing the newest consensus timestamp rather than the row count:
         * the count is unchanged when a hold commits into a debit, and a
         * length check would miss it. `topRef` starts undefined so the first
         * successful poll does not flash the whole table.
         */
        if (newest && topRef.current !== undefined && newest.consensus !== topRef.current) {
          const stamp = String(Date.now())
          if (newest.leg === 'REFUSED') setRefusalStamp(`on${stamp}`)
          else setFlashKey(newest.leg === 'CREDIT' ? `credit${stamp}` : `debit${stamp}`)
          mapped[0] = { ...newest, flash: `f${stamp}` }
        }
        if (newest) topRef.current = newest.consensus

        setRows(mapped)
        setError(undefined)
        lastOkRef.current = Date.now()
      } catch (e) {
        if (cancelled) return
        /*
         * The last good figures STAY on screen, marked stale.
         *
         * Blanking them would be worse: a reader glancing at the console during
         * a transient failure would see zero balance and zero ceiling, which
         * looks like a liquidated tab rather than a lost connection.
         */
        setError(e instanceof Error ? e.message : String(e))
      }
    }

    void poll()
    const t = setInterval(() => void poll(), POLL_MS)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [streaming])

  const toggleStream = useCallback(() => setStreaming((s) => !s), [])
  const toggleStale = useCallback(() => setStale((s) => !s), [])

  return useMemo(
    () => ({
      rows,
      balance,
      outstanding,
      holds,
      ceiling,
      perCallCap,
      flashKey,
      refusalStamp,
      streaming,
      stale,
      seconds,
      error,
      live: true as const,
      toggleStream,
      toggleStale,
    }),
    [
      rows,
      balance,
      outstanding,
      holds,
      ceiling,
      perCallCap,
      flashKey,
      refusalStamp,
      streaming,
      stale,
      seconds,
      error,
      toggleStream,
      toggleStale,
    ],
  )
}
