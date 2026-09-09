import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { usdc } from '@tab/money'
import type { Tab } from '@tab/sdk'
import { configFromEnv } from './config.ts'
import { buildServer } from './server.ts'

/**
 * The MCP surface, driven through a real MCP client.
 *
 * An in-memory transport pair rather than a hand-rolled JSON-RPC harness: the
 * point of these tests is that a CLIENT sees what we intend, and asserting
 * against our own idea of the protocol would prove only that we are
 * self-consistent.
 *
 * The property that matters most is the refusal one. `isError: true` makes a
 * client surface a failure and invites a model to retry — and a
 * `CEILING_EXCEEDED` retried immediately is refused again for the same reason.
 */

const CONFIG = { gatewayUrl: 'http://gw', tab: '0.0.1000' }

/** A Tab whose verbs return whatever the test needs. */
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

async function connect(tab: Tab) {
  const server = buildServer(tab, CONFIG)
  const client = new Client({ name: 'test', version: '0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  return client
}

function textOf(result: unknown): string {
  const content = (result as { content: { type: string; text?: string }[] }).content
  return content.map((c) => c.text ?? '').join('\n')
}

/* ── the surface ─────────────────────────────────────────────────────────── */

test('exactly one tool moves money, and it is annotated as such', async () => {
  const client = await connect(fakeTab({}))
  const { tools } = await client.listTools()

  assert.deepEqual(tools.map((t) => t.name).sort(), [
    'tab_balance',
    'tab_ceiling',
    'tab_counterparties',
    'tab_health',
    'tab_quote',
    'tab_receipts',
    'tab_spend',
  ])

  /*
   * An MCP client uses these hints to decide what to confirm with a human.
   * Marking a money-moving tool read-only would let a model spend without ever
   * surfacing the decision, which is the worst failure available here.
   */
  const spend = tools.find((t) => t.name === 'tab_spend')!
  assert.equal(spend.annotations?.readOnlyHint, false)
  assert.equal(spend.annotations?.destructiveHint, true)
  assert.equal(spend.annotations?.idempotentHint, false)

  for (const t of tools.filter((t) => t.name !== 'tab_spend')) {
    assert.equal(t.annotations?.readOnlyHint, true, `${t.name} must be read-only`)
    assert.equal(t.annotations?.destructiveHint, false, `${t.name} must not be destructive`)
  }
})

test('the server tells a model that refusal is normal before it calls anything', async () => {
  // The instructions are the only chance to set expectations BEFORE the first
  // refusal. A model that reads a refusal as a fault retries it.
  const client = await connect(fakeTab({}))
  const instructions = client.getInstructions()
  assert.match(instructions!, /holds no key/)
  assert.match(instructions!, /refused spend is a normal, expected answer/)
  assert.match(instructions!, /choose different work rather than retrying/)
})

/* ── the refusal invariant ───────────────────────────────────────────────── */

test('A REFUSAL IS NOT AN ERROR — the invariant this package rests on', async () => {
  const client = await connect(
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
  )

  const result = await client.callTool({
    name: 'tab_spend',
    arguments: { url: 'http://seller', max: '0.300000' },
  })

  // The whole point. `isError` would make the client surface a failure and
  // invite a retry of a call that will be refused again for the same reason.
  assert.notEqual(result.isError, true)

  const body = textOf(result)
  assert.match(body, /REFUSED — CEILING_EXCEEDED/)
  // The evidence, so a model can explain the number rather than just the verdict.
  assert.match(body, /shortfall 0\.050000/)
  assert.match(body, /Earn more attested revenue/)
  // And the one instruction that stops a retry loop.
  assert.match(body, /Retrying this exact call will be refused again/)
})

test('a RETRYABLE refusal says so, because the advice is the opposite', async () => {
  const client = await connect(
    fakeTab({
      spend: async () => ({
        outcome: 'refused',
        rule: 'WINDOW_CAP',
        reason: 'Window cap reached.',
        guidance: 'Wait for the window to turn over.',
        retryable: true,
      }),
    }),
  )
  const body = textOf(
    await client.callTool({
      name: 'tab_spend',
      arguments: { url: 'http://seller', max: '0.040000' },
    }),
  )
  assert.match(body, /can clear on its own/)
  assert.doesNotMatch(body, /will be refused again/)
})

test('INFRASTRUCTURE failure IS an error, and hands back the idempotency key', async () => {
  /*
   * The distinction preserved from the SDK: a refusal means the rail said no,
   * `failed` means nobody said anything and the caller does not know whether
   * the seller was paid. Retrying with a NEW key would be a second payment, so
   * the hold id has to come back in the message a model will read.
   */
  const client = await connect(
    fakeTab({
      spend: async () => ({
        outcome: 'failed',
        reason: 'gateway unreachable after the hold was published',
        holdId: 'hold-abc123',
      }),
    }),
  )
  const result = await client.callTool({
    name: 'tab_spend',
    arguments: { url: 'http://seller', max: '0.040000' },
  })

  assert.equal(result.isError, true)
  const body = textOf(result)
  assert.match(body, /This is NOT a refusal/)
  assert.match(body, /idempotencyKey "hold-abc123"/)
  assert.match(body, /A new key would be a second payment/)
})

test('a paid spend reports the SETTLED amount, not the cap it was allowed', async () => {
  // The gateway debits what actually settled. A tool that echoed `max` back
  // would tell a model it spent 0.20 when it spent 0.04 — and that number is
  // what the model reasons about next.
  const client = await connect(
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
  )
  const body = textOf(
    await client.callTool({
      name: 'tab_spend',
      arguments: { url: 'http://seller', max: '0.200000' },
    }),
  )
  assert.match(body, /PAID 0\.0400 USDC to 0\.0\.5000/)
  assert.match(body, /receipt seq 29 on HCS/)
  assert.doesNotMatch(body, /0\.2000/)
})

/* ── input validation happens before the network ─────────────────────────── */

test('a malformed amount is rejected by the schema, never sent', async () => {
  // `0.04` is not six decimal places. Passing it through would let the SDK's
  // stricter parser reject it after a round trip, or worse, coerce it.
  const client = await connect(fakeTab({}))
  const result = await client.callTool({
    name: 'tab_spend',
    arguments: { url: 'http://seller', max: '0.04' },
  })
  assert.equal(result.isError, true)
  assert.match(textOf(result), /six decimal places/)
})

/* ── the read tools say what is NOT published ────────────────────────────── */

test('an unpublished ceiling explains itself instead of showing a bare zero', async () => {
  const client = await connect(
    fakeTab({
      ceiling: async () => ({
        tab: '0.0.1000',
        published: false,
        enforced: usdc('0.250000'),
        history: [],
        note: 'No ceiling published yet — the starter ceiling is in force.',
      }),
    }),
  )
  const body = textOf(await client.callTool({ name: 'tab_ceiling', arguments: {} }))
  assert.match(body, /No ceiling published yet/)
  // Something is ALWAYS enforced, and a model needs that number to plan.
  assert.match(body, /enforcing 0\.2500/)
})

test('the counterparties tool shows the two values COMMON_FUNDER compares', async () => {
  const client = await connect(
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
  )
  const body = textOf(await client.callTool({ name: 'tab_counterparties', arguments: {} }))
  assert.match(body, /BLOCKED/)
  assert.match(body, /one operator on both sides/)
  // The evidence, not just the verdict — the same claim the console makes.
  assert.match(body, /SAME, which is what COMMON_FUNDER tests/)
})

/* ── config refuses to start half-configured ─────────────────────────────── */

test('a missing TAB_ACCOUNT_ID fails at STARTUP, not on the first call', () => {
  /*
   * An MCP client shows a server as connected the moment the process is alive,
   * so a server that starts happily and then refuses every call looks like a
   * broken rail rather than a missing variable.
   */
  assert.throws(() => configFromEnv({ TAB_GATEWAY_URL: 'http://gw' }), /TAB_ACCOUNT_ID is not set/)
})

test('the gateway URL has a working default, because the tab id cannot', () => {
  // A localhost default is a correct guess for a dev machine. A default tab id
  // would be someone else's tab, so there is deliberately none.
  const config = configFromEnv({ TAB_ACCOUNT_ID: '0.0.7' })
  assert.equal(config.gatewayUrl, 'http://localhost:8080')
  assert.equal(config.tab, '0.0.7')
})

test('nothing in the config can carry key material', () => {
  // Same claim as the SDK, at the surface most likely to be handed a
  // credential: an MCP server runs on a user's machine inside a client they
  // did not write.
  const config = configFromEnv({ TAB_ACCOUNT_ID: '0.0.7' })
  assert.deepEqual(Object.keys(config).sort(), ['gatewayUrl', 'tab'])
})
