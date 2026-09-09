import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { encode, SCHEMA_VERSION, type TabMessage } from '@tab/protocol'
import { usdc } from '@tab/money'
import {
  ceilingHistoryFromMessages,
  ceilingsFromMessages,
  entriesFromMessages,
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

function at(seconds: number, seq: number): Pick<TopicMessage, 'consensusTimestamp' | 'sequenceNumber'> {
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
  const byTab = ceilingsFromMessages([published(ceiling({ ceil: '0.250000', w: 10, bind: 'starter_floor' }), 1000, 7)])
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
    published(ceiling({ ceil: '0.000000', w: 11, bind: 'unrated', tier: 'Unrated', def: true }), 2000, 2),
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
    published(ceiling({ ceil: '0.000000', w: 11, bind: 'unrated', tier: 'Unrated', cause: 'graph_change' }), 2000, 2),
  ]).get(TAB)

  assert.deepEqual(history?.map((c) => c.ceiling), [
    usdc('0.250000'),
    usdc('0.000000'),
    usdc('0.400000'),
  ])
  assert.equal(history?.at(-1)?.ceiling, ceilingsFromMessages([
    published(ceiling({ ceil: '0.400000', w: 12, bind: 'computed' }), 3000, 3),
  ]).get(TAB)?.ceiling)
})

test('history keeps every ceiling; the collapse is the interesting one', () => {
  const history = ceilingHistoryFromMessages([
    published(ceiling({ ceil: '0.250000', w: 10, bind: 'starter_floor' }), 1000, 1),
    published(ceiling({ ceil: '0.000000', w: 11, bind: 'unrated', tier: 'Unrated', cause: 'graph_change' }), 2000, 2),
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
  assert.equal(ceilingsFromMessages([
    published(ceiling({ ceil: '0.250000', w: 10, bind: 'starter_floor' }), 2000, 2),
  ]).size, 1)
})
