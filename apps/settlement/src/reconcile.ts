/**
 * The reconciler.
 *
 * Diffs Mirror Node outbound transfers against the receipt topic. A crash
 * between *pay* and *commit* leaves a transfer with no receipt; this finds it
 * and writes a repair.
 *
 * The output is a deliverable, not debug logging — it runs on camera and its
 * job is to be readable by someone who has never seen the codebase.
 *
 *   pnpm reconcile
 */
import { clientFromEnv, submitMessage } from '@tab/hedera'
import {
  MirrorClient, configureGlobalHttp, getTransactions, normalizeTransactionId, toTransferEdges,
} from '@tab/mirror'
import { abs, format, micro, sum, toWire, type MicroUsdc } from '@tab/money'
import type { Entry } from '@tab/ledger'
import { encode, repairReceipt } from '@tab/protocol'
import { replayEntries } from './entries.ts'

configureGlobalHttp({ connectTimeoutMs: 60_000 })

/**
 * Only ONE direction is a real invariant, and getting this wrong is what made
 * the reconciler's first run report 16 phantom problems.
 *
 *  - **Every debit receipt MUST have a matching transfer.** A failure means the
 *    ledger says the agent owes money that never moved. Critical.
 *  - **Not every transfer has a receipt.** The float also makes operational
 *    transfers — funding a demo payer, topping up an account — which are
 *    correctly receiptless. An unreceipted outflow is a *question*, not a
 *    violation: it might be a crash between pay and commit, or it might be an
 *    operator moving float around.
 *
 * Reporting the second as a violation would cry wolf on a healthy ledger, which
 * is the worst possible behaviour for the command whose job is proving the books.
 */
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
): Reconciliation {
  const debits = entries.filter(
    (e): e is Extract<Entry, { kind: 'debit' }> => e.kind === 'debit',
  )

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

  for (const edge of outbound) {
    const receipt = byTx.get(normalizeTransactionId(edge.transactionId))
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
    unreconcilable,
    violations,
    questions,
    chainOutbound: sum(outbound.map((e) => e.amount)),
    receiptDebits: sum(debits.map((d) => abs(d.amount))),
  }
}

// ── runnable report ─────────────────────────────────────────────────────────

const tokenId = process.env['USDC_TOKEN_ID']
const receiptTopic = process.env['TOPIC_RECEIPTS']
if (!tokenId || !receiptTopic) throw new Error('USDC_TOKEN_ID and TOPIC_RECEIPTS are required')

const hedera = clientFromEnv()
const mirror = new MirrorClient({ network: hedera.network, timeoutMs: 45_000, maxRetries: 4, maxPages: 12 })
const floatAccount = hedera.operatorId.toString()

console.log(`\nReconciliation · Mirror Node vs receipt topic\n`)
console.log(`  float account   ${floatAccount}`)
console.log(`  token           ${tokenId}`)
console.log(`  receipt topic   ${receiptTopic}\n`)

const replay = await replayEntries(mirror, receiptTopic)
const entries = replay.byTab.get(floatAccount) ?? []
console.log(`  replayed        ${replay.replayed} entries · ${replay.skipped} skipped (pre-schema)`)

/**
 * Bound the walk to a window.
 *
 * The first version walked the float account's ENTIRE history and hung: Mirror
 * Node takes 5-15s per page from here and the operator has hundreds of
 * transactions. Not a performance detail — the spec says reconcile "on every
 * window close", and a window is the right unit. Reconciling all history on
 * every tick gets slower forever.
 */
const repairing = process.argv.includes('--repair')
const sinceArg = process.argv.find((a) => a.startsWith('--since='))?.split('=')[1]
const lookback = Number(process.env['RECONCILE_LOOKBACK_SECONDS'] ?? 3600)
const from = sinceArg ?? `${Math.floor(Date.now() / 1000) - lookback}.000000000`
console.log(`  range           from ${from}${sinceArg ? '' : ` (last ${lookback}s)`}`)

const walk = await getTransactions(mirror, { accountId: floatAccount, from, pageSize: 100 })
const edges = toTransferEdges(walk.items, tokenId).filter((e) => e.from === floatAccount)
console.log(`  chain transfers ${edges.length} outbound over ${walk.pagesFetched} page(s)`)
if (walk.truncated) {
  console.log('  WARNING         hit maxPages — the diff is INCOMPLETE')
  console.log(`                  resume from ${walk.resumeFrom}`)
}

// Reconcile only receipts inside the same range, or a receipt from before the
// window looks like a violation purely because its transfer was not fetched.
// Compare numerically, not as strings: consensus timestamps are `seconds.nanos`
// and lexicographic order only coincides with time order while the seconds part
// has a fixed digit count.
const seconds = (ts: string) => Number(ts.split('.')[0] ?? 0)
const fromSeconds = seconds(from)
const inRange = entries.filter((e) => seconds(e.at) >= fromSeconds)
console.log(`  receipts        ${inRange.length} of ${entries.length} in range`)

