import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bp, format, type MicroUsdc, micro, usdc } from '@tab/money'
import type { Entry } from './entries.ts'
import { inConsensusOrder } from './entries.ts'
import { canReserve, position, resolveHolds } from './holds.ts'
import { accrue } from './interest.ts'
import {
  checkFloatInvariant,
  checkLedger,
  checkPublicLedger,
  checkWindowSettledOnce,
} from './invariants.ts'
import { netWindow, planSettlement, RAMP_START_BP, rampAfter } from './netting.ts'

const CEILING = usdc('1.000000')
const ts = (n: number) => `17886${String(90000 + n).padStart(5, '0')}.000000000`
// Shortly after the entries below, and before their 60s expiries — so a hold is
// pending unless a test deliberately expires it.
const NOW = ts(5)

function hold(id: string, amt: string, at: number, expires = at + 60): Entry {
  return {
    kind: 'hold',
    holdId: id,
    counterparty: '0.0.5120033',
    amount: usdc(amt),
    at: ts(at),
    window: 148,
    expiresAt: ts(expires),
  }
}
function debit(id: string, amt: string, at: number): Entry {
  return {
    kind: 'debit',
    holdId: id,
    counterparty: '0.0.5120033',
    amount: usdc(amt),
    at: ts(at),
    window: 148,
    transactionId: `tx-${id}`,
  }
}
function credit(amt: string, at: number, attested = true): Entry {
  return {
    kind: 'credit',
    counterparty: '0.0.4410877',
    amount: usdc(amt),
    at: ts(at),
    window: 148,
    attested,
    transactionId: `tx-c${at}`,
  }
}

/* ── the write-ahead order ───────────────────────────────────────────────── */

test('a hold reduces available BEFORE the debit exists', () => {
  // This is the whole defence against racing spends past the ceiling.
  const reserved = position([hold('h1', '0.400000', 1)], CEILING, NOW)
  assert.equal(format(reserved.holds), '0.4000')
  assert.equal(format(reserved.available), '0.6000')
  // Balance is untouched — nothing has been paid yet.
  assert.equal(format(reserved.balance), '0.0000')
})

test('committing a hold moves it from holds to balance, not both', () => {
  const after = position([hold('h1', '0.400000', 1), debit('h1', '-0.400000', 2)], CEILING, NOW)
  assert.equal(format(after.holds), '0.0000', 'a committed hold must stop reserving')
  assert.equal(format(after.outstanding), '0.4000')
  assert.equal(format(after.available), '0.6000', 'counting both would halve available')
})

test('an expired hold releases exactly what it reserved', () => {
  const entries = [hold('h1', '0.250000', 1, 2)]
  const before = position(entries, CEILING, ts(1))
  const after = position(entries, CEILING, ts(3))
  assert.equal(format(before.holds), '0.2500')
  assert.equal(format(after.holds), '0.0000')
  assert.equal(format(after.available), '1.0000')
})

test('a crash-shaped gap — paid but never committed — leaves the hold reserving', () => {
  // reserve -> pay -> (crash). The hold still protects the ceiling until it
  // expires, and the reconciler writes a repair.
  const stranded = position([hold('h1', '0.300000', 1, 999)], CEILING, NOW)
  assert.equal(format(stranded.holds), '0.3000')
  assert.equal(format(stranded.available), '0.7000')
})

/* ── replay determinism ──────────────────────────────────────────────────── */

test('position is independent of arrival order', () => {
  const entries: Entry[] = [
    hold('h1', '0.100000', 1),
    debit('h1', '-0.100000', 2),
    credit('0.250000', 3),
    hold('h2', '0.050000', 4),
  ]
  const forward = position(entries, CEILING, NOW)
  const reversed = position([...entries].reverse(), CEILING, NOW)
  const shuffled = position([entries[2]!, entries[0]!, entries[3]!, entries[1]!], CEILING, NOW)
  assert.deepEqual(forward, reversed)
  assert.deepEqual(forward, shuffled)
})

test('duplicate delivery of the same hold reserves once, not twice', () => {
  const once = position([hold('h1', '0.400000', 1)], CEILING, NOW)
  const twice = position([hold('h1', '0.400000', 1), hold('h1', '0.400000', 1)], CEILING, NOW)
  assert.deepEqual(once, twice, 'a redelivered hold must not double-reserve')
})

