import assert from 'node:assert/strict'
import { test } from 'node:test'
import { usdc, type MicroUsdc } from '@tab/money'
import { fundedWithin, fundingAncestry, sharedFundingRoot } from './ancestry.ts'
import { detectCluster, reciprocity } from './clusters.ts'
import { concentration } from './concentration.ts'
import { applyWeight, weightOf, type WeightPolicy } from './weights.ts'
import type { AccountFacts, AccountId, TransferEdge } from './types.ts'

const AGENT = '0.0.1000'
const SELLER = '0.0.2000'
const HONEST = '0.0.3000'
const EXCHANGE = '0.0.9000'

function facts(entries: Record<AccountId, AccountId[]>): Map<AccountId, AccountFacts> {
  return new Map(Object.entries(entries).map(([id, fundedBy]) => [id, { id, fundedBy }]))
}

let clock = 0
function edge(from: AccountId, to: AccountId, amount: string): TransferEdge {
  clock += 1
  return { from, to, amount: usdc(amount), at: `178860${String(1000 + clock)}.000000000` }
}

const POLICY: WeightPolicy = {
  reciprocalBp: 5000,
  reciprocalThresholdBp: 2500,
  sharedRootBp: 7000,
  youngBp: 6000,
  concentratedBp: 8000,
  unattestedBp: 6000,
}

/* ── ancestry terminates ─────────────────────────────────────────────────── */

test('a funding cycle terminates instead of hanging', () => {
  // A funds B, B funds C, C funds A. Ordinary for accounts under one operator,
  // and exactly the shape an attacker produces. Without a visited set this
  // walks forever, and a hang in the demo looks identical to a crash.
  const cyclic = facts({ '0.0.1': ['0.0.3'], '0.0.2': ['0.0.1'], '0.0.3': ['0.0.2'] })
  const result = fundingAncestry('0.0.1', cyclic, 50)
  assert.deepEqual([...result.ancestors].sort(), ['0.0.2', '0.0.3'])
  // Each reached once, at its shortest distance — never revisited.
  assert.equal(result.hops.get('0.0.3'), 1)
  assert.equal(result.hops.get('0.0.2'), 2)
})

test('an account that funds itself does not loop', () => {
  const selfFunded = facts({ '0.0.1': ['0.0.1'] })
  assert.deepEqual(fundingAncestry('0.0.1', selfFunded, 10).ancestors, [])
})

test('hops record the SHORTEST path, not the path taken', () => {
  // X is reachable at 1 hop directly and at 3 hops the long way. Breadth-first
  // must record 1 — "funded within 3 hops" is a claim about the closest link.
  const graph = facts({
    [AGENT]: ['0.0.10', '0.0.11'],
    '0.0.11': ['0.0.12'],
    '0.0.12': ['0.0.10'],
  })
  assert.equal(fundingAncestry(AGENT, graph, 5).hops.get('0.0.10'), 1)
})

test('the hop limit bounds the walk and reports truncation honestly', () => {
  const chain = facts({
    [AGENT]: ['0.0.10'], '0.0.10': ['0.0.11'], '0.0.11': ['0.0.12'], '0.0.12': ['0.0.13'],
  })
  const short = fundingAncestry(AGENT, chain, 2)
  assert.deepEqual([...short.ancestors].sort(), ['0.0.10', '0.0.11'])
  assert.equal(short.truncated, true, 'more graph existed beyond the limit')

  const full = fundingAncestry(AGENT, chain, 10)
  assert.equal(full.truncated, false, 'the graph ran out before the limit did')
})

test('a negative or fractional hop limit is a programming error', () => {
  assert.throws(() => fundingAncestry(AGENT, new Map(), -1), /non-negative integer/)
  assert.throws(() => fundingAncestry(AGENT, new Map(), 1.5), /non-negative integer/)
})

/* ── the loop attack ─────────────────────────────────────────────────────── */

