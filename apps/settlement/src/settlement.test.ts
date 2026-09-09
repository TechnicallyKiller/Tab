import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Entry } from '@tab/ledger'
import { micro, usdc } from '@tab/money'
import { unsettledWindows } from './entries.ts'
import { reconcile } from './matching.ts'
import { describeTick, type TickConfig, tick } from './tick.ts'

/**
 * `apps/settlement` — the worker that moves the money.
 *
 * 963 lines, no tests, and the site of the three worst incidents this project
 * has had: a window paid TWICE, a `--dry-run` that executed a real transfer,
 * and a "CLEAN" settlement that moved 0.1000 from an account to itself. Each of
 * those is now a test, because a comment records a lesson and a test enforces
 * it.
 *
 * The matching had to be extracted from `reconcile.ts` first — that file reads
 * `process.env` and throws at module level, so importing the pure function ran
 * the whole CLI. Same reason `recheck.ts` and `ancestry.ts` were split out.
 */

const TAB = '0.0.10390398'
const FLOAT = '0.0.8812188'
const SELLER = '0.0.5000'
const W = 5_963_000

const debit = (tx: string, amount: string, window = W, counterparty = SELLER): Entry => ({
  kind: 'debit',
  at: `${window}.000000000`,
  window,
  holdId: `h-${tx}`,
  counterparty,
  amount: micro(-usdc(amount)),
  transactionId: tx,
})

const edge = (transactionId: string, amount: string, to = SELLER) => ({
  transactionId,
  amount: usdc(amount),
  to,
})

/* ── the direction rule: 16 phantom problems ─────────────────────────────── */

test('an UNRECEIPTED outflow is a question, not a violation', () => {
  /*
   * The float makes operational transfers — funding a demo payer, topping up an
   * account — which are correctly receiptless. Reporting those as violations is
   * what made the reconciler's first run cry wolf 16 times against a correct
   * ledger, which is the worst possible behaviour for the command whose job is
   * proving the books.
   */
  const result = reconcile([], [edge('0.0.1-100-0', '5.000000', '0.0.9999')], FLOAT)
  assert.equal(result.violations.length, 0)
  assert.equal(result.questions.length, 1)
  assert.equal(result.questions[0]!.kind, 'unreceipted_outflow')
  // And it names both possible causes, because we genuinely do not know which.
  assert.match(result.questions[0]!.detail, /crash between pay and commit, or an operational/)
})

test('a debit receipt with NO transfer is always a violation', () => {
  // The strict direction: the ledger says the agent owes money that never
  // moved, which overstates the debt. That is never ambiguous.
  const result = reconcile([debit('0.0.1-100-0', '0.040000')], [], FLOAT)
  assert.equal(result.questions.length, 0)
  assert.equal(result.violations.length, 1)
  assert.equal(result.violations[0]!.kind, 'missing_transfer')
  // A violation always carries the repair, computed here rather than
  // re-derived by the writer.
  const repair = result.violations[0]!.repair
  assert.ok(repair)
  // POSITIVE: this reverses a debit for money that never moved.
  assert.equal(repair.amount, usdc('0.040000'))
  assert.equal(repair.why, 'missing_transfer')
})

test('a question NEVER carries a repair, because it is not known to be wrong', () => {
  const result = reconcile([], [edge('0.0.1-100-0', '5.000000', '0.0.9999')], FLOAT)
  assert.equal(result.questions[0]!.repair, undefined)
})

/* ── the transaction id spellings ────────────────────────────────────────── */

test('the two spellings of one transaction id MATCH', () => {
  /*
   * A receipt says `0.0.x@s.n`; Mirror Node says `0.0.x-s-n`. Comparing them
   * raw makes every transfer look unreceipted — which is exactly how the
   * reconciler first reported 16 phantom discrepancies against a perfectly
   * reconciled ledger.
   */
  const result = reconcile(
    [debit('0.0.10379287@1788620574.542753968', '0.040000')],
    [edge('0.0.10379287-1788620574-542753968', '0.040000')],
    FLOAT,
  )
  assert.equal(result.matched, 1)
  assert.equal(result.violations.length, 0)
  assert.equal(result.questions.length, 0)
})

/* ── amount mismatch, and the direction of its repair ────────────────────── */