test('consensus ordering compares nanoseconds, not floats', () => {
  const a: Entry = { ...credit('0.000001', 1), at: '1788690001.000000001' }
  const b: Entry = { ...credit('0.000001', 1), at: '1788690001.000000002' }
  assert.deepEqual(
    inConsensusOrder([b, a]).map((e) => e.at),
    [a.at, b.at],
  )
})

/* ── refusals move nothing ───────────────────────────────────────────────── */

test('a refusal costs the agent nothing', () => {
  const entries: Entry[] = [
    {
      kind: 'refusal',
      counterparty: '0.0.5591204',
      requested: usdc('0.040000'),
      rule: 'CONTROL_CLUSTER',
      at: ts(5),
      window: 148,
    },
  ]
  const p = position(entries, CEILING, NOW)
  assert.equal(format(p.balance), '0.0000')
  assert.equal(format(p.available), '1.0000')
  assert.equal(netWindow(entries, 148).refusalCount, 1)
  assert.equal(format(netWindow(entries, 148).net), '0.0000')
})

/* ── the hand-computed fixture ───────────────────────────────────────────── */

test('hand-computed window: odd micro-amounts net exactly', () => {
  // Deliberately awkward figures so a rounding slip cannot hide.
  //   credits  +0.250000 +0.012345          = +0.262345
  //   debits   -0.018000 -0.040001 -0.009999 = -0.068000
  //   interest -0.000137
  //   net      +0.262345 - 0.068000 - 0.000137 = +0.194208
  const entries: Entry[] = [
    credit('0.250000', 1),
    credit('0.012345', 2),
    hold('h1', '0.018000', 3),
    debit('h1', '-0.018000', 4),
    hold('h2', '0.040001', 5),
    debit('h2', '-0.040001', 6),
    hold('h3', '0.009999', 7),
    debit('h3', '-0.009999', 8),
    { kind: 'interest', amount: usdc('-0.000137'), rateBp: 1200, at: ts(9), window: 148 },
  ]
  const net = netWindow(entries, 148)
  assert.equal(format(net.credits, { sign: 'always' }), '+0.2623')
  assert.equal(format(net.debits, { sign: 'always' }), '−0.0680')
  assert.equal(format(net.interest, { sign: 'always' }), '−0.0001')
  assert.equal(net.net, usdc('0.194208'), 'exact to the micro-USDC')
  assert.equal(net.receiptCount, 5)
})

/* ── interest ────────────────────────────────────────────────────────────── */

test('interest is simple, pro-rated, and truncated in the agent’s favour', () => {
  // 1.000000 at 12% APR for 600s = 1e6 * 1200/10000 * 600 / 31_536_000
  //                              = 120000 * 600 / 31536000 = 2.283... -> 2
  const owed = accrue({ outstanding: usdc('1.000000'), aprBp: bp(1200), seconds: 600 })
  assert.equal(owed, 2n, 'truncated down, never up')
})

test('no outstanding, no interest', () => {
  assert.equal(accrue({ outstanding: micro(0n), aprBp: bp(1200), seconds: 600 }), 0n)
  assert.equal(accrue({ outstanding: usdc('1.000000'), aprBp: bp(1200), seconds: 0 }), 0n)
})

test('interest compounds across windows because each accrues on the new balance', () => {
  let owed: MicroUsdc = usdc('10.000000')
  for (let i = 0; i < 3; i++) {
    owed = micro(owed + accrue({ outstanding: owed, aprBp: bp(1200), seconds: 86_400 }))
  }
  assert.ok(owed > usdc('10.000000'))
  assert.ok(owed < usdc('10.010000'), 'three days at 12% APR should be small')
})

/* ── settlement ──────────────────────────────────────────────────────────── */

test('a positive net with a funded float settles clean and ramps up', () => {
  const plan = planSettlement({
    net: netWindow([credit('0.500000', 1)], 148),
    outstandingBefore: micro(0n),
    rampBp: 3000,
    funded: true,
  })
  assert.equal(plan.outcome, 'clean')
  assert.equal(format(plan.transfer), '0.5000')
  assert.equal(plan.rampToBp, 4500)
})

test('a positive net the float cannot cover is MISSED, and the ramp collapses', () => {
  const plan = planSettlement({
    net: netWindow([credit('0.500000', 1)], 148),
    outstandingBefore: micro(0n),
    rampBp: 4500,
    funded: false,
  })
  assert.equal(plan.outcome, 'missed')
  assert.equal(format(plan.transfer), '0.0000', 'nothing moves if it cannot be paid')
  assert.equal(plan.rampToBp, 1500, 'shrink is instant')
})

