import assert from 'node:assert/strict'
import { test } from 'node:test'
import { format, micro, usdc, type MicroUsdc } from '@tab/money'
import { canonicalHash } from '@tab/protocol'
import { caps } from '@tab/params'
import { computeCeiling } from '@tab/scoring'
import {
  onCleanSettlement, onMissedSettlement, transition, type CeilingState,
} from './guards/asymmetry.ts'
import { ceilingInputRecord } from './publish/ceiling.ts'
import { recompute } from './recompute.ts'
import { revenueFromEntries } from './gather.ts'
import type { Entry } from '@tab/ledger'
import type { AccountFacts, AccountId, TransferEdge } from '@tab/graph'

const TAB = '0.0.1000'
const SELLER = '0.0.2000'
const HONEST = '0.0.3000'
const OTHER = '0.0.4000'

function state(inForce: string, window = 148, pending?: string): CeilingState {
  return { inForce: usdc(inForce), window, ...(pending ? { pending: usdc(pending) } : {}) }
}

/* ── the asymmetry rule ──────────────────────────────────────────────────── */

test('a shrink applies immediately, mid-window', () => {
  // The demo's central moment: the graph catches a control edge, the ceiling
  // collapses, and the very next spend is refused.
  const t = transition(state('10.000000'), usdc('0.000000'), 149)
  assert.equal(t.action, 'shrink_now')
  assert.equal(t.next.inForce, 0n)
  assert.equal(t.next.pending, undefined)
  assert.match(t.reason, /applied immediately/)
})

test('a growth is HELD, not applied', () => {
  const t = transition(state('2.000000'), usdc('10.000000'), 149)
  assert.equal(t.action, 'hold_pending')
  assert.equal(format(t.next.inForce), '2.0000', 'what the fast path enforces has not moved')
  assert.equal(format(t.next.pending!), '10.0000', 'but the operator can see what is waiting')
})

test('a held growth lands on a clean settlement — the only way a ceiling rises', () => {
  const held = transition(state('2.000000'), usdc('10.000000'), 149).next
  const applied = onCleanSettlement(held, 150)
  assert.equal(applied.action, 'grow_on_settlement')
  assert.equal(format(applied.next.inForce), '10.0000')
  assert.equal(applied.next.pending, undefined)
})

test('a held growth is DISCARDED on a missed settlement, not deferred', () => {
  // A missed settlement is the one event that proves the credit decision was
  // wrong. An increase computed before it must not survive it.
  const held = transition(state('2.000000'), usdc('10.000000'), 149).next
  const missed = onMissedSettlement(held, 150)
  assert.equal(format(missed.next.inForce), '2.0000')
  assert.equal(missed.next.pending, undefined)
  assert.match(missed.reason, /DISCARDED, not deferred/)
})

test('a shrink clears a pending growth', () => {
  // Something got worse; an increase computed before it is indefensible after.
  const held = transition(state('2.000000'), usdc('10.000000'), 149).next
  const shrunk = transition(held, usdc('1.000000'), 150)
  assert.equal(shrunk.action, 'shrink_now')
  assert.equal(shrunk.next.pending, undefined)
})

test('an unchanged ceiling drops a stale pending growth', () => {
  // The recompute just said the ceiling should be what it already is, so a
  // pending increase from an earlier run no longer reflects the model.
  const held = transition(state('2.000000'), usdc('10.000000'), 149).next
  const same = transition(held, usdc('2.000000'), 150)
  assert.equal(same.action, 'unchanged')
  assert.equal(same.next.pending, undefined)
  assert.match(same.reason, /stale and dropped/)
})

test('a clean settlement with nothing pending still reports a reason', () => {
  // Silence looks like a stuck engine. The operator gets a line either way.
  const t = onCleanSettlement(state('2.000000'), 150)
  assert.equal(t.action, 'unchanged')
  assert.ok(t.reason.length > 0)
})

test('growth can never reach the fast path without a settlement, over many windows', () => {
  // The property, stated as a loop rather than a single case: however many
  // times a higher ceiling is computed, nothing lands until a window clears.
  let s = state('1.000000')
  for (let w = 149; w < 160; w++) s = transition(s, usdc('50.000000'), w).next
  assert.equal(format(s.inForce), '1.0000', 'eleven recomputes, no increase')
  assert.equal(format(s.pending!), '50.0000')
  assert.equal(format(onCleanSettlement(s, 160).next.inForce), '50.0000')
})

/* ── revenue from receipts ───────────────────────────────────────────────── */

function credit(counterparty: AccountId, amount: string, window: number, attested = true): Entry {
  return {
    kind: 'credit', counterparty, amount: usdc(amount), attested, window,
    at: `1788600${String(1000 + window)}.000000000`, transactionId: `tx-${counterparty}-${window}`,
  }
}