test('a chain transfer larger than its receipt understates the debt', () => {
  // The chain is the truth. It moved MORE than the receipt says, so the ledger
  // understates what is owed and the repair must be a FURTHER debit (negative).
  const result = reconcile(
    [debit('0.0.1-100-0', '0.040000')],
    [edge('0.0.1-100-0', '0.050000')],
    FLOAT,
  )
  assert.equal(result.violations.length, 1)
  assert.equal(result.violations[0]!.kind, 'amount_mismatch')
  assert.equal(result.violations[0]!.repair!.amount, micro(-10_000n))
})

test('a chain transfer smaller than its receipt overstates the debt', () => {
  const result = reconcile(
    [debit('0.0.1-100-0', '0.050000')],
    [edge('0.0.1-100-0', '0.040000')],
    FLOAT,
  )
  assert.equal(result.violations[0]!.kind, 'amount_mismatch')
  // Positive: give the agent back what it never spent.
  assert.equal(result.violations[0]!.repair!.amount, micro(10_000n))
})

/* ── idempotence: the money bug of the worst kind ────────────────────────── */

test('a violation ALREADY REPAIRED is not reported again', () => {
  /*
   * Without this the reconciler is not idempotent, and that is a money bug of
   * the worst kind: `--repair` would re-report the same violation on every run
   * and write another reversal each time, so the command whose job is proving
   * the books would be the thing corrupting them. A −0.04 error becomes +0.36
   * after ten runs.
   */
  const entries: Entry[] = [
    debit('0.0.1-100-0', '0.040000'),
    {
      kind: 'repair',
      at: '1.0',
      window: W,
      counterparty: SELLER,
      amount: usdc('0.040000'),
      transactionId: '0.0.1-100-0',
      reason: 'missing_transfer',
    },
  ]
  const result = reconcile(entries, [], FLOAT)
  assert.equal(result.violations.length, 0)
  assert.equal(result.alreadyRepaired, 1)
})

test('a repair is matched to its debit across BOTH id spellings', () => {
  // Idempotence that only worked for one spelling would silently repair twice.
  const entries: Entry[] = [
    debit('0.0.1@100.000000000', '0.040000'),
    {
      kind: 'repair',
      at: '1.0',
      window: W,
      counterparty: SELLER,
      amount: usdc('0.040000'),
      transactionId: '0.0.1-100-000000000',
      reason: 'missing_transfer',
    },
  ]
  const result = reconcile(entries, [], FLOAT)
  assert.equal(result.alreadyRepaired, 1)
  assert.equal(result.violations.length, 0)
})

/* ── a settlement payout is receipted, on a different topic ──────────────── */

test('a netted SETTLEMENT payout is matched, not reported as unreceipted', () => {
  /*
   * A settlement payout is an outflow from the float WITH a receipt — it is
   * just filed on the settlements topic. Without this the reconciler listed
   * every clean settlement as an unreceipted outflow, so the HEALTHIER the
   * rail, the more open questions its own audit tool raised about it.
   */
  const result = reconcile(
    [],
    [edge('0.0.8812188-1788686819-000000000', '0.110000', TAB)],
    FLOAT,
    new Set(['0.0.8812188-1788686819-000000000']),
  )
  assert.equal(result.settlementsMatched, 1)
  assert.equal(result.questions.length, 0)
  assert.equal(result.violations.length, 0)
})

/* ── an unreconcilable receipt is COUNTED, never dropped ─────────────────── */

test('an `unsettled:` debit is counted as unreconcilable, not silently skipped', () => {
  /*
   * There is no transaction id to match, so it cannot be reconciled in either
   * direction. Counting it loudly rather than dropping it matters because an
   * uncounted skip is how the first version came to print CLEAN over receipts
   * it had never checked.
   */
  const result = reconcile([debit('unsettled:h-abc', '0.040000')], [], FLOAT)
  assert.equal(result.unreconcilable, 1)
  assert.equal(result.violations.length, 0)
})

test('an inflow to the float is not an outflow, and is never checked', () => {
  // `to === floatAccount` is money arriving. Treating it as an outflow would
  // demand a debit receipt for every payment the agent EARNED.
  const result = reconcile([], [edge('0.0.1-100-0', '0.150000', FLOAT)], FLOAT)
  assert.equal(result.checked, 0)
  assert.equal(result.questions.length, 0)
})

test('the totals are reported even when everything matches', () => {
  const result = reconcile(
    [debit('0.0.1-100-0', '0.040000'), debit('0.0.2-100-0', '0.060000')],
    [edge('0.0.1-100-0', '0.040000'), edge('0.0.2-100-0', '0.060000')],
    FLOAT,
  )
  assert.equal(result.matched, 2)
  assert.equal(result.chainOutbound, usdc('0.100000'))
  assert.equal(result.receiptDebits, usdc('0.100000'))
})