test('a negative net is carried, not demanded — the agent has no wallet to pay from', () => {
  const entries = [hold('h1', '0.216000', 1), debit('h1', '-0.216000', 2)]
  const plan = planSettlement({
    net: netWindow(entries, 148),
    outstandingBefore: usdc('0.100000'),
    rampBp: 3000,
    funded: true,
  })
  assert.equal(plan.outcome, 'carried')
  assert.equal(format(plan.transfer), '0.0000')
  assert.equal(format(plan.outstandingAfter), '0.3160')
  assert.equal(plan.rampToBp, 3000, 'carrying is neither rewarded nor punished')
})

test('the ramp clamps at both ends', () => {
  const win = netWindow([credit('0.100000', 1)], 148)
  const high = planSettlement({
    net: win,
    outstandingBefore: micro(0n),
    rampBp: 9500,
    funded: true,
  })
  assert.equal(high.rampToBp, 10_000)
  const low = planSettlement({
    net: win,
    outstandingBefore: micro(0n),
    rampBp: 1000,
    funded: false,
  })
  assert.equal(low.rampToBp, 0)
})

/* ── invariants ──────────────────────────────────────────────────────────── */

test('a clean ledger passes every invariant', () => {
  const result = checkLedger(
    [hold('h1', '0.100000', 1), debit('h1', '-0.100000', 2), credit('0.250000', 3)],
    CEILING,
    NOW,
  )
  assert.equal(result.ok, true, JSON.stringify(result.violations))
  // Update this when you ADD an invariant — it is here so a check cannot be
  // silently dropped, which would make `ok: true` mean less than it appears to.
  assert.equal(result.checked.length, 5)
})

test('a hold committed twice is caught', () => {
  const r = checkLedger(
    [hold('h1', '0.100000', 1), debit('h1', '-0.100000', 2), debit('h1', '-0.100000', 3)],
    CEILING,
    NOW,
  )
  assert.equal(r.ok, false)
  assert.ok(r.violations.some((v) => v.invariant === 'hold_committed_once'))
})

test('a debit that bypassed reserve is caught', () => {
  const r = checkLedger([debit('ghost', '-0.100000', 1)], CEILING, NOW)
  assert.ok(r.violations.some((v) => v.invariant === 'debit_has_hold'))
})

test('debiting MORE than was held is caught — the direction that protects the house', () => {
  const r = checkLedger([hold('h1', '0.100000', 1), debit('h1', '-0.900000', 2)], CEILING, NOW)
  assert.ok(r.violations.some((v) => v.invariant === 'commit_within_hold'))
})

test('debiting LESS than was held is NORMAL, not a violation', () => {
  /*
   * A hold reserves up to `max`; the debit is what the seller actually charged.
   * This invariant required EQUALITY, which was true only while the gateway
   * debited the cap — so fixing that bug made the checker start failing on a
   * correct ledger:
   *
   *     commit_amount_matches_hold: hold h_11c3bc63b0be4530 reserved 0.2000
   *     but debited 0.0400 — the difference is unaccounted for
   *
   * Nothing was unaccounted for. The agent reserved headroom it did not use.
   * Only a live run against real history surfaced it, because every fixture had
   * been written when the two numbers were always equal.
   */
  const r = checkLedger([hold('h1', '0.200000', 1), debit('h1', '-0.040000', 2)], CEILING, NOW)
  assert.equal(r.violations.filter((v) => v.invariant === 'commit_within_hold').length, 0)
})

test('debiting EXACTLY what was held is still fine', () => {
  const r = checkLedger([hold('h1', '0.040000', 1), debit('h1', '-0.040000', 2)], CEILING, NOW)
  assert.equal(r.violations.filter((v) => v.invariant === 'commit_within_hold').length, 0)
})

test('spending past the ceiling is caught', () => {
  const r = checkLedger(
    [hold('h1', '0.900000', 1), debit('h1', '-0.900000', 2), hold('h2', '0.500000', 3)],
    CEILING,
    NOW,
  )
  assert.ok(r.violations.some((v) => v.invariant === 'available_non_negative'))
})

