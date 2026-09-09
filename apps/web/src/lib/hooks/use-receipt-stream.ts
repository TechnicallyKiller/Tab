'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BLOCKED_SELLER,
  CREDIT_PAYERS,
  DEBIT_SELLERS,
  SEED_RECEIPTS,
  TOP_SEQ,
} from '../mock/receipts'
import { CEILING, HOLDS, OPENING_BALANCE, PER_CALL_CAP, WINDOW_SECONDS } from '../mock/tab'
import type { Leg, Receipt } from '../mock/types'
import { add, isNegative, type MicroUsdc, micro, usdc } from '../money'

const EMIT_MS = 3400
const MAX_ROWS = 40

/**
 * Stands in for the gateway's SSE receipt stream until there is a gateway.
 * Deterministic seed, then pseudo-random arrivals so the table behaves the way
 * it will in the demo — new rows flash, the balance moves, refusals stamp.
 *
 * Amounts stay bigint micro-USDC end to end. A float here would show a balance
 * that disagrees with the ledger by a few micro-USDC, which is the one thing
 * verify-tab exists to catch.
 */
export function useReceiptStream() {
  const [rows, setRows] = useState<Receipt[]>(SEED_RECEIPTS)
  const [balance, setBalance] = useState<MicroUsdc>(OPENING_BALANCE)
  const [flashKey, setFlashKey] = useState('none')
  const [refusalStamp, setRefusalStamp] = useState('off')
  const [streaming, setStreaming] = useState(true)
  const [stale, setStale] = useState(false)
  const [seconds, setSeconds] = useState(214)
  const seqRef = useRef(TOP_SEQ)

  // The window countdown is always visible, because every figure is scoped to it.
  useEffect(() => {
    const t = setInterval(() => {
      setSeconds((s) => (s > 0 ? s - 1 : WINDOW_SECONDS))
    }, 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (!streaming || stale) return
    const t = setInterval(() => {
      const roll = Math.random()
      const seq = seqRef.current + 1
      seqRef.current = seq
      const stampedAt = String(Date.now())

      let leg: Leg
      let counterparty: string
      let amount: MicroUsdc
      let attested: boolean

      if (roll < 0.18) {
        leg = 'REFUSED'
        counterparty = BLOCKED_SELLER
        amount = usdc('0.0400')
        attested = false
      } else if (roll < 0.58) {
        leg = 'DEBIT'
        counterparty = DEBIT_SELLERS[Math.floor(Math.random() * DEBIT_SELLERS.length)]!
        amount = micro(-BigInt(Math.floor(Math.random() * 32 + 8) * 1000))
        attested = true
      } else {
        leg = 'CREDIT'
        counterparty = CREDIT_PAYERS[Math.floor(Math.random() * CREDIT_PAYERS.length)]!
        amount = micro(BigInt(Math.floor(Math.random() * 22 + 8) * 1000))
        attested = Math.random() > 0.2
      }

      const flash = leg === 'CREDIT' ? `credit${stampedAt}` : `debit${stampedAt}`
      const row: Receipt = {
        // allow-float — a consensus timestamp is seconds.nanos, not an amount.
        consensus: (1755738214.883104 + (seq - TOP_SEQ) * 3.4).toFixed(9),
        leg,
        counterparty,
        amount,
        attested,
        requestHash: `${hex()}…${hex()}`,
        seq,
        flash,
      }

      setRows((prev) => [row, ...prev].slice(0, MAX_ROWS))
      if (leg === 'REFUSED') {
        // A refusal moves nothing. That is the point — the float is untouched.
        setRefusalStamp(`on${stampedAt}`)
      } else {
        setBalance((b) => add(b, amount))
        setFlashKey(flash)
      }
    }, EMIT_MS)
    return () => clearInterval(t)
  }, [streaming, stale])

  const outstanding = useMemo<MicroUsdc>(
    () => (isNegative(balance) ? micro(-balance) : micro(0n)),
    [balance],
  )

  const toggleStream = useCallback(() => setStreaming((s) => !s), [])
  const toggleStale = useCallback(() => setStale((s) => !s), [])

  return {
    rows,
    balance,
    outstanding,
    holds: HOLDS,
    // Mirrors `useLiveTab` so the two are interchangeable behind the provider.
    // A mock whose shape has drifted is a mock nobody can fall back to.
    ceiling: CEILING,
    perCallCap: PER_CALL_CAP,
    error: undefined as string | undefined,
    live: false as const,
    flashKey,
    refusalStamp,
    streaming,
    stale,
    seconds,
    toggleStream,
    toggleStale,
  }
}

function hex() {
  return Math.random().toString(16).slice(2, 6)
}
