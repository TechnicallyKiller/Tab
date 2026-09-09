import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { AccountFacts, AccountId, TransferEdge } from '@tab/graph'
import type { Entry } from '@tab/ledger'
import { format, type MicroUsdc, micro, usdc } from '@tab/money'
import { caps, MODEL_VERSION, weightPolicyFor } from '@tab/params'
import { canonicalHash } from '@tab/protocol'
import { computeCeiling } from '@tab/scoring'
import { type Observation, resolveAncestry } from './ancestry.ts'
import { isYoungFrom, revenueFromEntries } from './gather.ts'
import {
  type CeilingState,
  onCleanSettlement,
  onMissedSettlement,
  transition,
} from './guards/asymmetry.ts'
import { ceilingInputRecord } from './publish/ceiling.ts'
import { newFactFields } from './publish/facts.ts'
import { recompute, WEIGHT_POLICY } from './recompute.ts'

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
    kind: 'credit',
    counterparty,
    amount: usdc(amount),
    attested,
    window,
    at: `1788600${String(1000 + window)}.000000000`,
    transactionId: `tx-${counterparty}-${window}`,
  }
}

test('the OPEN window is excluded from revenue', () => {
  // Its receipts are still arriving. Including it would make every ceiling sag
  // mid-window and recover at the tick, for no underlying reason.
  const entries = [credit(HONEST, '1.000000', 147), credit(HONEST, '5.000000', 148)]
  const r = revenueFromEntries(entries, 6, 148)
  assert.deepEqual(
    r.history.map((h) => h.window),
    [147],
  )
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
  assert.deepEqual(
    r.history.map((h) => h.window),
    [147],
  )
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
      from: TAB,
      to: id,
      amount: usdc('1.000000'),
      at: '1788601000.000000000',
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
  assert.deepEqual(Object.keys(record).sort(), [
    'cap',
    'def',
    'floor',
    'mult',
    'ramp',
    'rev',
    'revAtt',
    'revUnatt',
    'tier',
  ])
  // Amounts are decimal STRINGS: JSON has no bigint and canonicalize refuses
  // floats outright.
  assert.equal(record['rev'], '2.500000')
  assert.equal(typeof record['ramp'], 'number')
})

