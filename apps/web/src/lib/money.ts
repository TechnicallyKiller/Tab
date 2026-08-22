/**
 * Re-export so app code keeps importing from '@/lib/money'.
 *
 * There is exactly one money implementation and it lives in @tab/money. Two of
 * them would drift, and a display layer that rounds differently from the ledger
 * is how "reconciles to the cent" stops being true on screen.
 */
export * from '@tab/money'

import { bpFromRatio, type MicroUsdc } from '@tab/money'

/** Meter width as a percentage. Presentation only — never a decision input. */
export function pctOf(part: MicroUsdc, whole: MicroUsdc): number {
  if (whole <= 0n) return 0
  const magnitude = part < 0n ? -part : part
  const share = bpFromRatio(magnitude, whole) / 100
  return Math.max(0, Math.min(100, share))
}
