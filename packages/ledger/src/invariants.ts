import { add, format, micro, sub, sum, type MicroUsdc } from '@tab/money'
import { inConsensusOrder, type ConsensusTimestamp, type Entry } from './entries.ts'
import { resolveHolds } from './holds.ts'

/**
 * The assertions `verify-tab` runs.
 *
 * Pure predicates over entry lists, so a stranger can check them with nothing
 * but the repo and the public Mirror Node. That is the substance of the
 * no-smart-contract argument: a contract would assert these in a test only we
 * run.
 */

export interface Violation {
  invariant: string
  detail: string
  /** True when this indicates lost or duplicated money, rather than a warning. */
  material: boolean
}

export interface CheckResult {
  ok: boolean
  checked: string[]
  violations: Violation[]
}

/** A hold committed twice double-counts a debit. */
export function checkHoldsCommittedOnce(entries: readonly Entry[]): Violation[] {
  const seen = new Map<string, number>()
  for (const entry of entries) {
    if (entry.kind !== 'debit') continue
    seen.set(entry.holdId, (seen.get(entry.holdId) ?? 0) + 1)
  }
  return [...seen.entries()]
    .filter(([, count]) => count > 1)
    .map(([holdId, count]) => ({
      invariant: 'hold_committed_once',
      detail: `hold ${holdId} was committed ${count} times — the debit is double-counted`,
      material: true,
    }))
}

/** Every debit must trace to a hold. A debit without one bypassed the fast path. */
export function checkDebitsHaveHolds(entries: readonly Entry[]): Violation[] {
  const holdIds = new Set(entries.filter((e) => e.kind === 'hold').map((e) => e.holdId))
  return entries
    .filter((e): e is Extract<Entry, { kind: 'debit' }> => e.kind === 'debit')
    .filter((e) => !holdIds.has(e.holdId))
    .map((e) => ({
      invariant: 'debit_has_hold',
      detail: `debit ${e.transactionId} references unknown hold ${e.holdId} — it bypassed reserve`,
      material: true,
    }))
}

/** A committed hold must debit exactly what it reserved. */
export function checkCommitAmountsMatch(entries: readonly Entry[]): Violation[] {
  const reserved = new Map<string, MicroUsdc>()
  for (const entry of entries) {
    if (entry.kind === 'hold') reserved.set(entry.holdId, entry.amount)
  }
  const out: Violation[] = []
  for (const entry of entries) {
    if (entry.kind !== 'debit') continue
    const held = reserved.get(entry.holdId)
    if (held === undefined) continue // covered by checkDebitsHaveHolds
    // A debit is negative; a hold is positive.
    const debited = micro(-entry.amount)
    if (debited !== held) {
      out.push({
        invariant: 'commit_amount_matches_hold',
        detail:
          `hold ${entry.holdId} reserved ${format(held)} but debited ${format(debited)} — ` +
          'the difference is unaccounted for',
        material: true,
      })
    }
  }
  return out
}

/** Available may never go negative — that would mean spending past the ceiling. */
export function checkAvailableNonNegative(
  entries: readonly Entry[],
  ceiling: MicroUsdc,
  now: ConsensusTimestamp,
): Violation[] {
  let balance = micro(0n)
  for (const entry of inConsensusOrder(entries)) {
    if (entry.kind === 'debit' || entry.kind === 'credit' || entry.kind === 'interest' || entry.kind === 'repair') {
      balance = add(balance, entry.amount)
    }
  }
  const outstanding = balance < 0n ? micro(-balance) : micro(0n)
  const holds = sum(
    resolveHolds(entries, now).filter((h) => h.state === 'pending').map((h) => h.amount),
  )
  const available = sub(sub(ceiling, outstanding), holds)
  return available < 0n
    ? [
        {
          invariant: 'available_non_negative',
          detail:
            `available is ${format(available)}: outstanding ${format(outstanding)} plus holds ` +
            `${format(holds)} exceeds the ceiling ${format(ceiling)}`,
          material: true,
        },
      ]
    : []
}

export interface FloatInvariantInput {
  /** Cold treasury balance, from Mirror Node. */
  treasury: MicroUsdc
  /** Hot float balance, from Mirror Node. */
  hotFloat: MicroUsdc
  /** What the float started with. */
  floatTotal: MicroUsdc
  /** Sum of every agent's outstanding, from the receipt topic. */
  outstandingTotal: MicroUsdc
  /**
   * The `balance.timestamp` those balances were snapshotted at.
   *
   * Mirror Node account balances are SNAPSHOTS, not live reads — the field is
   * the last activity that updated them. Comparing a stale balance against
   * receipts replayed to *now* fails on a perfectly reconciled ledger, which is
   * the worst possible failure for the command whose job is proving
   * correctness. The caller must replay receipts only up to this timestamp.
   */
  balanceAsOf: ConsensusTimestamp
}

/**
 * `treasury + hotFloat == floatTotal + outstanding`.
 *
 * Spans two accounts because the float is split: a KeyList reserve behind a
 * single-key hot account that signs per request. Both balances are readable
 * from Mirror Node, so the invariant stays checkable by a stranger.
 * See docs/adr/0003-two-account-float.md.
 */
