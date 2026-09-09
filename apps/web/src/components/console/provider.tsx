'use client'

import { createContext, type ReactNode, useContext } from 'react'
import { useLiveTab } from '@/lib/hooks/use-live-tab'
import { useReceiptStream } from '@/lib/hooks/use-receipt-stream'
import { LIVE } from '@/lib/live/client'

/**
 * One source for the whole console, so the balance, the countdown and the
 * receipt table cannot disagree with each other across views.
 *
 * Live when `NEXT_PUBLIC_TAB_ACCOUNT_ID` is set, mock otherwise — and the
 * console SAYS WHICH on screen. A dashboard that silently falls back to
 * invented numbers is a dashboard that will be filmed showing invented
 * numbers, and one wrong figure cross-checked against HashScan makes every
 * other figure suspect.
 */
type ConsoleState = ReturnType<typeof useLiveTab> | ReturnType<typeof useReceiptStream>

const Ctx = createContext<ConsoleState | null>(null)

export function ConsoleProvider({ children }: { children: ReactNode }) {
  /*
   * BOTH hooks run, and only one is used.
   *
   * Ugly, and the alternative is worse: React forbids calling hooks
   * conditionally, so branching on `LIVE` around a hook call would break the
   * rules of hooks the moment the flag differed between renders. The unused
   * one polls nothing — `useLiveTab` returns early when `LIVE` is false, and
   * the mock's timers are cheap.
   */
  const live = useLiveTab()
  const mock = useReceiptStream()
  return <Ctx.Provider value={LIVE ? live : mock}>{children}</Ctx.Provider>
}

export function useConsole(): ConsoleState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useConsole must be used inside ConsoleProvider')
  return ctx
}

/** Whether the figures on screen came from a gateway or from the mock. */
export function useIsLive(): boolean {
  return LIVE
}