test('THE LOOP ATTACK: the agent funds a seller, then buys from it', () => {
  // The whole point of the package. Every individual payment here is real,
  // signed and settled — and the revenue is the agent's own float in a circle.
  const graph = facts({ [SELLER]: [AGENT] })
  const edges = [edge(AGENT, SELLER, '5.000000'), edge(AGENT, SELLER, '0.040000')]

  const finding = detectCluster({ agent: AGENT, counterparty: SELLER, edges, facts: graph, maxHops: 3 })
  assert.equal(finding.clustered, true)
  assert.ok(finding.reasons.includes('FUNDED_BY_AGENT'))

  const weight = weightOf({ agent: AGENT, counterparty: SELLER, edges, facts: graph, maxHops: 3, policy: POLICY })
  assert.equal(weight.bp, 0, 'a controlled seller contributes nothing')
  assert.equal(weight.blocking, true, 'and the spend is refused, not merely discounted')
  assert.equal(applyWeight(usdc('100.000000'), weight), 0n)
})

test('funding beyond the hop limit is not a block — the limit is the rule', () => {
  const distant = facts({ [SELLER]: ['0.0.20'], '0.0.20': ['0.0.21'], '0.0.21': [AGENT] })
  assert.equal(fundedWithin(AGENT, SELLER, distant, 3).funded, true)
  assert.equal(fundedWithin(AGENT, SELLER, distant, 2).funded, false)
})

test('a seller whose only counterparty is the agent is clustered', () => {
  // No funding link at all — caught by the second rule instead.
  const edges = [edge(AGENT, SELLER, '0.040000'), edge(SELLER, AGENT, '0.010000')]
  const finding = detectCluster({ agent: AGENT, counterparty: SELLER, edges, facts: new Map(), maxHops: 3 })
  assert.equal(finding.clustered, true)
  assert.ok(finding.reasons.includes('SOLE_COUNTERPARTY'))
})

test('an independent seller with other customers is counted in full', () => {
  const edges = [
    edge(AGENT, HONEST, '0.040000'),
    edge('0.0.4000', HONEST, '1.000000'),
    edge('0.0.5000', HONEST, '2.000000'),
  ]
  const weight = weightOf({ agent: AGENT, counterparty: HONEST, edges, facts: new Map(), maxHops: 3, policy: POLICY })
  assert.equal(weight.bp, 10_000)
  assert.equal(weight.blocking, false)
  assert.deepEqual(weight.reasons, ['INDEPENDENT'], 'counting in full is a decision with a reason too')
})

test('the agent is never its own independent counterparty', () => {
  const finding = detectCluster({ agent: AGENT, counterparty: AGENT, edges: [], facts: new Map(), maxHops: 3 })
  assert.equal(finding.clustered, true)
})

/* ── reciprocity ─────────────────────────────────────────────────────────── */

test('value flowing back is measured as a ratio in basis points', () => {
  const edges = [edge(AGENT, SELLER, '1.000000'), edge(SELLER, AGENT, '0.400000')]
  const r = reciprocity(AGENT, SELLER, edges, 2500)
  assert.equal(r.ratioBp, 4000)
  assert.equal(r.reciprocal, true)
})

test('revenue from an account the agent never paid is not circular', () => {
  // The shape of genuine independent demand: inflow, no outflow.
  const edges = [edge(HONEST, AGENT, '5.000000')]
  const r = reciprocity(AGENT, HONEST, edges, 2500)
  assert.equal(r.ratioBp, 0)
  assert.equal(r.reciprocal, false, 'no outflow means there is no circularity to find')
})

/* ── shared roots ────────────────────────────────────────────────────────── */

test('a shared funding root is found at its true distance', () => {
  const graph = facts({ [AGENT]: [EXCHANGE], [SELLER]: ['0.0.21'], '0.0.21': [EXCHANGE] })
  const shared = sharedFundingRoot(AGENT, SELLER, graph, 3)
  assert.equal(shared.shared, true)
  assert.equal(shared.root, EXCHANGE)
  // 1 hop from the agent, 2 from the seller — ranked by the LONGER leg, since
  // taking the minimum would overstate how closely the two are related.
  assert.equal(shared.hops, 2)
})

