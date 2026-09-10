import assert from 'node:assert/strict'
import { test } from 'node:test'
import { usdc } from '@tab/money'
import type { Tab } from '@tab/sdk'
import { configFromEnv } from './context.ts'
import { tabPlugin, tabPluginToolNames } from './index.ts'
import { TabSpendCapPolicy } from './policy.ts'
import { TabCeilingTool, TabCounterpartiesTool } from './tools/reads.ts'
import { TabSpendTool } from './tools/spend.ts'

/**
 * The Agent Kit surface.
 *
 * These tools run inside SOMEONE ELSE'S agent loop, chosen by an LLM, which
 * makes two properties worth asserting rather than trusting: a refusal must
 * come back as a result the model can act on, and nothing here may be able to
 * produce a transaction to sign.
 */

const CONFIG = { gatewayUrl: 'http://gw', tab: '0.0.1000' }

function fakeTab(over: Partial<Tab>): Tab {
  const notCalled = (name: string) => () => {
    throw new Error(`${name} should not have been called`)
  }
  return {
    spend: notCalled('spend'),
    quote: notCalled('quote'),
    state: notCalled('state'),
    holds: notCalled('holds'),
    receipts: notCalled('receipts'),
    counterparties: notCalled('counterparties'),
    ceiling: notCalled('ceiling'),
    settlements: notCalled('settlements'),
    tabs: notCalled('tabs'),
    health: notCalled('health'),
    ...over,
  } as Tab
}

/* ── the surface ─────────────────────────────────────────────────────────── */

test('the plugin exposes five tools, and exactly one of them spends', () => {
  const plugin = tabPlugin(CONFIG)
  const tools = plugin.tools({} as never)
  assert.equal(tools.length, 5)

  const methods = tools.map((t) => (t as unknown as { method: string }).method).sort()
  assert.deepEqual(methods, [
    'tab_balance_tool',
    'tab_ceiling_tool',
    'tab_counterparties_tool',
    'tab_quote_tool',
    'tab_spend_tool',
  ])
  assert.equal(Object.keys(tabPluginToolNames).length, 5)
})

test('NO tool submits a transaction — the claim, made structural', async () => {
  /*
   * The Agent Kit's mutation shape is coreAction builds a Transaction and
   * secondaryAction signs it. Tab cannot use that shape: the agent holds no key,
   * so the gateway signs on its behalf against an earned ceiling.
   *
   * Every tool therefore stops after coreAction. The consequence is what this
   * asserts — an LLM driving this plugin cannot produce a Hedera transaction to
   * sign, even if it decides to try.
   */
  const tools = tabPlugin(CONFIG).tools({} as never)
  for (const tool of tools) {
    const t = tool as unknown as { method: string; shouldSecondaryAction: () => Promise<boolean> }
    assert.equal(await t.shouldSecondaryAction(), false, `${t.method} must not submit`)
  }
})

/* ── a refusal is a RESULT ───────────────────────────────────────────────── */

test('A REFUSAL IS RETURNED, NOT THROWN — the invariant this package rests on', async () => {
  /*
   * Throwing would surface it to the agent as a tool failure and invite a
   * retry — and a CEILING_EXCEEDED retried immediately is refused again for the
   * same reason. The agent needs to read the rule and choose different work.
   */
  const tool = new TabSpendTool(
    fakeTab({
      spend: async () => ({
        outcome: 'refused',
        rule: 'CEILING_EXCEEDED',
        reason: 'Spend of 0.3000 refused; available 0.2500.',
        guidance: 'Earn more attested revenue, or wait for the window to settle.',
        retryable: false,
        evidence: { ceiling: '0.250000', shortfall: '0.050000' },
      }),
    }),
    CONFIG,
  )

  const out = await tool.coreAction({ url: 'http://seller', max: '0.300000' })
  assert.match(out, /REFUSED — CEILING_EXCEEDED/)
  assert.match(out, /shortfall 0\.050000/)
  assert.match(out, /Earn more attested revenue/)
  // The line that stops a retry loop.
  assert.match(out, /Retrying this exact call will be refused again/)
})

