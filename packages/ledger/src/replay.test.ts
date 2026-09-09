import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { usdc } from '@tab/money'
import { encode, SCHEMA_VERSION, type TabMessage } from '@tab/protocol'
import {
  ceilingHistoryFromMessages,
  ceilingsFromMessages,
  entriesFromMessages,
  factsFromMessages,
  registrationsFromMessages,
  starterGrantFor,
  type TopicMessage,
} from './replay.ts'

/**
 * Replaying the ceiling and settlement topics.
 *
 * These readers are the console's only source of truth, and a console that
 * shows a number the topic does not carry is worse than a console that shows
 * nothing — so the assertions here are about what a reader is allowed to
 * INVENT, not just about happy-path decoding.
 */

const TAB = '0.0.9001'

function at(
  seconds: number,
  seq: number,
): Pick<TopicMessage, 'consensusTimestamp' | 'sequenceNumber'> {
  // Nanos zero-padded to 9, because the ordering is a STRING comparison —
  // `1788686819.57` sorts before `1788686819.100000000`, which is backwards.
  return { consensusTimestamp: `${seconds}.000000000`, sequenceNumber: seq }
}

function published(message: TabMessage, seconds: number, seq: number): TopicMessage {
  return { payload: encode(message), ...at(seconds, seq) }
}

function ceiling(overrides: {
  ceil: string
  w: number
  bind: 'computed' | 'hard_cap' | 'starter_floor' | 'unrated'
  cause?: 'clean_settlement' | 'missed_settlement' | 'graph_change' | 'registration' | 'freeze'
  tier?: 'A' | 'B' | 'C' | 'Unrated'
  def?: boolean
  computed?: string
}): TabMessage {
  return {
    v: SCHEMA_VERSION,
    t: 'ceiling',
    tab: TAB,
    w: overrides.w,
    ceil: overrides.ceil,
    ...(overrides.computed ? { computed: overrides.computed } : {}),
    bind: overrides.bind,
    inputs: {
      rev: '1.000000',
      revAtt: '0.600000',
      revUnatt: '0.400000',
      tier: overrides.tier ?? 'C',
      mult: 10_000,
      ramp: 2500,
      cap: '2.000000',
      floor: '0.250000',
      ...(overrides.def === undefined ? {} : { def: overrides.def }),
    },
    model: 'tab-v2',
    hash: 'abcdef012345',
    cause: overrides.cause ?? 'clean_settlement',
  } as TabMessage
}

test('a published ceiling carries the arithmetic, not only the result', () => {
  const byTab = ceilingsFromMessages([
    published(ceiling({ ceil: '0.250000', w: 10, bind: 'starter_floor' }), 1000, 7),
  ])
  const snapshot = byTab.get(TAB)
  assert.ok(snapshot)
  assert.equal(snapshot.ceiling, usdc('0.250000'))
  assert.equal(snapshot.inputs.tier, 'C')
  assert.equal(snapshot.inputs.multBp, 10_000)
  assert.equal(snapshot.inputs.rampBp, 2500)
  assert.equal(snapshot.inputs.revAttested, usdc('0.600000'))
  assert.equal(snapshot.inputs.revUnattested, usdc('0.400000'))
  // The seq is what an auditor cites. It must survive the decode.
  assert.equal(snapshot.seq, 7)
})

test('absent `def` normalises to false, so no reader has to know the difference', () => {
  const withoutFlag = ceilingsFromMessages([
    published(ceiling({ ceil: '0.250000', w: 10, bind: 'starter_floor' }), 1000, 1),
  ]).get(TAB)
  assert.equal(withoutFlag?.inputs.defaulted, false)

  const defaulted = ceilingsFromMessages([
    published(
      ceiling({ ceil: '0.000000', w: 11, bind: 'unrated', tier: 'Unrated', def: true }),
      2000,
      2,
    ),
  ]).get(TAB)
  // The distinction this preserves: an Unrated tab with no history gets the
  // starter floor, a tab that DEFAULTED gets exactly zero. Same tier.
  assert.equal(defaulted?.inputs.defaulted, true)
  assert.equal(defaulted?.ceiling, usdc('0.000000'))
})