test('unrelated accounts share no root', () => {
  const graph = facts({ [AGENT]: ['0.0.10'], [SELLER]: ['0.0.20'] })
  assert.equal(sharedFundingRoot(AGENT, SELLER, graph, 3).shared, false)
})

/* ── concentration, in integers ──────────────────────────────────────────── */

test('concentration is computed in basis points, never floats', () => {
  const revenue = new Map<AccountId, MicroUsdc>([
    [HONEST, usdc('4.000000')],
    ['0.0.4000', usdc('6.000000')],
  ])
  const result = concentration(revenue, 4000)
  assert.equal(result.topShareBp, 6000)
  assert.equal(result.entries.find((e) => e.counterparty === HONEST)?.shareBp, 4000)
})

test('EXACTLY at the cap is not over it — the boundary a float would flip', () => {
  // 0.4 has no exact binary representation. Computed as a float, a 40% share
  // can land either side of the cap depending on how it was derived, and a rule
  // that decides differently on identical inputs is worse than no rule.
  const revenue = new Map<AccountId, MicroUsdc>([
    [HONEST, usdc('40.000000')],
    ['0.0.4000', usdc('60.000000')],
  ])
  const result = concentration(revenue, 4000)
  assert.equal(result.entries.find((e) => e.counterparty === HONEST)?.shareBp, 4000)
  assert.equal(result.entries.find((e) => e.counterparty === HONEST)?.over, false)
  assert.deepEqual(result.overCap.map((e) => e.counterparty), ['0.0.4000'])
})

test('no revenue is not concentrated revenue', () => {
  // A brand-new agent must not look maximally risky for the one reason that
  // says nothing about it — and must not divide by zero.
  const result = concentration(new Map(), 4000)
  assert.equal(result.topShareBp, 0)
  assert.deepEqual(result.overCap, [])
})

test('negative revenue is rejected rather than silently skewing a share', () => {
  const bad = new Map<AccountId, MicroUsdc>([[HONEST, -1n as MicroUsdc]])
  assert.throws(() => concentration(bad, 4000), /cannot be negative/)
})

test('shares are ordered deterministically, ties broken by account id', () => {
  const revenue = new Map<AccountId, MicroUsdc>([
    ['0.0.5000', usdc('1.000000')],
    ['0.0.4000', usdc('1.000000')],
  ])
  const order = concentration(revenue, 4000).entries.map((e) => e.counterparty)
  assert.deepEqual(order, ['0.0.4000', '0.0.5000'], 'same inputs must give the same ceiling')
})

/* ── weights compose ─────────────────────────────────────────────────────── */

test('discounts MULTIPLY, so stacked weaknesses cost more than the worst one', () => {
  // Taking the minimum would let an attacker accumulate flaws that each stay
  // under the largest, and pay for none of them.
  const edges = [edge(AGENT, HONEST, '1.000000'), edge('0.0.4000', HONEST, '1.000000')]
  const weight = weightOf({
    agent: AGENT, counterparty: HONEST, edges, facts: new Map(), maxHops: 3,
    policy: POLICY, young: true, concentrated: true,
  })
  // 10000 × 0.6 × 0.8
  assert.equal(weight.bp, 4800)
  assert.deepEqual(weight.reasons, ['YOUNG_ACCOUNT', 'CONCENTRATED'])
  assert.ok(weight.bp < POLICY.youngBp, 'stacking must be worse than the single worst discount')
})