export function checkFloatInvariant(input: FloatInvariantInput): Violation[] {
  const held = add(input.treasury, input.hotFloat)
  const expected = add(input.floatTotal, input.outstandingTotal)
  if (held === expected) return []
  return [
    {
      invariant: 'float_balance',
      detail:
        `treasury ${format(input.treasury)} + hot float ${format(input.hotFloat)} = ${format(held)}, ` +
        `expected float ${format(input.floatTotal)} + outstanding ${format(input.outstandingTotal)} = ` +
        `${format(expected)}. Difference ${format(sub(held, expected))}. ` +
        `Balances are as of ${input.balanceAsOf} — confirm receipts were replayed only to that point, ` +
        'because Mirror Node balances are snapshots and a later receipt would look like a discrepancy.',
      material: true,
    },
  ]
}

/** Run every entry-level invariant. The float check needs chain data and is separate. */
/**
 * A window settles at most once.
 *
 * Written after the settlement worker paid the same window twice. It replayed
 * only the receipts topic, so it never saw the settlement receipts that live on
 * the settlements topic; every closed window looked unsettled forever and each
 * pass paid it again. The money left the float and the tab held more than it
 * was owed, and NOTHING in the ledger complained — the second settlement was a
 * perfectly well-formed receipt.
 *
 * Cheap to check and impossible to argue with, which is what an invariant
 * should be. A duplicate is always material: it is real money paid twice.
 */
export function checkWindowSettledOnce(entries: readonly Entry[]): Violation[] {
  const seen = new Map<number, number>()
  for (const entry of entries) {
    if (entry.kind !== 'settlement') continue
    seen.set(entry.window, (seen.get(entry.window) ?? 0) + 1)
  }
  return [...seen.entries()]
    .filter(([, count]) => count > 1)
    .map(([window, count]) => ({
      invariant: 'window_settled_once',
      detail:
        `window ${window} has ${count} settlement receipts — it was paid ${count} times. ` +
        'Check that the worker replays the settlements topic, not only the receipts topic.',
      material: true,
    }))
}

export function checkLedger(
  entries: readonly Entry[],
  ceiling: MicroUsdc,
  now: ConsensusTimestamp,
): CheckResult {
  const violations = [
    ...checkHoldsCommittedOnce(entries),
    ...checkDebitsHaveHolds(entries),
    ...checkCommitAmountsMatch(entries),
    ...checkAvailableNonNegative(entries, ceiling, now),
    ...checkWindowSettledOnce(entries),
  ]
  return {
    ok: violations.length === 0,
    checked: [
      'hold_committed_once',
      'debit_has_hold',
      'commit_amount_matches_hold',
      'available_non_negative',
      'window_settled_once',
    ],
    violations,
  }
}

/**
 * The invariants a STRANGER can assert from the public record alone.
 *
 * This exists because `checkLedger` cannot be run against an HCS replay, and
 * finding that out the hard way is instructive: `@tab/protocol` has no hold
 * message. Holds live in the gateway's memory and never reach a topic, so a
 * replay contains debits with no holds and `debit_has_hold` fails for EVERY
 * debit, on a perfectly correct ledger. `verify-tab` printed exactly that —
 * three tabs, all FAIL — which a stranger would reasonably read as fraud.
 *
 * So the invariant set splits by what the evidence can support:
 *
 *  - **Public.** Derivable from receipts alone. A stranger asserts these and a
 *    failure means something is genuinely wrong.
 *  - **Local.** Need the in-process hold table. The gateway can assert them;
 *    nobody else can, and pretending otherwise turns the trust artifact into a
 *    generator of false accusations.
 *
 * The right long-term answer is arguably to publish holds, making the
 * write-ahead ordering itself auditable. That costs an HCS message per
 * ATTEMPTED spend — including every hold that expires unused — on the latency
 * path the whole fast/slow split exists to protect. Worth a decision rather
 * than a default, and recorded as open.
 */
export const LOCAL_ONLY_INVARIANTS = [
  'debit_has_hold',
  'commit_amount_matches_hold',
] as const

export function checkPublicLedger(
  entries: readonly Entry[],
  ceiling: MicroUsdc,
  now: ConsensusTimestamp,
): CheckResult & { notCheckable: readonly string[] } {
  const violations = [
    ...checkHoldsCommittedOnce(entries),
    ...checkAvailableNonNegative(entries, ceiling, now),
    ...checkWindowSettledOnce(entries),
  ]
  return {
    ok: violations.length === 0,
    checked: ['hold_committed_once', 'available_non_negative', 'window_settled_once'],
    violations,
    /*
     * Named, not silently dropped.
     *
     * A verifier that quietly checks less than it appears to is worse than one
     * that checks less and says so — the whole value of the tool is that its
     * output can be trusted about its own scope.
     */
    notCheckable: LOCAL_ONLY_INVARIANTS,
  }
}