test('a RETRYABLE refusal gives the opposite advice', async () => {
  const tool = new TabSpendTool(
    fakeTab({
      spend: async () => ({
        outcome: 'refused',
        rule: 'WINDOW_CAP',
        reason: 'Window cap reached.',
        guidance: 'Wait for the window to turn over.',
        retryable: true,
      }),
    }),
    CONFIG,
  )
  const out = await tool.coreAction({ url: 'http://seller', max: '0.040000' })
  assert.match(out, /can clear on its own/)
  assert.doesNotMatch(out, /will be refused again/)
})

test('an INFRASTRUCTURE failure DOES throw, and carries the idempotency key', async () => {
  /*
   * The distinction preserved from the SDK: a refusal means the rail said no,
   * `failed` means nobody said anything and it is unknown whether the seller was
   * paid. A retry with a NEW key would be a second payment.
   */
  const tool = new TabSpendTool(
    fakeTab({
      spend: async () => ({
        outcome: 'failed',
        reason: 'gateway unreachable after the hold was published',
        holdId: 'hold-abc123',
      }),
    }),
    CONFIG,
  )
  await assert.rejects(
    () => tool.coreAction({ url: 'http://seller', max: '0.040000' }),
    (e: unknown) => {
      const m = (e as Error).message
      assert.match(m, /NOT a refusal/)
      assert.match(m, /idempotencyKey "hold-abc123"/)
      assert.match(m, /A new key would be a second payment/)
      return true
    },
  )
})

test('a paid spend reports the SETTLED amount, not the cap it was allowed', async () => {
  // The gateway debits what actually settled. Echoing `max` back would tell the
  // model it spent 0.20 when it spent 0.04 — and that is the number it reasons
  // about next.
  const tool = new TabSpendTool(
    fakeTab({
      spend: async () => ({
        outcome: 'paid',
        amount: usdc('0.040000'),
        seller: '0.0.5000',
        holdId: 'h1',
        receiptSeq: 29,
        body: { answer: 42 },
        elapsedMs: 31_000,
      }),
    }),
    CONFIG,
  )
  const out = await tool.coreAction({ url: 'http://seller', max: '0.200000' })
  assert.match(out, /PAID 0\.0400 USDC to 0\.0\.5000/)
  assert.match(out, /receipt seq 29 on HCS/)
  assert.doesNotMatch(out, /0\.2000/)
})

/* ── the policy ──────────────────────────────────────────────────────────── */

const stage3 = (policy: TabSpendCapPolicy, max: unknown, method = 'tab_spend_tool') =>
  (
    policy as unknown as {
      shouldBlockPostParamsNormalization: (p: unknown, m: string) => boolean
    }
  ).shouldBlockPostParamsNormalization({ normalisedParams: { max } } as never, method)