test('two hashes of the same inputs match; a changed input changes the hash', async () => {
  const base = {
    revenue: usdc('2.500000'),
    attested: usdc('2.500000'),
    unattested: usdc('0.000000'),
    tier: 'B' as const,
    multipleBp: 20_000,
    rampBp: 4000,
    hardCap: usdc('1000.000000'),
    starterFloor: usdc('1.000000'),
    hasDefaulted: false,
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
      revenue: micro(1n) as MicroUsdc,
      attested: micro(1n) as MicroUsdc,
      unattested: micro(0n) as MicroUsdc,
      tier: 'C',
      multipleBp: 12_500,
      rampBp: 10_000,
      hardCap: usdc('1000.000000'),
      starterFloor: usdc('1.000000'),
      hasDefaulted: false,
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
  assert.deepEqual(
    r.history.map((h) => h.window),
    [147],
    'not the open window, and not empty',
  )
  assert.equal(format(r.history[0]!.attested), '1.0000')
})

/* ── the age check, now pure so a remembered birth answers it ────────────── */

const DAY = 86_400

test('a remembered creation time answers the age question as well as a fetched one', () => {
  // The whole reason `isYoung` was split into a fetch and this pure check: the
  // answer must come from a birth time the topic remembers just as readily as
  // from one Mirror Node returned this second.
  const now = 1_800_000_000
  const twoDaysOld = `${now - 2 * DAY}.000000000`
  const thirtyDaysOld = `${now - 30 * DAY}.000000000`

  assert.equal(isYoungFrom(twoDaysOld, now, 7), true)
  assert.equal(isYoungFrom(thirtyDaysOld, now, 7), false)
})

test('an UNKNOWN age is undefined, never "old enough"', () => {
  /*
   * The direction matters. `false` would mean "not young", which grants full
   * weight — so a Mirror Node outage would silently remove the age discount
   * from every counterparty. `undefined` forces the caller to decide, and the
   * engine logs it as a fail-open rather than absorbing it.
   */
  assert.equal(isYoungFrom(undefined, 1_800_000_000, 7), undefined)
  // Garbage in is also unknown, not old.
  assert.equal(isYoungFrom('not-a-timestamp', 1_800_000_000, 7), undefined)
})

test('the age boundary is exclusive at exactly the threshold', () => {
  // Exactly `ageFullDays` old is NOT young — it has reached full credit. An
  // off-by-one here silently discounts every account for one extra day.
  const now = 1_800_000_000
  assert.equal(isYoungFrom(`${now - 7 * DAY}.000000000`, now, 7), false)
  assert.equal(isYoungFrom(`${now - 7 * DAY + 1}.000000000`, now, 7), true)
})

/* ── which observations are worth publishing ─────────────────────────────── */

test('only NEW facts are published — a duplicate costs a message to say nothing', () => {
  const known = new Map([
    ['0.0.5000', { account: '0.0.5000', createdAt: '1.0', funder: '0.0.99' }],
    ['0.0.5001', { account: '0.0.5001', createdAt: '1.0' }],
  ])

  // Already fully known: nothing to add.
  assert.equal(
    newFactFields({ account: '0.0.5000', createdAt: '1.0', funder: '0.0.99' }, known),
    undefined,
  )
  // Known birth, newly observed funder.
  assert.equal(
    newFactFields({ account: '0.0.5001', createdAt: '1.0', funder: '0.0.99' }, known),
    'funder',
  )
  // Never seen at all.
  assert.equal(
    newFactFields({ account: '0.0.5002', createdAt: '1.0', funder: '0.0.99' }, known),
    'both',
  )
})

test('an observation with NO funder is never published — absence carries nothing', () => {
  /*
   * The asymmetry that makes this safe. A reader treats a missing funder as
   * "not observed" and keeps whatever it knew, so publishing an empty fact
   * cannot help — and publishing one for an account we already have a funder
   * for would be paying for a message that a correct reader must ignore.
   */
  const known = new Map([['0.0.5000', { account: '0.0.5000', createdAt: '1.0', funder: '0.0.99' }]])
  assert.equal(newFactFields({ account: '0.0.5000' }, known), undefined)
  assert.equal(newFactFields({ account: '0.0.9999' }, new Map()), undefined)
})

/* ── the fail-open fix: a fact observed once is never forgotten ──────────── */

// `TAB` is already declared above for the ceiling tests; these are the
// ancestry fixtures.
const SHILL = '0.0.7000'
const OPERATOR = '0.0.99'

/** Mirror Node that always works. */
const working = (map: Record<string, Observation>) => async (account: string) => map[account] ?? {}

/** Mirror Node that is down for these accounts — the intermittent index. */
const broken =
  (map: Record<string, Observation>, failing: readonly string[]) => async (account: string) => {
    if (failing.includes(account)) {
      throw new Error('Mirror Node returned 0 transactions (index not populated)')
    }
    return map[account] ?? {}
  }

const CHAIN: Record<string, Observation> = {
  [TAB]: { createdAt: '100.0', funder: OPERATOR },
  [SHILL]: { createdAt: '200.0', funder: OPERATOR },
  [OPERATOR]: { createdAt: '1.0' },
}

test('a working Mirror Node resolves the chain and reports what it observed', async () => {
  const result = await resolveAncestry([TAB, SHILL], {
    observe: working(CHAIN),
    remembered: new Map(),
    hops: 3,
  })
  assert.deepEqual(result.facts.get(TAB)?.fundedBy, [OPERATOR])
  assert.deepEqual(result.facts.get(SHILL)?.fundedBy, [OPERATOR])
  // The shared funder is resolved once, not once per child.
  assert.equal(result.stats.fetched, 3)
  assert.equal(result.stats.remembered, 0)
  assert.equal(result.stats.unknown, 0)
  assert.equal(result.observed.length, 3)
})

test('WITHOUT a memory, a Mirror outage silently weights a shill as independent', async () => {
  /*
   * The bug, reproduced. This is what the engine did on every pass, and it is
   * why the loop attacker ran end to end and was NOT caught: no `fundedBy`
   * means `COMMON_FUNDER` cannot fire, so one operator on both sides of the
   * trade looks like independent demand.
   */
  const result = await resolveAncestry([TAB, SHILL], {
    observe: broken(CHAIN, [SHILL]),
    remembered: new Map(),
    hops: 3,
  })
  assert.equal(result.facts.get(SHILL)?.fundedBy, undefined)
  assert.equal(result.stats.unknown, 1)
})

test('WITH a memory, the same outage is answered by the topic', async () => {
  // The fix. The funding edge survives an index that will not answer.
  const notes: string[] = []
  const result = await resolveAncestry([TAB, SHILL], {
    observe: broken(CHAIN, [SHILL]),
    remembered: new Map([
      [SHILL, { account: SHILL, createdAt: '200.0', funder: OPERATOR, funderSeq: 16 }],
    ]),
    hops: 3,
    note: (l) => notes.push(l),
  })

  assert.deepEqual(result.facts.get(SHILL)?.fundedBy, [OPERATOR])
  assert.equal(result.stats.remembered, 1)
  assert.equal(result.stats.unknown, 0)
  // The age rule gets its answer from the remembered birth too, with no fetch.
  assert.equal(result.birthdays.get(SHILL), '200.0')
  // And it says where the answer came from, citing the sequence number.
  assert.match(notes.join('\n'), /remembered {2}0\.0\.7000 funded by 0\.0\.99 \(published seq 16\)/)
})

test('a remembered funder is still WALKED, so the chain does not stop at the gap', async () => {
  /*
   * Falling back must not merely record the edge — it must keep walking from
   * it. `SHARED_FUNDING_ROOT` needs the chain between two accounts, so a
   * fallback that stopped at the remembered funder would find the edge and
   * still miss the root, which is the same rule silently unreachable again.
   */
  const deep: Record<string, Observation> = {
    '0.0.3000': { createdAt: '300.0', funder: '0.0.2999' },
    '0.0.2999': { createdAt: '299.0', funder: OPERATOR },
    [OPERATOR]: { createdAt: '1.0' },
  }
  const result = await resolveAncestry(['0.0.3000'], {
    observe: broken(deep, ['0.0.3000']),
    remembered: new Map([['0.0.3000', { account: '0.0.3000', funder: '0.0.2999', funderSeq: 5 }]]),
    hops: 3,
  })
  assert.deepEqual(result.facts.get('0.0.3000')?.fundedBy, ['0.0.2999'])
  // Reached one hop PAST the remembered edge, and then the root.
  assert.deepEqual(result.facts.get('0.0.2999')?.fundedBy, [OPERATOR])
  assert.ok(result.facts.has(OPERATOR))
})

test('a SUCCESSFUL fetch that finds no funder cannot erase a remembered one', async () => {
  /*
   * The subtle case, and the one most likely to be got wrong. A pass during a
   * partial outage gets a 200 from the accounts endpoint and nothing from the
   * transactions index: success, with no funder. Taking that at face value
   * would drop an edge the topic already holds — the erase-on-outage bug in a
   * different disguise.
   */
  const result = await resolveAncestry([SHILL], {
    observe: working({ [SHILL]: { createdAt: '200.0' } }), // no funder, no error
    remembered: new Map([
      [SHILL, { account: SHILL, createdAt: '200.0', funder: OPERATOR, funderSeq: 16 }],
    ]),
    hops: 3,
  })
  assert.deepEqual(result.facts.get(SHILL)?.fundedBy, [OPERATOR])
  /*
   * NOT counted as remembered, because Mirror DID answer — the memory only
   * supplied the field it left out. `remembered` counts outages, so inflating
   * it here would hide how often the index is actually failing.
   *
   * Two fetches, not one: the walk continues from the remembered funder, which
   * the previous test requires. My first version of this assertion said one and
   * was simply wrong about the code.
   */
  assert.equal(result.stats.remembered, 0)
  assert.equal(result.stats.fetched, 2)
})

test('the hop limit is respected, so a long chain cannot walk forever', async () => {
  const long: Record<string, Observation> = {
    a: { funder: 'b' },
    b: { funder: 'c' },
    c: { funder: 'd' },
    d: { funder: 'e' },
  }
  const result = await resolveAncestry(['a'], {
    observe: working(long),
    remembered: new Map(),
    hops: 2,
  })
  // Two hops: `a` and `b` resolved, `c` never asked.
  assert.ok(result.facts.has('a'))
  assert.ok(result.facts.has('b'))
  assert.equal(result.facts.has('c'), false)
})

test('a funding CYCLE terminates rather than recursing forever', async () => {
  // Impossible on Hedera — an account cannot create its own creator — but the
  // walk takes its input from an index, and an index can be wrong. A hang here
  // would stall the engine, not fail it, which is far harder to notice.
  const cycle: Record<string, Observation> = { x: { funder: 'y' }, y: { funder: 'x' } }
  const result = await resolveAncestry(['x'], {
    observe: working(cycle),
    remembered: new Map(),
    hops: 10,
  })
  assert.equal(result.stats.fetched, 2)
})

test('the walk reports which accounts have NO established provenance', () => {
  // Feeds `UNVERIFIED_FUNDING`. Before v3 this set was computed by nobody and
  // an unverifiable counterparty was weighted independent.
  return resolveAncestry([TAB, SHILL], {
    observe: broken(CHAIN, [SHILL]),
    remembered: new Map(),
    hops: 3,
  }).then((result) => {
    assert.equal(result.unverified.has(SHILL), true)
    // The tab resolved fine, so it is not unverified.
    assert.equal(result.unverified.has(TAB), false)
    // The operator legitimately has no funder in this fixture — a genesis-like
    // account. Counting it as unverified is harmless and is the safe direction;
    // only counterparties are ever weighted on it.
    assert.equal(result.unverified.has(OPERATOR), true)
  })
})

test('a REMEMBERED funder removes an account from the unverified set', () => {
  // The two mechanisms compose: publishing facts closes "seen once, then the
  // index flaked", and this confirms the v3 discount does not then punish an
  // account the topic can vouch for.
  return resolveAncestry([SHILL], {
    observe: broken(CHAIN, [SHILL]),
    remembered: new Map([[SHILL, { account: SHILL, funder: OPERATOR, funderSeq: 16 }]]),
    hops: 3,
  }).then((result) => {
    assert.equal(result.unverified.has(SHILL), false)
  })
})

test('the engine refuses to run on a parameter set with no weight policy', () => {
  /*
   * `WEIGHT_POLICY` throws rather than falling back to the constants that used
   * to live in `recompute.ts`. A fallback would let the engine keep publishing
   * weights computed from numbers that are not in the frozen record, which is
   * the exact condition moving them into `@tab/params` exists to end.
   *
   * Asserted through the frozen sets rather than by re-importing under a stub:
   * v3 has a policy, v1 and v2 do not, and the guard is what stands between
   * those two facts and a silently wrong weight.
   */
  assert.ok(WEIGHT_POLICY.unverifiedBp !== undefined)
  assert.equal(WEIGHT_POLICY.sharedRootBp, weightPolicyFor(MODEL_VERSION)?.sharedRootBp)
  assert.equal(weightPolicyFor(2), undefined)
})

/* ── the Starter Tab grant: one per funding root ─────────────────────────── */

test('a tab denied the starter grant gets NO floor, and must earn its ceiling', () => {
  /*
   * The rule that makes bulk-minting pointless. The floor is a GRANT, and a
   * grant handed out per-account is a grant an attacker mints accounts to farm.
   *
   * Zero rather than a refusal, deliberately: the tab still works, still spends
   * what it earns, and still settles. It is denied the free headroom, not the
   * rail.
   */
  const base = {
    tab: TAB,
    edges: [] as TransferEdge[],
    facts: new Map<AccountId, AccountFacts>(),
    history: [],
    attestedCounterparties: new Set<AccountId>(),
    revenueByCounterparty: new Map<AccountId, MicroUsdc>(),
    young: new Set<AccountId>(),
    rampBp: 2500,
    cleanStreak: 0,
    hasDefaulted: false,
    windowCount: 6,
    hardCap: usdc('100.000000'),
  }

  const held = recompute({ ...base, starterGrant: 'granted' })
  const denied = recompute({ ...base, starterGrant: 'taken' })

  assert.equal(held.ceiling.ceiling, caps.starterCeiling)
  assert.equal(held.ceiling.binding, 'starter_floor')
  // No revenue and no floor means no credit at all — it has to earn it.
  assert.equal(denied.ceiling.ceiling, 0n)
})

test('an UNRESOLVED root still gets the floor — an outage must not stop new agents', () => {
  /*
   * Refusing here would mean a Mirror Node outage prevents every new agent from
   * ever starting, which is a far worse failure than the one being defended
   * against. `UNVERIFIED_FUNDING` already discounts what such a tab EARNS, so
   * the grant is the only thing at stake and it is bounded by the starter floor.
   */
  const result = recompute({
    tab: TAB,
    edges: [],
    facts: new Map(),
    history: [],
    attestedCounterparties: new Set(),
    revenueByCounterparty: new Map(),
    young: new Set(),
    starterGrant: 'unknown',
    rampBp: 2500,
    cleanStreak: 0,
    hasDefaulted: false,
    windowCount: 6,
    hardCap: usdc('100.000000'),
  })
  assert.equal(result.ceiling.ceiling, caps.starterCeiling)
})

test('omitting starterGrant behaves exactly as before — the floor applies', () => {
  // Optional so a caller that does not resolve roots is unchanged. A default of
  // `taken` would silently zero every existing tab.
  const result = recompute({
    tab: TAB,
    edges: [],
    facts: new Map(),
    history: [],
    attestedCounterparties: new Set(),
    revenueByCounterparty: new Map(),
    young: new Set(),
    rampBp: 2500,
    cleanStreak: 0,
    hasDefaulted: false,
    windowCount: 6,
    hardCap: usdc('100.000000'),
  })
  assert.equal(result.ceiling.ceiling, caps.starterCeiling)
})

test('a denied tab with real revenue still earns a ceiling — it is not frozen', () => {
  /*
   * The point of zeroing the floor rather than refusing. A shill minted from the
   * same wallet gets no free headroom, but a LEGITIMATE second agent under one
   * operator can still trade its way up on independent revenue.
   */
  const customer = '0.0.7777'
  const result = recompute({
    tab: TAB,
    edges: [],
    // Independent: no shared ancestry with the tab.
    facts: new Map([[customer, { id: customer, fundedBy: ['0.0.4242'] }]]),
    history: [
      { window: 1, attested: usdc('2.000000'), unattested: usdc('0.000000') },
      { window: 2, attested: usdc('2.000000'), unattested: usdc('0.000000') },
    ],
    attestedCounterparties: new Set([customer]),
    revenueByCounterparty: new Map([[customer, usdc('4.000000')]]),
    young: new Set(),
    starterGrant: 'taken',
    rampBp: 10_000,
    cleanStreak: 5,
    hasDefaulted: false,
    windowCount: 2,
    hardCap: usdc('100.000000'),
  })
  assert.ok(result.ceiling.ceiling > 0n, 'earned credit must survive a denied grant')
  assert.notEqual(result.ceiling.binding, 'starter_floor')
})