test('a blocked counterparty reports only the blocking reason', () => {
  const graph = facts({ [SELLER]: [AGENT] })
  const weight = weightOf({
    agent: AGENT, counterparty: SELLER, edges: [edge(AGENT, SELLER, '1.000000')],
    facts: graph, maxHops: 3, policy: POLICY, young: true, concentrated: true, unattested: true,
  })
  assert.equal(weight.bp, 0)
  // The BLOCKING reasons only — both genuinely fire here, since the agent both
  // funded this seller and is its only counterparty. What must not appear are
  // the three discount reasons (young, concentrated, unattested): they are true
  // but irrelevant once the weight is zero, and the dashboard should show the
  // lines that explain the refusal rather than a wall of noise around them.
  assert.deepEqual(weight.reasons, ['FUNDED_BY_AGENT', 'SOLE_COUNTERPARTY'])
  assert.ok(!weight.reasons.includes('YOUNG_ACCOUNT'))
})

test('applying a weight rounds DOWN, never in the agent’s favour', () => {
  const weight = { counterparty: HONEST, bp: 3333, reasons: ['YOUNG_ACCOUNT' as const], blocking: false }
  // 1000001 × 3333 / 10000 = 333300.3333 → 333300, truncated toward zero.
  assert.equal(applyWeight(usdc('1.000001'), weight), 333_300n)
})

test('weighting is deterministic under reordering of the same discounts', () => {
  const edges = [edge(AGENT, HONEST, '1.000000'), edge('0.0.4000', HONEST, '1.000000')]
  const base = { agent: AGENT, counterparty: HONEST, edges, facts: new Map(), maxHops: 3, policy: POLICY }
  const a = weightOf({ ...base, young: true, unattested: true, concentrated: true })
  const b = weightOf({ ...base, concentrated: true, unattested: true, young: true })
  assert.equal(a.bp, b.bp, 'same inputs, same ceiling, byte for byte')
  assert.deepEqual(a.reasons, b.reasons)
})

/* ── the control shape that is actually reachable ────────────────────────── */

test('COMMON_FUNDER: one operator funded both the tab and the "customer"', () => {
  // This is the realistic loop, and the reason it needed its own rule:
  // FUNDED_BY_AGENT cannot fire in Tab's model, because an agent's tab holds no
  // key and therefore cannot fund anything. The operator funds both sides.
  const OPERATOR = '0.0.8000'
  const graph = facts({ [AGENT]: [OPERATOR], [SELLER]: [OPERATOR] })
  const finding = detectCluster({
    agent: AGENT, counterparty: SELLER, edges: [], facts: graph, maxHops: 3,
  })
  assert.equal(finding.clustered, true)
  assert.ok(finding.reasons.includes('COMMON_FUNDER'))
  assert.match(finding.detail, /both the tab and/)
})

test('a tab that cannot sign can never be a funder — FUNDED_BY_AGENT stays silent', () => {
  // Locks in WHY COMMON_FUNDER exists. The tab has no outgoing funding edge
  // because it holds no key; only the operator does.
  const OPERATOR = '0.0.8000'
  const graph = facts({ [AGENT]: [OPERATOR], [SELLER]: [OPERATOR] })
  assert.equal(fundedWithin(AGENT, SELLER, graph, 3).funded, false)
})

test('different funders are not a common funder', () => {
  const graph = facts({ [AGENT]: ['0.0.8000'], [SELLER]: ['0.0.9001'] })
  const finding = detectCluster({
    agent: AGENT, counterparty: SELLER, edges: [], facts: graph, maxHops: 3,
  })
  assert.equal(finding.clustered, false)
})

test('an unknown funder on either side cannot trigger the block', () => {
  // The rule must not fire on two `undefined`s comparing equal. An account whose
  // ancestry we could not fetch is unknown, not "funded by nobody" — and
  // blocking on missing data would refuse revenue for a Mirror Node outage.
  const graph = facts({ [AGENT]: [], [SELLER]: [] })
  assert.equal(
    detectCluster({ agent: AGENT, counterparty: SELLER, edges: [], facts: graph, maxHops: 3 })
      .clustered,
    false,
  )
})