test('the operator cap blocks a spend BEFORE the gateway is called', () => {
  const policy = new TabSpendCapPolicy('0.010000')
  assert.throws(() => stage3(policy, '0.050000'), /exceeds the operator's per-call limit/)
})

test('a spend within the cap passes through', () => {
  const policy = new TabSpendCapPolicy('0.010000')
  assert.equal(stage3(policy, '0.010000'), false)
  assert.equal(stage3(policy, '0.005000'), false)
})

test('the cap ignores tools it does not guard', () => {
  // Filtering by method first is what stops a policy blocking every tool in
  // someone else's agent, since the kit dispatches it for all of them.
  const policy = new TabSpendCapPolicy('0.010000')
  assert.equal(stage3(policy, '9.000000', 'transfer_hbar'), false)
})

test('UNREADABLE input blocks rather than passing — a cap that waves through is not a cap', () => {
  const policy = new TabSpendCapPolicy('0.010000')
  assert.throws(() => stage3(policy, undefined), /could not read a spend cap/)
  assert.throws(() => stage3(policy, 42), /could not read a spend cap/)
  assert.throws(() => stage3(policy, 'not-an-amount'), /is not a valid amount/)
})

test('a malformed LIMIT fails when the agent is wired, not on the first spend', () => {
  // Parsed in the constructor on purpose: an operator finds out at startup
  // rather than the first time the policy tries to block something.
  assert.throws(() => new TabSpendCapPolicy('not-an-amount'))
})

test('the LIMIT accepts human precision where the TOOL demands six decimals', () => {
  /*
   * A deliberate asymmetry, and worth pinning so nobody "fixes" it.
   *
   * The tool's `max` comes from an LLM, where `"0.04"` could plausibly be a
   * model dropping digits, so the schema demands exactly six and removes the
   * guess. The limit is written by a human in agent wiring, where `'0.01'` is
   * unambiguous — and being strict there would reject correct config for no
   * safety gain.
   */
  const lenient = new TabSpendCapPolicy('0.01')
  assert.equal(stage3(lenient, '0.010000'), false)
  assert.throws(() => stage3(lenient, '0.010001'), /exceeds the operator/)
})

test('read tools are never blocked, so a refused agent can find out WHY', () => {
  /*
   * An agent refused a spend needs tab_ceiling and tab_counterparties to
   * understand the refusal and choose different work. Blocking reads alongside
   * writes would leave it able to do nothing but retry.
   */
  const policy = new TabSpendCapPolicy('0.010000')
  const stage1 = (
    policy as unknown as {
      shouldBlockPreToolExecution: (p: unknown, m: string) => boolean
    }
  ).shouldBlockPreToolExecution
  for (const m of ['tab_ceiling_tool', 'tab_counterparties_tool', 'tab_balance_tool']) {
    assert.equal(stage1.call(policy, { rawParams: {} } as never, m), false)
  }
})

/* ── read tools say what is NOT published ────────────────────────────────── */

test('an unpublished ceiling explains itself instead of showing a bare zero', async () => {
  const tool = new TabCeilingTool(
    fakeTab({
      ceiling: async () => ({
        tab: '0.0.1000',
        published: false,
        enforced: usdc('0.250000'),
        history: [],
      }),
    }),
    CONFIG,
  )
  const out = await tool.coreAction()
  assert.match(out, /No ceiling published yet/)
  // Something is ALWAYS enforced, and the agent needs that number to plan.
  assert.match(out, /enforcing 0\.2500/)
})

test('the counterparties tool shows the two values COMMON_FUNDER compares', async () => {
  const tool = new TabCounterpartiesTool(
    fakeTab({
      counterparties: async () => [
        {
          counterparty: '0.0.10385196',
          bp: 0,
          reasons: ['COMMON_FUNDER'],
          blocking: true,
          revenue: usdc('0.500000'),
          shareBp: 884,
          window: 5963116,
          at: '1.0',
          funder: '0.0.8812188',
          tabFunder: '0.0.8812188',
        },
      ],
    }),
    CONFIG,
  )
  const out = await tool.coreAction()
  assert.match(out, /BLOCKED/)
  assert.match(out, /one operator on both sides/)
  assert.match(out, /SAME, which is what COMMON_FUNDER tests/)
})

/* ── config ──────────────────────────────────────────────────────────────── */

test('a missing TAB_ACCOUNT_ID fails when the toolkit is BUILT', () => {
  // Not on the first tool call: an agent that starts happily and then fails
  // every spend looks like a broken rail rather than a missing variable.
  assert.throws(() => configFromEnv({ TAB_GATEWAY_URL: 'http://gw' }), /TAB_ACCOUNT_ID is not set/)
})

test('nothing in the config can carry key material', () => {
  const config = configFromEnv({ TAB_ACCOUNT_ID: '0.0.7' })
  assert.deepEqual(Object.keys(config).sort(), ['gatewayUrl', 'tab'])
})