/* ── which windows are settleable ────────────────────────────────────────── */

test('the window still in progress is NEVER settled', () => {
  // Receipts are still arriving. Settling it would net a half-finished window
  // and leave the rest of it stranded with no window to belong to.
  const entries = [debit('tx1', '0.040000', 100), debit('tx2', '0.040000', 101)]
  assert.deepEqual(unsettledWindows(entries, 101), [100])
})

test('a window with a settlement message is not settled again', () => {
  /*
   * The double-payment bug. The worker replayed only the RECEIPTS topic, so a
   * window it had already settled looked unsettled and it scheduled a second
   * transfer — 0.11 paid twice, on two schedule ids. The fix was to merge both
   * topics before asking this question; this asserts the question itself is
   * right once the settlement entry is present.
   */
  const entries: Entry[] = [
    debit('tx1', '0.040000', 100),
    {
      kind: 'settlement',
      at: '1.0',
      window: 100,
      net: usdc('0.110000'),
      outcome: 'clean',
      rampFromBp: 2500,
      rampToBp: 4000,
    },
  ]
  assert.deepEqual(unsettledWindows(entries, 200), [])
})

test('windows come back in ASCENDING order', () => {
  // Settling out of order would apply ramp steps in the wrong sequence, and the
  // ramp compounds.
  const entries = [debit('a', '0.01', 103), debit('b', '0.01', 101), debit('c', '0.01', 102)]
  assert.deepEqual(unsettledWindows(entries, 200), [101, 102, 103])
})

test('a window with only a HOLD is not settleable — nothing moved', () => {
  // A hold reserves headroom; it is not revenue or spend. Settling a window
  // that only holds would net zero and mark it done, stranding the debit that
  // commits a moment later.
  const entries: Entry[] = [
    {
      kind: 'hold',
      at: '1.0',
      window: 100,
      holdId: 'h1',
      counterparty: SELLER,
      amount: usdc('0.040000'),
      expiresAt: '2.0',
    },
  ]
  assert.deepEqual(unsettledWindows(entries, 200), [])
})

test('a REFUSAL alone does not make a window settleable', () => {
  const entries: Entry[] = [
    {
      kind: 'refusal',
      at: '1.0',
      window: 100,
      counterparty: SELLER,
      requested: usdc('0.500000'),
      rule: 'PER_CALL_CAP',
    },
  ]
  assert.deepEqual(unsettledWindows(entries, 200), [])
})

/* ── the tick: three real incidents ──────────────────────────────────────── */

const CONFIG: TickConfig = {
  tab: TAB,
  window: W,
  windowSeconds: 600,
  ceiling: usdc('0.250000'),
  tokenId: '0.0.429274',
  floatAccount: FLOAT,
  rampBp: 2500,
  tier: 'C',
  floatBalance: usdc('20.000000'),
}

/** Hedera and Mirror clients that EXPLODE if touched. */
const noChain = {
  hedera: {
    get client(): never {
      throw new Error('the chain must not be touched')
    },
    get operatorKey(): never {
      throw new Error('the chain must not be touched')
    },
  },
  mirror: {} as never,
} as never

const credit = (amount: string, window = W): Entry => ({
  kind: 'credit',
  at: `${window}.000000000`,
  window,
  counterparty: SELLER,
  amount: usdc(amount),
  attested: true,
  transactionId: `tx-c-${amount}`,
})

test('A DRY RUN MOVES NOTHING — the flag that once convinced you it was safe', async () => {
  /*
   * The first version's `--dry-run` suppressed only the RECEIPT write. So a dry
   * run scheduled and executed a real transfer on testnet, and then omitted the
   * receipt that marks the window settled — leaving the next real pass ready to
   * pay it a second time. A dry run that moves money is worse than no dry run
   * at all, because the flag is what convinced you it was safe.
   *
   * The chain clients here throw on any access, so this test fails loudly
   * rather than silently if `execute: false` ever stops short-circuiting.
   */
  const result = await tick(noChain, [credit('0.150000')], CONFIG, { execute: false })

  assert.equal(result.planOnly, true)
  assert.equal(result.scheduleId, undefined)
  assert.equal(result.executedAt, undefined)
  // The plan is still computed in full — a dry run should tell you what WOULD
  // happen, which is the only reason to have one.
  assert.equal(result.plan.outcome, 'clean')
  assert.ok(result.plan.transfer > 0n)

  // And it says so on camera.
  const lines = describeTick(result, CONFIG).join('\n')
  assert.match(lines, /WOULD MOVE — held by --dry-run/)
})

