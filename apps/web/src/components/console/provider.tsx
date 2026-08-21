'use client'

import { createContext, useContext, type ReactNode } from 'react'
import { useReceiptStream } from '@/lib/hooks/use-receipt-stream'

type ConsoleState = ReturnType<typeof useReceiptStream>

const Ctx = createContext<ConsoleState | null>(null)

/**
 * One stream for the whole console, so the balance, the countdown and the
 * receipt table cannot disagree with each other across views.
 */
export function ConsoleProvider({ children }: { children: ReactNode }) {
  const state = useReceiptStream()
  return <Ctx.Provider value={state}>{children}</Ctx.Provider>
}

export function useConsole(): ConsoleState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useConsole must be used inside ConsoleProvider')
  return ctx
}