test('the OPEN window is excluded from revenue', () => {
  // Its receipts are still arriving. Including it would make every ceiling sag
  // mid-window and recover at the tick, for no underlying reason.
  const entries = [credit(HONEST, '1.000000', 147), credit(HONEST, '5.000000', 148)]
  const r = revenueFromEntries(entries, 6, 148)
  assert.deepEqual(r.history.map((h) => h.window), [147])
})

test('the attested split is kept so the discount stays auditable', () => {
  const entries = [credit(HONEST, '1.000000', 147), credit(OTHER, '2.000000', 147, false)]
  const r = revenueFromEntries(entries, 6, 148)
  assert.equal(format(r.history[0]!.attested), '1.0000')
  assert.equal(format(r.history[0]!.unattested), '2.0000')
  assert.deepEqual([...r.attestedCounterparties], [HONEST], 'unattested payers earn no diversity')
})

test('windows older than the trailing span age out', () => {
  const entries = [credit(HONEST, '9.000000', 140), credit(HONEST, '1.000000', 147)]
  const r = revenueFromEntries(entries, 3, 148)
  assert.deepEqual(r.history.map((h) => h.window), [147])
})

/* ── the loop attack, end to end through the engine ─────────────────────── */

function facts(entries: Record<AccountId, AccountId[]>): Map<AccountId, AccountFacts> {
  return new Map(Object.entries(entries).map(([id, fundedBy]) => [id, { id, fundedBy }]))
}

const BASE = {
  young: new Set<AccountId>(),
  rampBp: 10_000,
  cleanStreak: 10,
  hasDefaulted: false,
  windowCount: 1,
  hardCap: usdc('1000.000000'),
}

test('LOOP ATTACK: revenue from a seller the agent funded yields a ZERO ceiling', () => {
  // Every payment is real, signed and settled. The ceiling is still zero,
  // because the payer is not an independent economic actor.
  const edges: TransferEdge[] = [
    { from: TAB, to: SELLER, amount: usdc('5.000000'), at: '1788601000.000000000' },
    { from: SELLER, to: TAB, amount: usdc('4.000000'), at: '1788601100.000000000' },
  ]
  const r = recompute({
    ...BASE,
    tab: TAB,
    edges,
    facts: facts({ [SELLER]: [TAB] }),
    history: [{ window: 147, attested: usdc('4.000000'), unattested: usdc('0.000000') }],
    attestedCounterparties: new Set([SELLER]),
    revenueByCounterparty: new Map([[SELLER, usdc('4.000000')]]),
  })

  assert.deepEqual(r.blocked, [SELLER])
  assert.equal(r.ceiling.inputs.revenue, 0n, 'the manufactured revenue weighs nothing')
  assert.equal(r.tier, 'Unrated')
  /*
   * Back to the STARTER FLOOR, not to zero — and that is the honest claim.
   *
   * The attack buys the attacker nothing: it is left with exactly the ceiling
   * any brand-new tab has. Zero would be the wrong answer here, because zero is
   * reserved for a tab that DEFAULTED, and manufacturing revenue is not the
   * same as failing to pay. Confusing the two is what made a new agent unable
   * to ever start.
   *
   * The refusal in the demo therefore comes from the SHRINK: an attacker that
   * spent against an inflated ceiling finds the ceiling gone and the next spend
   * refused. What it never gets is credit it did not earn.
   */
  assert.equal(r.ceiling.binding, 'starter_floor')
  assert.equal(r.ceiling.ceiling, caps.starterCeiling)
})

test('the same revenue from an INDEPENDENT payer earns a real ceiling', () => {
  // The control case, which is what makes the previous test mean anything.
  const edges: TransferEdge[] = [
    { from: HONEST, to: TAB, amount: usdc('4.000000'), at: '1788601100.000000000' },
    { from: OTHER, to: HONEST, amount: usdc('9.000000'), at: '1788601200.000000000' },
  ]
  const r = recompute({
    ...BASE,
    tab: TAB,
    edges,
    facts: new Map(),
    history: [{ window: 147, attested: usdc('4.000000'), unattested: usdc('0.000000') }],
    attestedCounterparties: new Set([HONEST]),
    revenueByCounterparty: new Map([[HONEST, usdc('4.000000')]]),
  })

  assert.deepEqual(r.blocked, [])
  // 4.00 discounted to 3.20 by the concentration cap: a sole customer is by
  // definition 100% of revenue, so the 0.8 step applies. Not double-counted
  // against the tier — C requires only one counterparty, so there is no tier
  // penalty here and the discount is the single price of being undiversified.
  assert.equal(format(r.ceiling.inputs.revenue), '3.2000')
  assert.ok(
    r.weights.find((w) => w.counterparty === HONEST)?.reasons.includes('CONCENTRATED'),
    'and the reason is on the record, not implicit in the number',
  )
  assert.equal(r.tier, 'C', 'one counterparty reaches C, not B')
  assert.ok(r.ceiling.ceiling > 0n)
})

