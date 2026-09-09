import type { MicroUsdc } from '@tab/money'
import type { RefusalCode } from '@tab/protocol'

/**
 * Ledger entries.
 *
 * The caller fetches these — from an HCS replay, from a projection, from
 * memory. This package only turns them into balances, which is what lets the
 * money math be tested as pure functions instead of through a database.
 *
 * Ordering is by CONSENSUS TIMESTAMP, always. Consensus gives a total order for
 * free and it is the one ordering a stranger can reproduce; our own sequence
 * numbers are not.
 */

/** "seconds.nanos". Compared as two bigints, never parsed to a float. */
export type ConsensusTimestamp = string

export interface EntryBase {
  at: ConsensusTimestamp
  /** Which settlement window this belongs to. */
  window: number
  /**
   * The token this entry's amounts are denominated in.
   *
   * Optional only because receipts written before the `tok` field existed do
   * not carry it. **An absent token cannot be assumed to be the current one** —
   * that is precisely the bug this exists to prevent: a deployment that
   * switched tokens would leave one topic holding amounts in two currencies,
   * and anything summing them would be adding TUSD to USDC and reporting the
   * total as money.
   *
   * A consumer asserting a balance MUST filter on this and report what it
   * excluded, the way `verify-tab` does.
   */
  token?: string
  /**
   * The HCS sequence number this entry was replayed from.
   *
   * Optional because an entry constructed in-process — before its receipt is
   * published — genuinely has no sequence number yet. Present on anything
   * replayed from a topic, and it is the number you cite in an audit, so the
   * console shows it rather than a counter of its own.
   */
  seq?: number
  /** Hash of the request this entry relates to, when the receipt carried one. */
  requestHash?: string
}

/**
 * Money reserved but not yet spent.
 *
 * Available drops at RESERVE time, not at commit. That is what defeats the race
 * where many spends are issued before the ceiling updates — the README lists it
 * as caught, and this is where it is caught.
 */
export interface HoldEntry extends EntryBase {
  kind: 'hold'
  holdId: string
  counterparty: string
  amount: MicroUsdc
  /** Holds expire so a crashed gateway cannot strand available balance. */
  expiresAt: ConsensusTimestamp
}

/** A hold that was paid and recorded. Carries its hold id so the pair is auditable. */
export interface DebitEntry extends EntryBase {
  kind: 'debit'
  holdId: string
  counterparty: string
  /** Negative. */
  amount: MicroUsdc
  transactionId: string
}

/** Money in. `attested` means the gateway served the request it paid for. */
export interface CreditEntry extends EntryBase {
  kind: 'credit'
  counterparty: string
  /** Positive. */
  amount: MicroUsdc
  attested: boolean
  transactionId: string
}

/** Accrued on outstanding at the tier APR when a window is carried. */
export interface InterestEntry extends EntryBase {
  kind: 'interest'
  /** Negative — interest is owed, not earned. */
  amount: MicroUsdc
  rateBp: number
}

/**
 * Written by the reconciler when a crash left a transfer with no debit.
 *
 * First-class rather than an afterthought: `reserve → pay → commit` can fail
 * between pay and commit, and the diff that finds it runs on camera.
 */
export interface RepairEntry extends EntryBase {
  kind: 'repair'
  counterparty: string
  amount: MicroUsdc
  transactionId: string
  /**
   * `amount` is signed, and the sign follows the reason: `missing_debit` adds a
   * debit (negative), `missing_transfer` reverses one (positive).
   */
  reason: 'missing_debit' | 'missing_transfer' | 'orphan_hold' | 'amount_mismatch'
}

/** A refused spend. Records intent; moves nothing. */
export interface RefusalEntry extends EntryBase {
  kind: 'refusal'
  counterparty: string
  /** What was asked for. Never applied to any balance. */
  requested: MicroUsdc
  rule: RefusalCode
}

/** A window's net moved in one transfer. */
export interface SettlementEntry extends EntryBase {
  kind: 'settlement'
  /** Signed: positive paid out to the agent, negative carried as outstanding. */
  net: MicroUsdc
  transactionId?: string
  outcome: 'clean' | 'missed' | 'carried'
  /**
   * The credit ramp before and after this window, basis points.
   *
   * Carried on the entry because the ramp is the core credit mechanic and it
   * has to survive a restart. The receipt topic is the only durable state we
   * have, so a replay that dropped these would silently reset every agent's
   * earned credit to the starting ramp on every worker deploy.
   */
  rampFromBp: number
  rampToBp: number
  /**
   * The gross legs the net collapsed from, and how many receipts collapsed.
   *
   * On the entry rather than in a second decoder because the console's
   * settlements view exists to show ONE claim: many receipts became one
   * transfer. Showing only `net` shows the transfer and hides the netting,
   * which is the part worth proving — and a parallel `settlementsFromMessages`
   * would be a fourth private replay copy, the exact mistake that lost holds on
   * every gateway restart.
   *
   * Optional because settlements published before these fields existed decode
   * without them. A reader must treat absent as unknown, NOT as zero: a
   * settlement whose credits are genuinely 0.000000 and one that never recorded
   * its credits are different facts, and rendering both as `0.0000` invents
   * a netting that was never published.
   */
  credits?: MicroUsdc
  debits?: MicroUsdc
  interest?: MicroUsdc
  /** How many receipts collapsed into the one movement. */
  receiptCount?: number
  /** Carried into the next window when net is negative. */
  outstanding?: MicroUsdc
}

export type Entry =
  | HoldEntry
  | DebitEntry
  | CreditEntry
  | InterestEntry
  | RepairEntry
  | RefusalEntry
  | SettlementEntry

/** Total order by consensus timestamp, without losing nanosecond precision. */
export function compareEntries(a: Entry, b: Entry): number {
  return compareConsensus(a.at, b.at)
}

export function compareConsensus(a: ConsensusTimestamp, b: ConsensusTimestamp): number {
  const [as = '0', an = '0'] = a.split('.')
  const [bs = '0', bn = '0'] = b.split('.')
  const seconds = BigInt(as) - BigInt(bs)
  if (seconds !== 0n) return seconds > 0n ? 1 : -1
  const nanos = BigInt(an.padEnd(9, '0')) - BigInt(bn.padEnd(9, '0'))
  return nanos === 0n ? 0 : nanos > 0n ? 1 : -1
}

/** Sorted copy. Replay must not depend on arrival order. */
export function inConsensusOrder(entries: readonly Entry[]): Entry[] {
  return [...entries].sort(compareEntries)
}