test('a held growth publishes both numbers, and `ceiling` is the one in force', () => {
  const snapshot = ceilingsFromMessages([
    published(
      ceiling({ ceil: '0.250000', computed: '0.400000', w: 12, bind: 'computed' }),
      3000,
      3,
    ),
  ]).get(TAB)
  // `computed` is what the inputs recompute to; `ceiling` is what the fast path
  // enforces. A console that showed only `computed` would advertise headroom
  // the gateway will refuse.
  assert.equal(snapshot?.ceiling, usdc('0.250000'))
  assert.equal(snapshot?.computed, usdc('0.400000'))
})

test('history is ascending, so the last element is the ceiling in force', () => {
  // Deliberately out of order on the wire. Mirror Node pages, and a page
  // boundary must not decide which ceiling the console thinks is current.
  const history = ceilingHistoryFromMessages([
    published(ceiling({ ceil: '0.400000', w: 12, bind: 'computed' }), 3000, 3),
    published(ceiling({ ceil: '0.250000', w: 10, bind: 'starter_floor' }), 1000, 1),
    published(
      ceiling({ ceil: '0.000000', w: 11, bind: 'unrated', tier: 'Unrated', cause: 'graph_change' }),
      2000,
      2,
    ),
  ]).get(TAB)

  assert.deepEqual(
    history?.map((c) => c.ceiling),
    [usdc('0.250000'), usdc('0.000000'), usdc('0.400000')],
  )
  assert.equal(
    history?.at(-1)?.ceiling,
    ceilingsFromMessages([
      published(ceiling({ ceil: '0.400000', w: 12, bind: 'computed' }), 3000, 3),
    ]).get(TAB)?.ceiling,
  )
})

test('history keeps every ceiling; the collapse is the interesting one', () => {
  const history = ceilingHistoryFromMessages([
    published(ceiling({ ceil: '0.250000', w: 10, bind: 'starter_floor' }), 1000, 1),
    published(
      ceiling({ ceil: '0.000000', w: 11, bind: 'unrated', tier: 'Unrated', cause: 'graph_change' }),
      2000,
      2,
    ),
  ]).get(TAB)
  assert.equal(history?.length, 2)
  // The cause is what makes a zero explainable rather than alarming.
  assert.equal(history?.[1]?.cause, 'graph_change')
})

test('a settlement entry carries the netting, not just the net', () => {
  const settlement: TabMessage = {
    v: SCHEMA_VERSION,
    t: 'settlement',
    tab: TAB,
    w: 10,
    credits: '0.180000',
    debits: '0.070000',
    interest: '0.000000',
    net: '0.110000',
    n: 4,
    tx: '0.0.8812188@1788686819.000000000',
    outcome: 'clean',
    rampFrom: 2500,
    rampTo: 4000,
    outstanding: '0.000000',
  } as TabMessage

  const replay = entriesFromMessages([published(settlement, 5000, 11)])
  const entry = replay.byTab.get(TAB)?.[0]
  assert.equal(entry?.kind, 'settlement')
  assert.ok(entry?.kind === 'settlement')
  // The claim this view exists to make: four receipts became one transfer.
  assert.equal(entry.receiptCount, 4)
  assert.equal(entry.credits, usdc('0.180000'))
  assert.equal(entry.debits, usdc('0.070000'))
  assert.equal(entry.net, usdc('0.110000'))
  assert.equal(entry.outstanding, usdc('0.000000'))
  assert.equal(entry.rampFromBp, 2500)
  assert.equal(entry.rampToBp, 4000)
  assert.equal(entry.transactionId, '0.0.8812188@1788686819.000000000')
})