const result = reconcile(
  inRange,
  edges.map((e) => ({ transactionId: e.transactionId, amount: e.amount, to: e.to })),
  floatAccount,
)

/*
 * What the CLEAN claim is allowed to rest on.
 *
 * Only receipts actually confirmed against a transfer, plus ones a previous run
 * already corrected. Counting every non-`unsettled:` debit was wrong twice over:
 * it included the very receipt under repair, so the report said "has a matching
 * on-chain transfer" about the one receipt that provably does not.
 */
const verified = result.matched + result.alreadyRepaired

console.log(`
  checked ${result.checked} outbound · matched ${result.matched} · violations ${result.violations.length} · questions ${result.questions.length}${
    result.alreadyRepaired > 0 ? ` · ${result.alreadyRepaired} already repaired` : ''
  }

  chain outbound  ${format(result.chainOutbound)}   (includes operational transfers)
  receipt debits  ${format(result.receiptDebits)}`)

/*
 * "CLEAN" over an empty window is a vacuous claim, and stating it would be the
 * cry-wolf mistake inverted: a reconciler that reports the books proven when it
 * checked nothing is worse than one that reports nothing at all. Say which.
 */
if (verified === 0 && result.violations.length === 0) {
  console.log(`
  NOTHING TO RECONCILE — ${result.checked} outbound transfer(s) and ${inRange.length} receipt(s)
  in range, but nothing verifiable either way. This is NOT a clean bill of
  health. Widen the range with --since=<seconds.nanos>, or see the unreconcilable
  count below.`)
} else if (result.violations.length === 0) {
  console.log(`
  CLEAN — no debit receipt in range claims a movement the chain does not show.
  ${result.matched} confirmed against an on-chain transfer to the micro-USDC${
    result.alreadyRepaired > 0 ? `, ${result.alreadyRepaired} corrected by an earlier repair` : ''
  }.`)
} else {
  console.log(`\n  ${result.violations.length} VIOLATION(S) — the ledger disagrees with the chain:\n`)
  for (const d of result.violations) console.log(`    [${d.kind}] ${d.detail}`)
  console.log(`
  Each is repairable — a repair receipt on the topic makes the ledger reflect
  what actually happened on chain. Nothing here is lost money.

  ${repairing ? 'Writing repairs now (--repair given).' : 'Report only. Re-run with --repair to write them.'}`)
}

if (result.unreconcilable > 0) {
  console.log(`
  ${result.unreconcilable} UNRECONCILABLE receipt(s) — a defect in the spend path, not the diff:

    These debit receipts carry an \`unsettled:<holdId>\` placeholder where the
    settlement transaction id belongs. The transfer very likely happened; there
    is simply no id recorded to match it against, so no amount of reconciling
    can prove it either way. The fix belongs upstream — the spend path must
    write the real transaction id once the transfer lands, or emit a follow-up
    receipt carrying it. Until then this is the ledger's blind spot.`)
}

if (result.questions.length > 0) {
  console.log(`\n  ${result.questions.length} unreceipted outflow(s) — for an operator to confirm, not violations:\n`)
  for (const d of result.questions) console.log(`    ${d.detail}`)
  console.log(`
  Not every float outflow is an agent spend. Funding a payer or topping up an
  account correctly has no debit receipt. Only the reverse direction — a receipt
  with no transfer — is a hard invariant.`)
}
/*
 * Writing a repair appends to the public receipt topic and cannot be undone, so
 * it is opt-in. The report is the default because the report is the deliverable;
 * a tool that silently mutates the record while you are reading its output is
 * not a tool you would run on camera.
 */
if (repairing && result.violations.length > 0) {
  console.log(`  Writing ${result.violations.length} repair receipt(s) to ${receiptTopic}\n`)
  for (const v of result.violations) {
    if (!v.repair) {
      console.log(`    SKIP  ${v.kind} carries no repair plan`)
      continue
    }
    const message = repairReceipt.parse({
      v: 1,
      t: 'repair',
      tab: floatAccount,
      w: v.repair.window,
      cp: v.repair.counterparty,
      amt: toWire(v.repair.amount),
      tx: v.repair.transactionId,
      why: v.repair.why,
    })
    // encode() throws on an oversize or malformed message rather than returning
    // a result — a topic is append-only, so refusing to write beats writing
    // something permanent and wrong. Let it throw and abort the run.
    const written = await submitMessage(hedera.client, receiptTopic, encode(message))
    console.log(
      `    WROTE ${v.repair.why} ${format(v.repair.amount)} to ${v.repair.counterparty}` +
        ` · seq ${written.sequenceNumber}`,
    )
  }
  console.log(`
  The ledger and the chain now agree. Re-run without --repair to confirm; the
  repairs replay from the topic like any other receipt, so the confirmation
  reads the same public record anyone else can.`)
}

console.log()

hedera.close()
process.exit(0)
