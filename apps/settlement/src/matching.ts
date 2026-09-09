/**
 * The MATCHING, separated from the command that prints it.
 *
 * Extracted so it can be tested — `reconcile.ts` reads `process.env` and throws
 * at module level, so importing the pure function used to run the whole CLI.
 * The same reason `recheck.ts` and `ancestry.ts` were split out: the functions
 * this rail's correctness rests on should not need a live chain and a populated
 * `.env` to exercise, and "it printed CLEAN against live data once" is not the
 * same as knowing that a TAMPERED record fails.
 *
 * Pure. No I/O, no environment, no clock.
 *
 * ## Only ONE direction is a real invariant
 *
 * Getting this wrong is what made the reconciler's first run report 16 phantom
 * problems against a correct ledger.
 *
 *  - **Every debit receipt MUST have a matching transfer.** A failure means the
 *    ledger says the agent owes money that never moved. Critical.
 *  - **Not every transfer has a receipt.** The float also makes operational
 *    transfers — funding a demo payer, topping up an account — which are
 *    correctly receiptless. An unreceipted outflow is a *question*, not a
 *    violation.
 *
 * Reporting the second as a violation would cry wolf on a healthy ledger, which
 * is the worst possible behaviour for the command whose job is proving the books.
 */

import type { Entry } from '@tab/ledger'
import { normalizeTransactionId } from '@tab/mirror'
import { abs, format, type MicroUsdc, micro, sum } from '@tab/money'

export type Severity = 'violation' | 'question'

export interface Discrepancy {
  kind: 'missing_transfer' | 'amount_mismatch' | 'unreceipted_outflow'
  severity: Severity
  detail: string
  amount: MicroUsdc
  /**
   * How to correct the ledger, computed here rather than re-derived by the
   * writer. A violation always carries one; a question never does, because a
   * question is not known to be wrong.
   */
  repair?: {
    counterparty: string
    /** Signed, and the sign matters — see @tab/ledger's netting. */
    amount: MicroUsdc
    transactionId: string
    why: 'missing_transfer' | 'amount_mismatch'
    window: number
  }
}

export interface Reconciliation {
  checked: number
  matched: number
  /** Violations a previous run already wrote a repair for. Not re-reported. */
  alreadyRepaired: number
  /** Float outflows matched to a settlement receipt rather than a debit. */
  settlementsMatched: number
  /**
   * Debit receipts carrying an `unsettled:` placeholder instead of a settlement
   * transaction id. These CANNOT be reconciled — there is no id to match — so
   * they are reported, never skipped silently. A non-zero count here means the
   * spend path is not backfilling the real id after the transfer lands, and the
   * ledger has a blind spot exactly where proof matters.
   */
  unreconcilable: number
  violations: Discrepancy[]
  questions: Discrepancy[]
  chainOutbound: MicroUsdc
  receiptDebits: MicroUsdc
}

/**
 * Match on-chain outbound transfers to debit receipts.
 *
 * Matching is by transaction id, not by amount — two spends of the same price
 * to the same seller are indistinguishable by amount, and pairing them wrongly
 * would hide a real discrepancy behind a coincidence.
 */