test('the float invariant spans both accounts and names the snapshot time', () => {
  const clean = checkFloatInvariant({
    treasury: usdc('900.000000'),
    hotFloat: usdc('50.000000'),
    floatTotal: usdc('949.500000'),
    outstandingTotal: usdc('0.500000'),
    balanceAsOf: NOW,
  })
  assert.equal(clean.length, 0)

  const broken = checkFloatInvariant({
    treasury: usdc('900.000000'),
    hotFloat: usdc('50.000000'),
    floatTotal: usdc('949.500000'),
    outstandingTotal: usdc('0.400000'),
    balanceAsOf: NOW,
  })
  assert.equal(broken.length, 1)
  // The message must warn about snapshot lag — a stale balance looks exactly
  // like a discrepancy, and that false alarm would discredit verify-tab.
  assert.match(broken[0]!.detail, /snapshots/)
  assert.match(broken[0]!.detail, /1788690005/)
})

/* ── reserve decision ────────────────────────────────────────────────────── */

test('canReserve names the shortfall rather than just refusing', () => {
  const p = position([hold('h1', '0.900000', 1)], CEILING, NOW)
  const no = canReserve(p, usdc('0.200000'))
  assert.equal(no.allowed, false)
  assert.equal(format(no.shortfall!), '0.1000')
  assert.equal(canReserve(p, usdc('0.100000')).allowed, true)
})

test('a zero or negative price is a programming error, not a refusal', () => {
  const p = position([], CEILING, NOW)
  assert.throws(() => canReserve(p, micro(0n)))
  assert.throws(() => canReserve(p, micro(-1n)))
})

/* ── resolveHolds states ─────────────────────────────────────────────────── */

test('holds resolve to pending, committed or expired', () => {
  const entries: Entry[] = [
    hold('pending', '0.100000', 1, 999),
    hold('committed', '0.100000', 2, 999),
    debit('committed', '-0.100000', 3),
    hold('expired', '0.100000', 4, 5),
  ]
  const byId = Object.fromEntries(resolveHolds(entries, ts(10)).map((h) => [h.holdId, h.state]))
  assert.deepEqual(byId, { pending: 'pending', committed: 'committed', expired: 'expired' })
})

/* ── repairs are routed by sign ──────────────────────────────────────────── */

function repair(amt: string, at: number, reason: 'missing_debit' | 'missing_transfer'): Entry {
  return {
    kind: 'repair',
    counterparty: '0.0.5120033',
    amount: usdc(amt),
    at: ts(at),
    window: 148,
    transactionId: `tx-r${at}`,
    reason,
  }
}

test('a missing_debit repair adds a debit', () => {
  const net = netWindow([debit('h1', '-0.040000', 1), repair('-0.040000', 2, 'missing_debit')], 148)
  assert.equal(format(net.debits), '−0.0800')
  assert.equal(format(net.credits), '0.0000')
  assert.equal(format(net.net), '−0.0800')
  assert.equal(net.repairCount, 1)
})

test('a missing_transfer repair reverses the debit without corrupting debits', () => {
  // The receipt claimed 0.04 moved; Mirror Node has no such transaction. The
  // repair cancels it, and the window must read as if the debit never happened.
  const net = netWindow(
    [debit('h1', '-0.040000', 1), repair('0.040000', 2, 'missing_transfer')],
    148,
  )
  assert.equal(format(net.net), '0.0000')
  // The reversal is a credit, so `debits` stays negative as documented.
  assert.equal(format(net.debits), '−0.0400')
  assert.ok(net.debits <= 0n, 'debits must never go positive')
  assert.equal(format(net.credits), '0.0400')
  assert.equal(net.repairCount, 1)
})

test('a reversing repair returns the tab balance to zero', () => {
  const entries = [debit('h1', '-0.040000', 1), repair('0.040000', 2, 'missing_transfer')]
  assert.equal(format(position(entries, CEILING, NOW).balance), '0.0000')
})

/* ── the ramp survives a restart ─────────────────────────────────────────── */

function settled(window: number, at: number, from: number, to: number): Entry {
  return {
    kind: 'settlement',
    at: ts(at),
    window,
    net: usdc('0.100000'),
    outcome: 'clean',
    rampFromBp: from,
    rampToBp: to,
  }
}

test('a tab with no settlements starts at the opening ramp', () => {
  assert.equal(rampAfter([]), RAMP_START_BP)
  assert.equal(rampAfter([debit('h1', '-0.040000', 1)]), RAMP_START_BP)
})