test('A SELF-TRANSFER IS REFUSED — the settlement that moved nothing and reported CLEAN', async () => {
  /*
   * The demo ran exactly this. `apps/gateway` used the operator id as the tab
   * id, so the tab and the hot float were one account and the scheduled
   * transfer moved 0.1000 from 0.0.8812188 to 0.0.8812188. Hedera accepted it,
   * consensus executed it, and the tick printed CLEAN with a schedule id — a
   * settlement that looked perfect on camera and moved nothing between two
   * parties.
   *
   * Refused loudly rather than repaired: if the tab equals the float, the
   * CONFIGURATION is wrong, not the transfer.
   */
  await assert.rejects(
    () => tick(noChain, [credit('0.150000')], { ...CONFIG, tab: FLOAT }),
    /the tab .* and the hot float are the same account/,
  )
})

test('the self-transfer check runs BEFORE anything is scheduled', async () => {
  // It has to: the chain clients throw on access, so reaching them at all
  // fails this test with a different message.
  await assert.rejects(
    () => tick(noChain, [credit('0.150000')], { ...CONFIG, tab: FLOAT }),
    (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.doesNotMatch(error.message, /the chain must not be touched/)
      return true
    },
  )
})

test('a POSITIVE net the float cannot cover is MISSED, not clean', async () => {
  /*
   * Claiming a clean settlement we could not fund would be the worst kind of
   * wrong: the ramp would rise, the ceiling would grow, and the agent would be
   * extended more credit on the strength of a payout that never happened.
   */
  const result = await tick(noChain, [credit('0.150000')], {
    ...CONFIG,
    floatBalance: usdc('0.000000'),
  })
  assert.equal(result.plan.outcome, 'missed')
  assert.equal(result.scheduleId, undefined)
  // A missed settlement cuts the ramp — trust is slower to earn than to lose.
  assert.ok(result.plan.rampToBp < CONFIG.rampBp)
})

test('a NEGATIVE net moves nothing and carries forward', async () => {
  // The agent owes; there is no payout to schedule. It rolls into the next
  // window as outstanding rather than being settled to zero.
  const result = await tick(noChain, [debit('tx1', '0.040000')], CONFIG)
  assert.equal(result.scheduleId, undefined)
  assert.notEqual(result.plan.outcome, 'clean')
  assert.ok(result.plan.outstandingAfter > 0n)
})

test('INTEREST is charged on what was owed ENTERING the window', async () => {
  /*
   * Before netting, deliberately. Charging it after would let an agent carry an
   * outstanding balance indefinitely for free — the interest would always be
   * computed on a balance the current window had just cleared.
   */
  const carried: Entry[] = [
    // A debit from an EARLIER window, so it is outstanding entering this one.
    debit('tx-old', '1.000000', W - 1),
  ]
  const result = await tick(noChain, carried, { ...CONFIG, windowSeconds: 600 })
  assert.ok(result.interest > 0n, 'a carried balance must cost something')
})

test('nothing owed means no interest, not a rounding artefact', async () => {
  const result = await tick(noChain, [], CONFIG)
  assert.equal(result.interest, 0n)
})

test('describeTick shows receipts collapsing into ONE transfer', async () => {
  // The claim the whole rail makes. A tick summary that showed only the net
  // would show the transfer and hide the netting.
  const entries = [credit('0.150000'), debit('tx1', '0.040000')]
  const result = await tick(noChain, entries, CONFIG, { execute: false })
  const lines = describeTick(result, CONFIG).join('\n')
  assert.match(lines, /receipts {7}\d+ → 1 transfer/)
  assert.match(lines, /ramp {11}25% → \d+%/)
  // Amounts are FORMATTED, never interpolated as raw bigints.
  const rawMicroUnits = String(usdc('0.150000'))
  assert.ok(!lines.includes(rawMicroUnits), `raw micro-units leaked into:\n${lines}`)
})

test('a missed window reports 0 transfers, so the summary cannot mislead', async () => {
  const result = await tick(noChain, [credit('0.150000')], {
    ...CONFIG,
    floatBalance: usdc('0.000000'),
  })
  const lines = describeTick(result, CONFIG).join('\n')
  assert.match(lines, /→ 0 transfers/)
  assert.match(lines, /outcome {8}MISSED/)
})
