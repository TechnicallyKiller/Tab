import assert from 'node:assert/strict'
import { test } from 'node:test'
import { type MicroUsdc, usdc } from '@tab/money'
import {
  fundedWithin,
  fundingAncestry,
  fundingRoot,
  isSystemAccount,
  sharedFundingRoot,
} from './ancestry.ts'
import { detectCluster, reciprocity } from './clusters.ts'
import { concentration } from './concentration.ts'
import type { AccountFacts, AccountId, TransferEdge } from './types.ts'
import { applyWeight, type WeightPolicy, weightOf } from './weights.ts'

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
  unverifiedBp: 5000,
}

/** A pre-v3 policy: no `unverifiedBp`, because v1 and v2 had none. */
const POLICY_PRE_V3: WeightPolicy = { ...POLICY }
delete POLICY_PRE_V3.unverifiedBp

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
    [AGENT]: ['0.0.10'],
    '0.0.10': ['0.0.11'],
    '0.0.11': ['0.0.12'],
    '0.0.12': ['0.0.13'],
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

  const finding = detectCluster({
    agent: AGENT,
    counterparty: SELLER,
    edges,
    facts: graph,
    maxHops: 3,
  })
  assert.equal(finding.clustered, true)
  assert.ok(finding.reasons.includes('FUNDED_BY_AGENT'))

  const weight = weightOf({
    agent: AGENT,
    counterparty: SELLER,
    edges,
    facts: graph,
    maxHops: 3,
    policy: POLICY,
  })
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
  const finding = detectCluster({
    agent: AGENT,
    counterparty: SELLER,
    edges,
    facts: new Map(),
    maxHops: 3,
  })
  assert.equal(finding.clustered, true)
  assert.ok(finding.reasons.includes('SOLE_COUNTERPARTY'))
})

test('an independent seller with other customers is counted in full', () => {
  const edges = [
    edge(AGENT, HONEST, '0.040000'),
    edge('0.0.4000', HONEST, '1.000000'),
    edge('0.0.5000', HONEST, '2.000000'),
  ]
  const weight = weightOf({
    agent: AGENT,
    counterparty: HONEST,
    edges,
    facts: new Map(),
    maxHops: 3,
    policy: POLICY,
  })
  assert.equal(weight.bp, 10_000)
  assert.equal(weight.blocking, false)
  assert.deepEqual(
    weight.reasons,
    ['INDEPENDENT'],
    'counting in full is a decision with a reason too',
  )
})

test('the agent is never its own independent counterparty', () => {
  const finding = detectCluster({
    agent: AGENT,
    counterparty: AGENT,
    edges: [],
    facts: new Map(),
    maxHops: 3,
  })
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
  assert.deepEqual(
    result.overCap.map((e) => e.counterparty),
    ['0.0.4000'],
  )
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
    agent: AGENT,
    counterparty: HONEST,
    edges,
    facts: new Map(),
    maxHops: 3,
    policy: POLICY,
    young: true,
    concentrated: true,
  })
  // 10000 × 0.6 × 0.8
  assert.equal(weight.bp, 4800)
  assert.deepEqual(weight.reasons, ['YOUNG_ACCOUNT', 'CONCENTRATED'])
  assert.ok(weight.bp < POLICY.youngBp, 'stacking must be worse than the single worst discount')
})

