import { add, micro, sub, sum, type MicroUsdc } from '@tab/money'
import { inConsensusOrder, type Entry } from './entries.ts'

/**
 * Window netting.
 *
 * Ten thousand calls become one transfer. The economics of micropayment credit
 * only work if the bookkeeping is free and the settlement is cheap, so a window
 * folds to a single signed number and a single movement.
 */

export interface WindowNet {
  window: number
  credits: MicroUsdc
  /** Negative. */
  debits: MicroUsdc
  /** Negative. */
  interest: MicroUsdc
  /** credits + debits + interest. Positive pays the agent; negative is carried. */
  net: MicroUsdc
  /** How many receipts collapsed into that one movement. */
  receiptCount: number
  /** Refusals are counted but never summed — they moved nothing. */
  refusalCount: number
  /** Repairs are folded into debits, and surfaced so a clean window is visible. */
  repairCount: number
}

/**
 * Fold one window's entries.
 *
 * Holds are excluded deliberately: a hold that never committed moved no money,
 * and one that did is already represented by its debit. Counting both would
 * double-charge.
 */
export function netWindow(entries: readonly Entry[], window: number): WindowNet {
  const inWindow = inConsensusOrder(entries).filter((e) => e.window === window)

  const creditAmounts: MicroUsdc[] = []
  const debitAmounts: MicroUsdc[] = []
  const interestAmounts: MicroUsdc[] = []
  let refusalCount = 0
  let repairCount = 0

  for (const entry of inWindow) {
    switch (entry.kind) {
      case 'credit':
        creditAmounts.push(entry.amount)
        break
      case 'debit':
        debitAmounts.push(entry.amount)
        break
      case 'repair':
        debitAmounts.push(entry.amount)
        repairCount++
        break
      case 'interest':
        interestAmounts.push(entry.amount)
        break
      case 'refusal':
        refusalCount++
        break
      case 'hold':
      case 'settlement':
        break
    }
  }

  const credits = sum(creditAmounts)
  const debits = sum(debitAmounts)
  const interest = sum(interestAmounts)

  return {
    window,
    credits,
    debits,
    interest,
    net: add(add(credits, debits), interest),
    receiptCount: creditAmounts.length + debitAmounts.length,
    refusalCount,
    repairCount,
  }
}

export type SettlementOutcome = 'clean' | 'missed' | 'carried'

export interface SettlementPlan {
  net: WindowNet
  outcome: SettlementOutcome
  /** What actually moves on chain. Zero means no transfer is created. */
  transfer: MicroUsdc
  /** Carried into the next window when the net is negative. */
  outstandingAfter: MicroUsdc
  rampFromBp: number
  rampToBp: number
}

export const RAMP_CLEAN_STEP_BP = 1500
export const RAMP_MISSED_STEP_BP = -3000
export const RAMP_MIN_BP = 0
export const RAMP_MAX_BP = 10_000

/**
 * Decide what a window's close does.
 *
 * A positive net pays the agent and is a clean settlement. A negative net is
 * carried as outstanding rather than demanded — the agent has no wallet to pay
 * from, which is the entire premise. `funded` says whether the float could
 * actually cover a payout; a positive net that cannot be paid is a MISSED
 * settlement and the ramp collapses.
 */
export function planSettlement(params: {
  net: WindowNet
  outstandingBefore: MicroUsdc
  rampBp: number
  funded: boolean
}): SettlementPlan {
  const { net, outstandingBefore, rampBp, funded } = params
  const positive = net.net > 0n

  const outcome: SettlementOutcome = positive ? (funded ? 'clean' : 'missed') : 'carried'
  const transfer = outcome === 'clean' ? net.net : micro(0n)

  // A carried window adds what was not paid to what was already owed.
  const outstandingAfter =
    outcome === 'carried' ? add(outstandingBefore, micro(-net.net)) : outstandingBefore

  // Shrink is instant, growth is earned. A missed settlement collapses the ramp
  // immediately; a clean one steps it up by one increment, never more.
  const step = outcome === 'clean' ? RAMP_CLEAN_STEP_BP : outcome === 'missed' ? RAMP_MISSED_STEP_BP : 0
  const rampToBp = Math.max(RAMP_MIN_BP, Math.min(RAMP_MAX_BP, rampBp + step))

  return { net, outcome, transfer, outstandingAfter, rampFromBp: rampBp, rampToBp }
}

/** Net across several windows, for the settlements view. */
export function netWindows(entries: readonly Entry[], windows: readonly number[]): WindowNet[] {
  return windows.map((w) => netWindow(entries, w))
}

export { sub }