test('a missed window publishes no transaction id, and none is invented', () => {
  const missed: TabMessage = {
    v: SCHEMA_VERSION,
    t: 'settlement',
    tab: TAB,
    w: 11,
    credits: '0.000000',
    debits: '0.050000',
    interest: '0.000100',
    net: '-0.050100',
    n: 1,
    outcome: 'missed',
    rampFrom: 4000,
    rampTo: 1000,
    outstanding: '0.050100',
  } as TabMessage

  const entry = entriesFromMessages([published(missed, 6000, 12)]).byTab.get(TAB)?.[0]
  assert.ok(entry?.kind === 'settlement')
  assert.equal(entry.transactionId, undefined)
  assert.equal(entry.outstanding, usdc('0.050100'))
  assert.equal(entry.net, usdc('-0.050100'))
})

test('an undecodable message is skipped, never fatal', () => {
  // A topic is append-only and shared. One bad write from months ago must not
  // brick every reader forever.
  const replay = entriesFromMessages([
    { payload: new TextEncoder().encode('{not json'), ...at(1000, 1) },
    published(ceiling({ ceil: '0.250000', w: 10, bind: 'starter_floor' }), 2000, 2),
  ])
  assert.equal(replay.skipped, 1)
  // The ceiling decoded fine — it is simply not an entry.
  assert.equal(replay.replayed, 0)
  assert.equal(
    ceilingsFromMessages([
      published(ceiling({ ceil: '0.250000', w: 10, bind: 'starter_floor' }), 2000, 2),
    ]).size,
    1,
  )
})

/* ── graph facts: the merge is the fix ───────────────────────────────────── */

function fact(overrides: { acct: string; born?: string; by?: string; w?: number }): TabMessage {
  return {
    v: SCHEMA_VERSION,
    t: 'fact',
    tab: TAB,
    w: overrides.w ?? 10,
    acct: overrides.acct,
    ...(overrides.born ? { born: overrides.born } : {}),
    ...(overrides.by ? { by: overrides.by } : {}),
  } as TabMessage
}

test('a funder is remembered, with the seq that established it', () => {
  const replay = factsFromMessages([
    published(fact({ acct: '0.0.5000', born: '1788600000.000000000', by: '0.0.99' }), 1000, 4),
  ])
  const f = replay.byAccount.get('0.0.5000')
  assert.equal(f?.funder, '0.0.99')
  assert.equal(f?.createdAt, '1788600000.000000000')
  assert.equal(f?.funderSeq, 4)
  assert.equal(replay.read, 1)
})

test('A LATER MESSAGE WITH NO FUNDER CANNOT ERASE ONE — this is the whole fix', () => {
  /*
   * The exact failure being closed. Mirror Node's transactions-by-account index
   * is intermittent for new accounts, so a pass during an outage observes no
   * funder and publishes a fact without one. A reader that kept the NEWEST
   * message per account would erase a funding edge correctly observed earlier,
   * un-catching the loop attacker through the mechanism meant to catch it.
   */
  const replay = factsFromMessages([
    published(fact({ acct: '0.0.5000', by: '0.0.99' }), 1000, 1),
    published(fact({ acct: '0.0.5000' }), 2000, 2), // the outage
    published(fact({ acct: '0.0.5000' }), 3000, 3), // and again
  ])
  assert.equal(replay.byAccount.get('0.0.5000')?.funder, '0.0.99')
  // The seq still points at the message that ESTABLISHED it, not the last one.
  assert.equal(replay.byAccount.get('0.0.5000')?.funderSeq, 1)
  assert.equal(replay.conflicts.length, 0)
})

test('the birth time fills in later, because two passes may see different halves', () => {
  const replay = factsFromMessages([
    published(fact({ acct: '0.0.5000', by: '0.0.99' }), 1000, 1),
    published(fact({ acct: '0.0.5000', born: '1788600000.000000000' }), 2000, 2),
  ])
  const f = replay.byAccount.get('0.0.5000')
  assert.equal(f?.funder, '0.0.99')
  assert.equal(f?.createdAt, '1788600000.000000000')
})