test('funded sellers do not count toward tier diversity', () => {
  // Five buyers the agent funded are not five buyers.
  const funded = ['0.0.5001', '0.0.5002', '0.0.5003', '0.0.5004', '0.0.5005']
  const r = recompute({
    ...BASE,
    tab: TAB,
    edges: funded.map((id) => ({
      from: TAB, to: id, amount: usdc('1.000000'), at: '1788601000.000000000',
    })),
    facts: facts(Object.fromEntries(funded.map((id) => [id, [TAB]]))),
    history: [{ window: 147, attested: usdc('10.000000'), unattested: usdc('0.000000') }],
    attestedCounterparties: new Set(funded),
    revenueByCounterparty: new Map(funded.map((id) => [id, usdc('2.000000')])),
  })
  assert.equal(r.blocked.length, 5)
  assert.equal(r.tier, 'Unrated')
})

/* ── the published record is what verify-ceiling reruns ─────────────────── */

test('the published input record hashes stably and carries every input', () => {
  const result = computeCeiling({
    revenue: usdc('2.500000'),
    attested: usdc('2.500000'),
    unattested: usdc('0.000000'),
    tier: 'B',
    multipleBp: 20_000,
    rampBp: 4000,
    hardCap: usdc('1000.000000'),
    starterFloor: usdc('1.000000'),
    hasDefaulted: false,
  })

  const record = ceilingInputRecord(result)
  // Exactly the fields the protocol's ceilingInputs schema declares — no more,
  // no fewer. A field that affects the output and is not here makes
  // verify-ceiling unable to reproduce the number.
  assert.deepEqual(
    Object.keys(record).sort(),
    ['cap', 'def', 'floor', 'mult', 'ramp', 'rev', 'revAtt', 'revUnatt', 'tier'],
  )
  // Amounts are decimal STRINGS: JSON has no bigint and canonicalize refuses
  // floats outright.
  assert.equal(record['rev'], '2.500000')
  assert.equal(typeof record['ramp'], 'number')
})

test('two hashes of the same inputs match; a changed input changes the hash', async () => {
  const base = {
    revenue: usdc('2.500000'), attested: usdc('2.500000'), unattested: usdc('0.000000'),
    tier: 'B' as const, multipleBp: 20_000, rampBp: 4000,
    hardCap: usdc('1000.000000'), starterFloor: usdc('1.000000'), hasDefaulted: false,
  }
  const a = await canonicalHash(ceilingInputRecord(computeCeiling(base)))
  const b = await canonicalHash(ceilingInputRecord(computeCeiling(base)))
  assert.equal(a, b, 'same inputs, same hash — the verify-ceiling claim')

  const c = await canonicalHash(ceilingInputRecord(computeCeiling({ ...base, rampBp: 4001 })))
  assert.notEqual(a, c, 'one basis point of difference must be visible in the hash')
})

test('a bigint never reaches the hashed record as a number', () => {
  // canonicalize throws on a non-integer float; a bigint would throw on
  // JSON.stringify. Both failures would surface at PUBLISH time, after the
  // ceiling was computed, which is the worst moment to find out.
  const record = ceilingInputRecord(
    computeCeiling({
      revenue: micro(1n) as MicroUsdc, attested: micro(1n) as MicroUsdc,
      unattested: micro(0n) as MicroUsdc, tier: 'C', multipleBp: 12_500, rampBp: 10_000,
      hardCap: usdc('1000.000000'), starterFloor: usdc('1.000000'), hasDefaulted: false,
    }),
  )
  for (const [key, value] of Object.entries(record)) {
    assert.notEqual(typeof value, 'bigint', `${key} must be serialisable`)
  }
})

test('a trailing span of N collects N windows, not N−1', () => {
  // The off-by-one this catches: `<= oldest` dropped the oldest window while
  // effectiveRevenue still divided by N, understating every run-rate by a
  // fixed fraction. A span of 1 collected nothing at all.
  const entries = [
    credit(HONEST, '1.000000', 143),
    credit(HONEST, '1.000000', 144),
    credit(HONEST, '1.000000', 145),
    credit(HONEST, '1.000000', 146),
    credit(HONEST, '1.000000', 147),
  ]
  assert.deepEqual(
    revenueFromEntries(entries, 5, 148).history.map((h) => h.window),
    [143, 144, 145, 146, 147],
    'all five windows of a five-window span',
  )
})

test('a trailing span of 1 is the most recent CLOSED window', () => {
  const entries = [credit(HONEST, '1.000000', 147), credit(HONEST, '9.000000', 148)]
  const r = revenueFromEntries(entries, 1, 148)
  assert.deepEqual(r.history.map((h) => h.window), [147], 'not the open window, and not empty')
  assert.equal(format(r.history[0]!.attested), '1.0000')
})
