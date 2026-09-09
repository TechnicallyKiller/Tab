import { add, atLeastZero, type MicroUsdc, micro, sub, sum } from '@tab/money'
import {
  type ConsensusTimestamp,
  compareConsensus,
  type Entry,
  inConsensusOrder,
} from './entries.ts'

/**
 * Holds, and the available balance they protect.
 *
 * The write-ahead order is fixed and not negotiable:
 *
 *   1. RESERVE  a hold id is issued and available drops IMMEDIATELY
 *   2. PAY      the gateway pays the seller, hold id as idempotency key
 *   3. COMMIT   the hold becomes a debit and the receipt goes to HCS
 *
 * Step 1 happening before step 2 is the entire defence against racing many
 * spends before the ceiling updates.
 */

export type HoldState = 'pending' | 'committed' | 'expired'

export interface HoldView {
  holdId: string
  counterparty: string
  amount: MicroUsdc
  state: HoldState
  reservedAt: ConsensusTimestamp
  expiresAt: ConsensusTimestamp
  /** Set when committed — the debit that consumed it. */
  transactionId?: string
}

/**
 * Resolve every hold's fate from the entry log.
 *
 * A hold is committed when a debit carries its id, expired when its expiry has
 * passed with no debit, and pending otherwise. `now` is supplied by the caller
 * rather than read from a clock, so replay is deterministic — the same entries
 * must always produce the same answer.
 */
export function resolveHolds(entries: readonly Entry[], now: ConsensusTimestamp): HoldView[] {
  const ordered = inConsensusOrder(entries)
  const holds = new Map<string, HoldView>()
  const committed = new Map<string, string>()

  for (const entry of ordered) {
    if (entry.kind === 'debit') committed.set(entry.holdId, entry.transactionId)
  }

  for (const entry of ordered) {
    if (entry.kind !== 'hold') continue
    if (holds.has(entry.holdId)) {
      // A duplicate reserve for the same id is a delivery artefact, not a
      // second reservation. Counting it twice would understate available.
      continue
    }
    const transactionId = committed.get(entry.holdId)
    const state: HoldState = transactionId
      ? 'committed'
      : compareConsensus(entry.expiresAt, now) <= 0
        ? 'expired'
        : 'pending'
    holds.set(entry.holdId, {
      holdId: entry.holdId,
      counterparty: entry.counterparty,
      amount: entry.amount,
      state,
      reservedAt: entry.at,
      expiresAt: entry.expiresAt,
      ...(transactionId ? { transactionId } : {}),
    })
  }

  return [...holds.values()]
}

/** Only pending holds reduce available. Committed ones are already debits. */
export function pendingHoldTotal(entries: readonly Entry[], now: ConsensusTimestamp): MicroUsdc {
  return sum(
    resolveHolds(entries, now)
      .filter((h) => h.state === 'pending')
      .map((h) => h.amount),
  )
}

export interface Position {
  /** Net of every settled movement. Negative means the agent owes the float. */
  balance: MicroUsdc
  /** How much is owed right now — the positive face of a negative balance. */
  outstanding: MicroUsdc
  /** Reserved but not yet spent. */
  holds: MicroUsdc
  /** ceiling − outstanding − holds, never below zero. */
  available: MicroUsdc
  ceiling: MicroUsdc
}

/**
 * The whole position, from entries plus a ceiling.
 *
 * Refusals move nothing and holds are not yet spent, so neither touches
 * `balance` — only committed movements do. Getting that wrong would make a
 * refused spend look like it cost the agent money.
 */
export function position(
  entries: readonly Entry[],
  ceiling: MicroUsdc,
  now: ConsensusTimestamp,
): Position {
  let balance = micro(0n)
  for (const entry of inConsensusOrder(entries)) {
    switch (entry.kind) {
      case 'debit':
      case 'credit':
      case 'interest':
      case 'repair':
        balance = add(balance, entry.amount)
        break
      case 'settlement':
        // A clean settlement moves the net and returns the tab to zero; a
        // carried one leaves the balance in place to accrue.
        if (entry.outcome === 'clean') balance = sub(balance, entry.net)
        break
      case 'hold':
      case 'refusal':
        break
    }
  }

  const outstanding = balance < 0n ? micro(-balance) : micro(0n)
  const holds = pendingHoldTotal(entries, now)
  const available = atLeastZero(sub(sub(ceiling, outstanding), holds))

  return { balance, outstanding, holds, available, ceiling }
}

export interface ReserveDecision {
  allowed: boolean
  available: MicroUsdc
  /** Set when refused, naming the shortfall rather than just saying no. */
  shortfall?: MicroUsdc
}

/**
 * Can this spend be reserved?
 *
 * Pure arithmetic — the fast path adds the caps and the cluster check around
 * it. Kept here so the balance question is testable without Redis.
 */
export function canReserve(current: Position, price: MicroUsdc): ReserveDecision {
  if (price <= 0n) throw new Error('A spend price must be positive')
  if (price <= current.available) return { allowed: true, available: current.available }
  return {
    allowed: false,
    available: current.available,
    shortfall: sub(price, current.available),
  }
}