test('a DIFFERENT funder is rejected and reported, never silently taken', () => {
  // An account has exactly one creating payer, forever. Two answers means one
  // is wrong, and taking the newer would let a later writer rewrite an
  // account's origin — so the first observation wins and the conflict surfaces.
  const replay = factsFromMessages([
    published(fact({ acct: '0.0.5000', by: '0.0.99' }), 1000, 1),
    published(fact({ acct: '0.0.5000', by: '0.0.4242' }), 2000, 2),
  ])
  assert.equal(replay.byAccount.get('0.0.5000')?.funder, '0.0.99')
  assert.deepEqual(replay.conflicts, [
    { account: '0.0.5000', kept: '0.0.99', rejected: '0.0.4242' },
  ])
})

test('facts for many accounts build the chain a hop walk needs', () => {
  // `operator → intermediary → customer`. The graph walks this by looking each
  // funder up in turn, which is why one funder per message is enough.
  const replay = factsFromMessages([
    published(fact({ acct: '0.0.5002', by: '0.0.5001' }), 1000, 1),
    published(fact({ acct: '0.0.5001', by: '0.0.5000' }), 1100, 2),
  ])
  assert.equal(replay.byAccount.get('0.0.5002')?.funder, '0.0.5001')
  assert.equal(replay.byAccount.get('0.0.5001')?.funder, '0.0.5000')
  assert.equal(replay.byAccount.get('0.0.5000'), undefined)
})

test('facts and ceilings share a topic without confusing either reader', () => {
  // Both live on the ceiling topic. Each reader must skip what is not its own
  // rather than counting it or failing on it.
  const mixed = [
    published(fact({ acct: '0.0.5000', by: '0.0.99' }), 1000, 1),
    published(ceiling({ ceil: '0.250000', w: 10, bind: 'starter_floor' }), 2000, 2),
  ]
  assert.equal(factsFromMessages(mixed).read, 1)
  assert.equal(ceilingsFromMessages(mixed).size, 1)
  // And neither is a ledger entry.
  assert.equal(entriesFromMessages(mixed).replayed, 0)
})

/* ── registrations: one Starter Tab per funding root ─────────────────────── */

function register(over: { tab: string; root?: string; ceil?: string; w?: number }): TabMessage {
  return {
    v: SCHEMA_VERSION,
    t: 'register',
    tab: over.tab,
    w: over.w ?? 10,
    ...(over.root ? { root: over.root } : {}),
    ceil: over.ceil ?? '0.250000',
    perCall: '0.050000',
    allowlist: [],
  } as TabMessage
}

test('FIRST claim on a root wins — the rule that makes bulk-minting pointless', () => {
  /*
   * "Latest wins" — the default every other reader here uses — would break the
   * defence completely: an attacker mints a hundred agents, each registers in
   * turn, each overwrites the last, and every one ends up holding the grant.
   * The defence has to be a race only one participant can win, and consensus
   * order decides it.
   */
  const replay = registrationsFromMessages([
    published(register({ tab: '0.0.1001', root: '0.0.99' }), 1000, 1),
    published(register({ tab: '0.0.1002', root: '0.0.99' }), 2000, 2),
    published(register({ tab: '0.0.1003', root: '0.0.99' }), 3000, 3),
  ])
  assert.equal(replay.byRoot.size, 1)
  assert.equal(replay.byRoot.get('0.0.99')?.tab, '0.0.1001')
  assert.equal(replay.byRoot.get('0.0.99')?.seq, 1)
  // All three are still on record as tabs — only the ROOT is exclusive.
  assert.equal(replay.byTab.size, 3)
  assert.equal(replay.read, 3)
})