test('a blocked counterparty reports only the blocking reason', () => {
  const graph = facts({ [SELLER]: [AGENT] })
  const weight = weightOf({
    agent: AGENT,
    counterparty: SELLER,
    edges: [edge(AGENT, SELLER, '1.000000')],
    facts: graph,
    maxHops: 3,
    policy: POLICY,
    young: true,
    concentrated: true,
    unattested: true,
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
  const weight = {
    counterparty: HONEST,
    bp: 3333,
    reasons: ['YOUNG_ACCOUNT' as const],
    blocking: false,
  }
  // 1000001 × 3333 / 10000 = 333300.3333 → 333300, truncated toward zero.
  assert.equal(applyWeight(usdc('1.000001'), weight), 333_300n)
})

test('weighting is deterministic under reordering of the same discounts', () => {
  const edges = [edge(AGENT, HONEST, '1.000000'), edge('0.0.4000', HONEST, '1.000000')]
  const base = {
    agent: AGENT,
    counterparty: HONEST,
    edges,
    facts: new Map(),
    maxHops: 3,
    policy: POLICY,
  }
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
    agent: AGENT,
    counterparty: SELLER,
    edges: [],
    facts: graph,
    maxHops: 3,
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
    agent: AGENT,
    counterparty: SELLER,
    edges: [],
    facts: graph,
    maxHops: 3,
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

/* ── UNVERIFIED_FUNDING: the residual fail-open, closed ──────────────────── */

test('a counterparty with no established provenance is DISCOUNTED, not trusted', () => {
  /*
   * The residual the published-facts work could not close: an account never
   * successfully observed has nothing to remember, so before v3 it was weighted
   * INDEPENDENT — full credit — because absent ancestry read as absent
   * relationship. That is the unsafe direction, and it is how the loop attacker
   * went uncaught on its first full run.
   */
  const weight = weightOf({
    agent: AGENT,
    counterparty: HONEST,
    edges: [],
    facts: new Map(),
    maxHops: 3,
    policy: POLICY,
    unverified: true,
  })
  assert.equal(weight.bp, 5000)
  assert.deepEqual(weight.reasons, ['UNVERIFIED_FUNDING'])
  // A DISCOUNT, not a block. Mirror Node lag is routine, and blocking on it
  // would turn an indexer hiccup into a refusal for every counterparty at once.
  assert.equal(weight.blocking, false)
})

test('a PRE-V3 policy applies no unverified discount at all', () => {
  /*
   * v1 and v2 carry no `unverifiedBp`, and inventing one would impose a policy
   * retroactively on versions that never had it — the same mistake as
   * back-filling the weight block into `v1.ts`. Absent step, no discount, which
   * is exactly the pre-v3 behaviour.
   */
  const weight = weightOf({
    agent: AGENT,
    counterparty: HONEST,
    edges: [],
    facts: new Map(),
    maxHops: 3,
    policy: POLICY_PRE_V3,
    unverified: true,
  })
  assert.equal(weight.bp, 10_000)
  assert.deepEqual(weight.reasons, ['INDEPENDENT'])
})

test('UNVERIFIED_FUNDING is applied FIRST, and the order is part of the model', () => {
  /*
   * Multiplication commutes; integer truncation does not. Applying 5000 then
   * 6000 can differ by a micro-unit from 6000 then 5000, so the sequence is
   * frozen alongside the numbers. This pins it: unverified (0.5) then young
   * (0.6) then concentrated (0.8).
   */
  const weight = weightOf({
    agent: AGENT,
    counterparty: HONEST,
    edges: [],
    facts: new Map(),
    maxHops: 3,
    policy: POLICY,
    unverified: true,
    young: true,
    concentrated: true,
  })
  assert.deepEqual(weight.reasons, ['UNVERIFIED_FUNDING', 'YOUNG_ACCOUNT', 'CONCENTRATED'])
  // 10000 → 5000 → 3000 → 2400
  assert.equal(weight.bp, 2400)
})

test('a BLOCKING reason still short-circuits past the unverified discount', () => {
  // A known common funder is a hard block. Stacking an "unverified" discount on
  // top of zero would put a second reason next to the one that decided it, and
  // the console would show noise around the line that explains the refusal.
  const graph = new Map([
    [AGENT, { id: AGENT, fundedBy: [EXCHANGE] }],
    [SELLER, { id: SELLER, fundedBy: [EXCHANGE] }],
  ])
  const weight = weightOf({
    agent: AGENT,
    counterparty: SELLER,
    edges: [],
    facts: graph,
    maxHops: 3,
    policy: POLICY,
    unverified: true,
  })
  assert.equal(weight.bp, 0)
  assert.deepEqual(weight.reasons, ['COMMON_FUNDER'])
})

test('the published bp reproduces from the reasons and the frozen steps', () => {
  /*
   * The point of moving the steps into `@tab/params`. A weight message says
   * `bp 3360 · why [SHARED_FUNDING_ROOT, YOUNG_ACCOUNT, CONCENTRATED]`, and a
   * stranger can now check it: 0.7 × 0.6 × 0.8 = 0.336. Before v3 the steps
   * were in an app file and that arithmetic was unavailable to anyone outside.
   */
  const weight = weightOf({
    agent: AGENT,
    counterparty: HONEST,
    edges: [],
    facts: new Map(),
    maxHops: 3,
    policy: POLICY,
    sharedRoot: true,
    young: true,
    concentrated: true,
  })
  assert.deepEqual(weight.reasons, ['SHARED_FUNDING_ROOT', 'YOUNG_ACCOUNT', 'CONCENTRATED'])
  assert.equal(weight.bp, 3360)

  const steps: Record<string, number> = {
    SHARED_FUNDING_ROOT: POLICY.sharedRootBp,
    YOUNG_ACCOUNT: POLICY.youngBp,
    CONCENTRATED: POLICY.concentratedBp,
  }
  let replayed = 10_000
  for (const reason of weight.reasons) replayed = Math.floor((replayed * steps[reason]!) / 10_000)
  assert.equal(replayed, weight.bp)
})

/* ── fundingRoot: the key the registration rule turns on ─────────────────── */

test('the funding root is the FURTHEST ancestor, not the nearest', () => {
  /*
   * The nearest funder of a minted agent is whatever throwaway account minted
   * it, and an attacker can make a fresh one per agent for free — so keying the
   * registration rule on the nearest funder would defend against nothing. The
   * furthest reachable ancestor is the account an attacker has to spend real
   * value to replace.
   */
  // Ids above the reserved range: `0.0.1`–`0.0.3` are network system accounts
  // and are excluded from root resolution. See `isSystemAccount`.
  const facts = new Map([
    ['0.0.3000', { id: '0.0.3000', fundedBy: ['0.0.2000'] }],
    ['0.0.2000', { id: '0.0.2000', fundedBy: ['0.0.1000'] }],
  ])
  assert.deepEqual(fundingRoot('0.0.3000', facts, 3), { root: '0.0.1000', hops: 2 })
})

test('the root is bounded by maxHops, so a long chain does not change the answer', () => {
  const facts = new Map([
    ['a', { id: 'a', fundedBy: ['b'] }],
    ['b', { id: 'b', fundedBy: ['c'] }],
    ['c', { id: 'c', fundedBy: ['d'] }],
  ])
  assert.equal(fundingRoot('a', facts, 2)?.root, 'c')
  assert.equal(fundingRoot('a', facts, 3)?.root, 'd')
})

test('a TIE is broken lexicographically, because this decides credit', () => {
  /*
   * Two ancestors at the same distance must give the same root on every run and
   * for every reader. Without a tie-break, `Map` iteration order could let the
   * same tab claim a root in one pass and be denied in the next — and a
   * published ceiling would stop being reproducible.
   */
  // Both above the reserved range, or `isSystemAccount` would exclude them —
  // which is how this fixture first failed after the treasury fix landed.
  const facts = new Map([['x', { id: 'x', fundedBy: ['0.0.9000', '0.0.1100'] }]])
  assert.equal(fundingRoot('x', facts, 1)?.root, '0.0.1100')
  // Reversed input, same answer.
  const reversed = new Map([['x', { id: 'x', fundedBy: ['0.0.1100', '0.0.9000'] }]])
  assert.equal(fundingRoot('x', reversed, 1)?.root, '0.0.1100')
})

test('NO known ancestry is undefined, not "its own root"', () => {
  /*
   * A caller must distinguish these. An account with no observed ancestry has
   * not been shown to be independent — it has simply not been seen — and
   * treating it as its own root would hand every unobserved account a fresh
   * starter grant, which is the bulk-minting hole reopened.
   */
  assert.equal(fundingRoot('lonely', new Map(), 3), undefined)
  assert.equal(fundingRoot('lonely', new Map([['lonely', { id: 'lonely' }]]), 3), undefined)
})

test('a funding CYCLE still yields a root rather than hanging', () => {
  const facts = new Map([
    ['p', { id: 'p', fundedBy: ['q'] }],
    ['q', { id: 'q', fundedBy: ['p'] }],
  ])
  assert.equal(fundingRoot('p', facts, 10)?.root, 'q')
})

test('THE TREASURY IS NEVER A FUNDING ROOT — caught on the first live run', () => {
  /*
   * `0.0.2` is the Hedera treasury and every account on the network is
   * ultimately funded by it. Without excluding system accounts, the funding
   * root of every tab on Hedera resolves to `0.0.2` — and the registration
   * rule, which grants one Starter Tab per root, would have let the FIRST tab
   * ever registered deny the starter grant to every other agent on the network,
   * forever.
   *
   * The live shape, exactly as the engine resolved it before the fix:
   * `0.0.10390398 → 0.0.8812188 → 0.0.2`. It claimed `0.0.2`.
   *
   * No hand-built fixture has a genesis account, which is why only a live run
   * could find this.
   */
  const facts = new Map([
    ['0.0.10390398', { id: '0.0.10390398', fundedBy: ['0.0.8812188'] }],
    ['0.0.8812188', { id: '0.0.8812188', fundedBy: ['0.0.2'] }],
  ])
  const root = fundingRoot('0.0.10390398', facts, 3)
  // The OPERATOR — the account someone would have to fund a hundred times over
  // to farm a hundred starter grants, which is what the rule defends.
  assert.equal(root?.root, '0.0.8812188')
  assert.equal(root?.hops, 1)
})

test('two accounts minted by one operator share a root, and the treasury does not decide it', () => {
  // The case the rule exists for, and the reason the exclusion cannot break it.
  const facts = new Map([
    ['0.0.1001', { id: '0.0.1001', fundedBy: ['0.0.5000'] }],
    ['0.0.1002', { id: '0.0.1002', fundedBy: ['0.0.5000'] }],
    ['0.0.5000', { id: '0.0.5000', fundedBy: ['0.0.2'] }],
  ])
  assert.equal(fundingRoot('0.0.1001', facts, 3)?.root, '0.0.5000')
  assert.equal(fundingRoot('0.0.1002', facts, 3)?.root, '0.0.5000')
})

test('an account funded ONLY by the network has no root, and keeps its grant', () => {
  // Nothing above it but the treasury. Returning `0.0.2` would deny every other
  // agent; returning undefined grants the floor, which is the safe direction.
  const facts = new Map([['0.0.1001', { id: '0.0.1001', fundedBy: ['0.0.2'] }]])
  assert.equal(fundingRoot('0.0.1001', facts, 3), undefined)
})

test('isSystemAccount covers the reserved range and nothing above it', () => {
  for (const id of ['0.0.0', '0.0.2', '0.0.3', '0.0.98', '0.0.800', '0.0.999']) {
    assert.equal(isSystemAccount(id), true, id)
  }
  for (const id of ['0.0.1000', '0.0.8812188', '0.0.10390398']) {
    assert.equal(isSystemAccount(id), false, id)
  }
})