export function reconcile(
  entries: readonly Entry[],
  chainEdges: readonly { transactionId: string; amount: MicroUsdc; to: string }[],
  floatAccount: string,
  /**
   * Settlement transaction ids from the settlements topic.
   *
   * A settlement payout is an outflow from the float WITH a receipt — it is
   * just filed on a different topic. Without this the reconciler listed every
   * clean settlement as an unreceipted outflow, so the healthier the rail, the
   * more open questions its own audit tool raised about it.
   */
  settlementTxs: ReadonlySet<string> = new Set(),
): Reconciliation {
  const debits = entries.filter((e): e is Extract<Entry, { kind: 'debit' }> => e.kind === 'debit')

  /*
   * Repairs already on the topic.
   *
   * Without this the reconciler is NOT idempotent, and that is a money bug of
   * the worst kind: `--repair` would re-report the same violation on every run
   * and write another reversal each time, so the command whose job is proving
   * the books would be the thing corrupting them. A −0.04 error becomes +0.36
   * after ten runs.
   *
   * A repair is matched to its debit by transaction id, the same key used
   * everywhere else here, so a re-run reads the record and sees the work is
   * done rather than doing it again.
   */
  const repaired = new Set(
    entries
      .filter((e) => e.kind === 'repair' && e.reason === 'missing_transfer')
      .map((e) => normalizeTransactionId((e as Extract<Entry, { kind: 'repair' }>).transactionId)),
  )
  // Normalise both sides: the same transaction is spelled `0.0.x@s.n` in a
  // receipt and `0.0.x-s-n` by Mirror Node.
  const byTx = new Map(debits.map((d) => [normalizeTransactionId(d.transactionId), d]))
  const outbound = chainEdges.filter((e) => e.to !== floatAccount)

  const violations: Discrepancy[] = []
  const questions: Discrepancy[] = []
  let matched = 0
  let unreconcilable = 0
  let alreadyRepaired = 0
  let settlementsMatched = 0

  for (const edge of outbound) {
    const edgeKey = normalizeTransactionId(edge.transactionId)
    if (settlementTxs.has(edgeKey)) {
      // A window's netted payout, receipted on the settlements topic.
      settlementsMatched++
      continue
    }
    const receipt = byTx.get(edgeKey)
    if (!receipt) {
      questions.push({
        kind: 'unreceipted_outflow',
        severity: 'question',
        detail:
          `${format(edge.amount)} to ${edge.to} (${edge.transactionId}) has no debit receipt. ` +
          'Either a crash between pay and commit, or an operational transfer — ' +
          'funding a payer, topping up an account.',
        amount: edge.amount,
      })
      continue
    }
    if (abs(receipt.amount) !== edge.amount) {
      violations.push({
        kind: 'amount_mismatch',
        severity: 'violation',
        detail:
          `transfer ${edge.transactionId} moved ${format(edge.amount)} but the receipt says ` +
          `${format(abs(receipt.amount))}`,
        amount: micro(edge.amount - abs(receipt.amount)),
        repair: {
          counterparty: edge.to,
          // The chain is the truth. If it moved MORE than the receipt says, the
          // ledger understates the debt and needs a further debit (negative).
          amount: micro(abs(receipt.amount) - edge.amount),
          transactionId: edge.transactionId,
          why: 'amount_mismatch',
          window: receipt.window,
        },
      })
      continue
    }
    matched++
  }

  // The strict direction: a receipt claiming a transfer that never happened
  // overstates what the agent owes. That is always a violation.
  const chainTxs = new Set(outbound.map((e) => normalizeTransactionId(e.transactionId)))
  for (const debit of debits) {
    // A receipt with no settlement id cannot be matched in either direction.
    // Count it loudly rather than dropping it: an uncounted skip is how the
    // first version came to print CLEAN over receipts it had never checked.
    if (debit.transactionId.startsWith('unsettled:')) {
      unreconcilable++
      continue
    }
    const key = normalizeTransactionId(debit.transactionId)
    if (repaired.has(key)) {
      alreadyRepaired++
      continue
    }
    if (!chainTxs.has(key)) {
      violations.push({
        kind: 'missing_transfer',
        severity: 'violation',
        detail:
          `debit receipt ${debit.transactionId} for ${format(abs(debit.amount))} has no matching ` +
          'on-chain transfer — the ledger overstates what is owed',
        amount: abs(debit.amount),
        repair: {
          counterparty: debit.counterparty,
          // Positive: this REVERSES a debit for money that never moved.
          amount: abs(debit.amount),
          transactionId: debit.transactionId,
          why: 'missing_transfer',
          window: debit.window,
        },
      })
    }
  }

  return {
    checked: outbound.length,
    matched,
    alreadyRepaired,
    settlementsMatched,
    unreconcilable,
    violations,
    questions,
    chainOutbound: sum(outbound.map((e) => e.amount)),
    receiptDebits: sum(debits.map((d) => abs(d.amount))),
  }
}