test('a hundred minted agents yield ONE starter grant, not a hundred', () => {
  // The claim the README makes, asserted rather than asserted-in-prose.
  const messages = Array.from({ length: 100 }, (_, i) =>
    published(register({ tab: `0.0.${2000 + i}`, root: '0.0.99' }), 1000 + i, i + 1),
  )
  const replay = registrationsFromMessages(messages)

  const granted = Array.from({ length: 100 }, (_, i) =>
    starterGrantFor(`0.0.${2000 + i}`, '0.0.99', replay),
  ).filter((g) => g.status === 'granted')

  assert.equal(granted.length, 1)
  // And the 99 others are told WHO holds it, so the refusal is explainable.
  const denied = starterGrantFor('0.0.2050', '0.0.99', replay)
  assert.equal(denied.status, 'taken')
  assert.equal(denied.heldBy, '0.0.2000')
})

test('a tab RE-registering updates itself without stealing another root', () => {
  const replay = registrationsFromMessages([
    published(register({ tab: '0.0.1001', root: '0.0.99' }), 1000, 1),
    published(register({ tab: '0.0.1002', root: '0.0.88' }), 2000, 2),
    // 1002 re-registers, this time naming a root someone else holds.
    published(register({ tab: '0.0.1002', root: '0.0.99', ceil: '0.500000' }), 3000, 3),
  ])
  // Its own record updates...
  assert.equal(replay.byTab.get('0.0.1002')?.ceiling, usdc('0.500000'))
  // ...but 0.0.99 still belongs to whoever claimed it first.
  assert.equal(replay.byRoot.get('0.0.99')?.tab, '0.0.1001')
  assert.equal(starterGrantFor('0.0.1002', '0.0.99', replay).status, 'taken')
})

test('a ROOTLESS registration claims nothing, so it cannot lock anyone out', () => {
  /*
   * A tab whose ancestry was never observed has not been shown to be
   * independent — it has simply not been seen. Letting it claim a root would
   * let an attacker lock out honest tabs by registering during an indexer
   * outage.
   */
  const replay = registrationsFromMessages([published(register({ tab: '0.0.1001' }), 1000, 1)])
  assert.equal(replay.byRoot.size, 0)
  assert.equal(replay.byTab.size, 1)
})

test('an UNKNOWN root is granted, not refused — an outage must not stop new agents', () => {
  /*
   * Refusing here would mean a Mirror Node outage prevents every new agent from
   * ever starting, which is a far worse failure than the one being defended
   * against. `UNVERIFIED_FUNDING` already discounts what such a tab EARNS, so
   * the grant is the only thing at stake and it is bounded by the starter floor.
   */
  const replay = registrationsFromMessages([])
  assert.equal(starterGrantFor('0.0.1001', undefined, replay).status, 'unknown')
})

test('an unclaimed root is free, and the holder gets it back on a re-read', () => {
  const empty = registrationsFromMessages([])
  assert.equal(starterGrantFor('0.0.1001', '0.0.99', empty).status, 'granted')

  const claimed = registrationsFromMessages([
    published(register({ tab: '0.0.1001', root: '0.0.99' }), 1000, 7),
  ])
  const mine = starterGrantFor('0.0.1001', '0.0.99', claimed)
  assert.equal(mine.status, 'granted')
  // The seq that established the claim, so it can be cited.
  assert.equal(mine.seq, 7)
})

test('registrations share a topic with everything else without confusing a reader', () => {
  const mixed = [
    published(register({ tab: '0.0.1001', root: '0.0.99' }), 1000, 1),
    published(ceiling({ ceil: '0.250000', w: 10, bind: 'starter_floor' }), 2000, 2),
    published(fact({ acct: '0.0.5000', by: '0.0.99' }), 3000, 3),
  ]
  assert.equal(registrationsFromMessages(mixed).read, 1)
  assert.equal(ceilingsFromMessages(mixed).size, 1)
  assert.equal(factsFromMessages(mixed).read, 1)
  assert.equal(entriesFromMessages(mixed).replayed, 0)
})