test('the ramp is the last settlement rampTo, not a re-fold of the outcomes', () => {
  // Three clean windows were already stepped when they settled. Re-applying
  // +1500 per clean outcome here would double-count and disagree with the topic.
  const history = [
    settled(146, 1, 2500, 4000),
    settled(147, 2, 4000, 5500),
    settled(148, 3, 5500, 7000),
  ]
  assert.equal(rampAfter(history), 7000)
})

test('the ramp reads in consensus order, not array order', () => {
  const out = [settled(148, 3, 5500, 7000), settled(146, 1, 2500, 4000)]
  assert.equal(rampAfter(out), 7000)
})

/* ── a window settles at most once ───────────────────────────────────────── */

test('two settlement receipts for one window is a material violation', () => {
  // The real incident: the worker replayed only the receipts topic, never saw
  // the settlements topic, and re-paid every closed window on every pass.
  const doubled = [settled(148, 1, 2500, 4000), settled(148, 2, 4000, 5500)]
  const violations = checkWindowSettledOnce(doubled)
  assert.equal(violations.length, 1)
  assert.match(violations[0]!.detail, /window 148 has 2 settlement receipts/)
  assert.equal(violations[0]!.material, true, 'money paid twice is always material')
})

test('one settlement per window passes, across many windows', () => {
  const clean = [
    settled(146, 1, 2500, 4000),
    settled(147, 2, 4000, 5500),
    settled(148, 3, 5500, 7000),
  ]
  assert.deepEqual(checkWindowSettledOnce(clean), [])
})

test('checkLedger surfaces a double settlement', () => {
  const entries = [
    hold('h1', '0.040000', 1),
    debit('h1', '-0.040000', 2),
    settled(148, 3, 2500, 4000),
    settled(148, 4, 4000, 5500),
  ]
  const result = checkLedger(entries, CEILING, NOW)
  assert.equal(result.ok, false)
  assert.ok(result.checked.includes('window_settled_once'))
  assert.ok(result.violations.some((v) => v.invariant === 'window_settled_once'))
})

/* ── holds are published, and the rule is bounded to when they were ─────── */

test('a debit with a published hold passes the hold rule', () => {
  const entries = [hold('h1', '0.040000', 1), debit('h1', '-0.040000', 2)]
  const r = checkPublicLedger(entries, CEILING, NOW, { holdsPublishedFrom: ts(0) })
  assert.equal(r.ok, true, JSON.stringify(r.violations))
  assert.ok(r.checked.includes('debit_has_hold'))
  assert.equal(r.predatingHolds, 0)
})

test('a debit with NO published hold fails — the rule has teeth', () => {
  const entries = [debit('h1', '-0.040000', 2)]
  const r = checkPublicLedger(entries, CEILING, NOW, { holdsPublishedFrom: ts(0) })
  assert.equal(r.ok, false)
  assert.ok(r.violations.some((v) => v.invariant === 'debit_has_hold'))
})

test('debits PREDATING the cutover are excluded and counted, not excused', () => {
  // Holds were added to the protocol after receipts had already been written.
  // Asserting the new rule against old data marked every historical debit as
  // having bypassed reserve — red lines that were not defects, burying the one
  // finding that was.
  const entries = [
    debit('old', '-0.040000', 1),
    hold('h2', '0.040000', 5),
    debit('h2', '-0.040000', 6),
  ]
  const r = checkPublicLedger(entries, CEILING, NOW, { holdsPublishedFrom: ts(4) })
  assert.equal(r.ok, true, 'the post-cutover debit is properly paired')
  assert.equal(r.predatingHolds, 1, 'and the excluded one is reported')
})

test('with no cutover given, every debit is held to the rule', () => {
  // The default is strict. An absent cutover must not silently mean "excuse
  // everything" — that would turn a missing option into a disabled check.
  const r = checkPublicLedger([debit('old', '-0.040000', 1)], CEILING, NOW)
  assert.equal(r.ok, false)
  assert.equal(r.predatingHolds, 0)
})

test('the cutover compares nanoseconds, not just seconds', () => {
  // Two events in the same second must still order correctly, or a hold and its
  // debit written 200ms apart would compare equal.
  const entries = [
    { ...debit('h1', '-0.040000', 1), at: '1788702544.900000000' },
    { ...hold('h1', '0.040000', 1), at: '1788702544.100000000' },
  ]
  const r = checkPublicLedger(entries, CEILING, NOW, {
    holdsPublishedFrom: '1788702544.500000000',
  })
  assert.equal(r.predatingHolds, 0, 'the debit at .9 is after the cutover at .5')
  assert.equal(r.ok, true)
})
