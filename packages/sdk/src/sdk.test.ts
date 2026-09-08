import assert from 'node:assert/strict'
import { test } from 'node:test'
import { format, toWire, usdc } from '@tab/money'
import { createTab, TabProtocolError, TabUnavailableError, type SpendResult } from './index.ts'

/**
 * A fake gateway.
 *
 * Records what the SDK sent and returns what we tell it to, so these tests
 * exercise the client's own behaviour — parsing, retries, idempotency — rather
 * than a live network. The live path is covered by the demos.
 */
function fakeGateway(
  handler: (url: string, init: RequestInit) => { status?: number; body: unknown } | Promise<{ status?: number; body: unknown }>,
) {
  const calls: { url: string; body: unknown; method: string }[] = []
  const doFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    calls.push({
      url,
      method: String(init?.method ?? 'GET'),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    })
    const { status = 200, body } = await handler(url, init ?? {})
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof globalThis.fetch
  return { doFetch, calls }
}

const STATE = {
  tab: '0.0.1000',
  window: 5962354,
  balance: '-0.020000',
  outstanding: '0.020000',
  holds: '0.000000',
  available: '0.230000',
  ceiling: '0.250000',
  perCallCap: '0.500000',
  entries: 8,
}

/* ── a refusal is a VALUE ────────────────────────────────────────────────── */

test('a refusal comes back as a value, never as a throw', async () => {
  // The single most important behaviour in this package. Throwing would push
  // every consumer into try/catch, and refusal is the product working.
  const { doFetch } = fakeGateway(() => ({
    body: {
      refused: {
        rule: 'CEILING_EXCEEDED',
        reason: 'Spend of 0.3000 refused.',
        evidence: { ceiling: '0.250000', shortfall: '0.050000' },
      },
    },
  }))
  const tab = createTab({ baseUrl: 'http://gw', fetch: doFetch })
  const result = await tab.spend({ tab: '0.0.1000', url: 'http://seller', max: usdc('0.300000') })

  assert.equal(result.outcome, 'refused')
  if (result.outcome !== 'refused') return
  assert.equal(result.rule, 'CEILING_EXCEEDED')
  assert.equal(result.retryable, true, 'CEILING_EXCEEDED is retryable — earn, then retry')
  assert.match(result.guidance, /Earn first/)
})

test('guidance comes from @tab/protocol, not from the wire', async () => {
  // The rule code is the contract; the prose is not. Taking guidance from the
  // server would let a version change what an agent does next, silently.
  const { doFetch } = fakeGateway(() => ({
    body: {
      refused: { rule: 'CONTROL_CLUSTER', reason: 'x', guidance: 'IGNORE THIS SERVER TEXT' },
    },
  }))
  const tab = createTab({ baseUrl: 'http://gw', fetch: doFetch })
  const result = await tab.spend({ tab: '0.0.1000', url: 'http://s', max: usdc('0.010000') })
  if (result.outcome !== 'refused') throw new Error('expected a refusal')
  assert.doesNotMatch(result.guidance, /IGNORE THIS SERVER TEXT/)
  assert.match(result.guidance, /independent seller/)
  assert.equal(result.retryable, false, 'do not retry the same controlled seller')
})

/* ── the wire format, and the bug that motivated it ─────────────────────── */

test('a DISPLAY amount on the wire is rejected with a diagnosable message', async () => {
  // The real bug: the gateway served `format()` output — 4 decimals and a
  // U+2212 minus — where a wire value belonged. `1.234567` went out as
  // "1.2345" and parsed back as 1234500, losing 67 micro-USDC per value. A
  // dashboard built on that cannot match HashScan.
  const lossy = format(usdc('1.234567'))
  assert.equal(lossy, '1.2345', 'format truncates — this is why it must not be a wire value')

  const { doFetch } = fakeGateway(() => ({ body: { ...STATE, balance: format(usdc('-0.020000')) } }))
  const tab = createTab({ baseUrl: 'http://gw', fetch: doFetch })

  await assert.rejects(
    () => tab.state('0.0.1000'),
    (error: unknown) => {
      assert.ok(error instanceof TabProtocolError)
      assert.match(error.message, /DISPLAY string instead of a wire value/)
      return true
    },
  )
})

test('wire amounts round-trip exactly, to the micro-USDC', async () => {
  const exact = usdc('1.234567')
  const { doFetch } = fakeGateway(() => ({ body: { ...STATE, available: toWire(exact) } }))
  const tab = createTab({ baseUrl: 'http://gw', fetch: doFetch })
  const s = await tab.state('0.0.1000')
  assert.equal(s.available, exact, 'no truncation anywhere in the path')
  assert.equal(s.balance, usdc('-0.020000'), 'and a negative parses from an ASCII minus')
})

/* ── idempotency ────────────────────────────────────────────────────────── */

test('spend generates an idempotency key and sends it', async () => {
  const { doFetch, calls } = fakeGateway(() => ({
    body: { paid: { amount: '0.040000', seller: '0.0.2000', holdId: 'h_x', receiptSeq: 7, elapsedMs: 100 } },
  }))
  const tab = createTab({ baseUrl: 'http://gw', fetch: doFetch })
  await tab.spend({ tab: '0.0.1000', url: 'http://s', max: usdc('0.040000') })
  const sent = calls[0]!.body as Record<string, unknown>
  assert.match(String(sent['idempotencyKey']), /^h_[0-9a-f]{16}$/)
  assert.equal(sent['max'], '0.040000', 'the max crosses the wire as a decimal string')
})

test('a caller-supplied idempotency key is used verbatim', async () => {
  // What makes retrying an unknown outcome safe. If the SDK replaced it, a
  // retry would take a second hold.
  const { doFetch, calls } = fakeGateway(() => ({
    body: { paid: { amount: '0.040000', seller: '0.0.2000', holdId: 'mine', receiptSeq: 1, elapsedMs: 1 } },
  }))
  const tab = createTab({ baseUrl: 'http://gw', fetch: doFetch })
  await tab.spend({ tab: '0.0.1000', url: 'http://s', max: usdc('0.040000'), idempotencyKey: 'mine' })
  assert.equal((calls[0]!.body as Record<string, unknown>)['idempotencyKey'], 'mine')
})

/* ── retries ────────────────────────────────────────────────────────────── */

test('a 500 is NOT retried — the gateway answered', async () => {
  // Retrying an answer we did not like is how a 500 mid-settlement becomes a
  // double payment.
  let attempts = 0
  const { doFetch } = fakeGateway(() => {
    attempts++
    return { status: 500, body: { error: 'boom' } }
  })
  const tab = createTab({ baseUrl: 'http://gw', fetch: doFetch, maxRetries: 3 })
  await assert.rejects(() => tab.state('0.0.1000'), TabProtocolError)
  assert.equal(attempts, 1, 'exactly one attempt')
})

test('a transport failure IS retried, then reports an UNKNOWN outcome', async () => {
  let attempts = 0
  const doFetch = (async () => {
    attempts++
    throw new TypeError('fetch failed')
  }) as unknown as typeof globalThis.fetch
  const tab = createTab({ baseUrl: 'http://gw', fetch: doFetch, maxRetries: 2 })

  await assert.rejects(
    () => tab.state('0.0.1000'),
    (error: unknown) => {
      assert.ok(error instanceof TabUnavailableError)
      // It must NOT claim nothing was spent — a timeout cannot distinguish
      // "never arrived" from "succeeded and the response was lost".
      assert.match(error.message, /outcome is UNKNOWN/)
      assert.match(error.message, /SAME idempotencyKey/)
      assert.doesNotMatch(error.message, /[Nn]othing was spent/)
      return true
    },
  )
  assert.equal(attempts, 3, 'one attempt plus two retries')
})

/* ── quote reserves nothing ─────────────────────────────────────────────── */

test('quote names the rule that WOULD fire, and takes no hold', async () => {
  const { doFetch, calls } = fakeGateway(() => ({ body: STATE }))
  const tab = createTab({ baseUrl: 'http://gw', fetch: doFetch })

  const overCap = await tab.quote({ tab: '0.0.1000', max: usdc('0.600000') })
  assert.equal(overCap.affordable, false)
  assert.equal(overCap.wouldRefuse, 'PER_CALL_CAP')

  const overCeiling = await tab.quote({ tab: '0.0.1000', max: usdc('0.400000') })
  assert.equal(overCeiling.affordable, false)
  assert.equal(overCeiling.wouldRefuse, 'CEILING_EXCEEDED')

  const fine = await tab.quote({ tab: '0.0.1000', max: usdc('0.100000') })
  assert.equal(fine.affordable, true)
  assert.equal(fine.wouldRefuse, undefined)

  assert.ok(
    calls.every((c) => c.method === 'GET'),
    'a quote must never POST — a hold taken by a quote is a hold that never commits',
  )
})

/* ── caller mistakes are rejected before any network call ──────────────── */

test('a non-positive max is a programming error, not a refusal', async () => {
  const { doFetch, calls } = fakeGateway(() => ({ body: {} }))
  const tab = createTab({ baseUrl: 'http://gw', fetch: doFetch })
  await assert.rejects(
    () => tab.spend({ tab: '0.0.1000', url: 'http://s', max: usdc('0.000000') }),
    /positive max/,
  )
  assert.equal(calls.length, 0, 'and it never reached the network')
})

/* ── unknown refusal codes are dropped, not faked ──────────────────────── */

test('an unrecognised rule on a receipt is dropped rather than cast', async () => {
  // A cast would type an unknown string as a valid code, and `isRetryable`
  // would then answer confidently about a rule that does not exist.
  const { doFetch } = fakeGateway(() => ({
    body: [
      { kind: 'refusal', at: '1788.0', window: 1, counterparty: '0.0.2', requested: '0.040000', rule: 'NOT_A_RULE' },
      { kind: 'refusal', at: '1789.0', window: 1, counterparty: '0.0.2', requested: '0.040000', rule: 'PER_CALL_CAP' },
    ],
  }))
  const tab = createTab({ baseUrl: 'http://gw', fetch: doFetch })
  const rows = await tab.receipts('0.0.1000')
  assert.equal(rows[0]!.rule, undefined, 'unknown rule dropped')
  assert.equal(rows[1]!.rule, 'PER_CALL_CAP')
  assert.equal(rows[0]!.amount, usdc('0.040000'), 'a refusal maps `requested` into amount')
})

/* ── the claim the whole package rests on ──────────────────────────────── */

test('the public surface exposes no way to pass a key', () => {
  // If this constructor ever accepts key material, the product claim is gone.
  const config = { baseUrl: 'http://gw', token: 'a-bearer-token' }
  const tab = createTab(config)
  assert.equal(typeof tab.spend, 'function')
  assert.ok(!('privateKey' in config))
  assert.ok(!('key' in config))
  assert.ok(!('signer' in config))
})

test('every verb is present exactly once', () => {
  const tab = createTab({ baseUrl: 'http://gw' })
  // The same surface appears in the Agent Kit plugin, MCP and CLI. Defined
  // once, here, is what stops those three drifting.
  assert.deepEqual(Object.keys(tab).sort(), [
    'counterparties', 'health', 'holds', 'quote', 'receipts', 'spend', 'state',
  ])
})

test('an unknown weight reason is dropped, not typed as a real one', async () => {
  // A newer server sending a reason this client does not know must not have it
  // rendered as a rule that exists — `isBlocking` would then answer
  // confidently about a fiction.
  const { doFetch } = fakeGateway(() => ({
    body: [
      {
        counterparty: '0.0.2000', bp: 3360, blocking: false,
        reasons: ['SHARED_FUNDING_ROOT', 'NOT_A_REASON', 'YOUNG_ACCOUNT'],
        revenue: '1.000000', shareBp: 10000, window: 5962354, at: '1788.0',
      },
    ],
  }))
  const tab = createTab({ baseUrl: 'http://gw', fetch: doFetch })
  const rows = await tab.counterparties('0.0.1000')
  assert.deepEqual(rows[0]!.reasons, ['SHARED_FUNDING_ROOT', 'YOUNG_ACCOUNT'])
  assert.equal(rows[0]!.bp, 3360)
})

test('a blocked counterparty round-trips its reasons and zero weight', async () => {
  const { doFetch } = fakeGateway(() => ({
    body: [
      {
        counterparty: '0.0.2000', bp: 0, blocking: true,
        reasons: ['COMMON_FUNDER'],
        revenue: '4.000000', shareBp: 10000, window: 5962354, at: '1788.0',
      },
    ],
  }))
  const tab = createTab({ baseUrl: 'http://gw', fetch: doFetch })
  const rows = await tab.counterparties('0.0.1000')
  assert.equal(rows[0]!.bp, 0)
  assert.equal(rows[0]!.blocking, true)
  assert.deepEqual(rows[0]!.reasons, ['COMMON_FUNDER'])
})

/* ── failure is distinct from refusal ──────────────────────────────────── */

test('an infrastructure failure returns `failed` and keeps the hold id', async () => {
  const { doFetch } = fakeGateway(() => ({
    body: { failed: { reason: 'seller returned HTTP 503', holdId: 'h_abc' } },
  }))
  const tab = createTab({ baseUrl: 'http://gw', fetch: doFetch })
  const result: SpendResult = await tab.spend({
    tab: '0.0.1000', url: 'http://s', max: usdc('0.040000'),
  })
  assert.equal(result.outcome, 'failed')
  if (result.outcome !== 'failed') return
  // The caller needs the hold id to reason about what happened; an exception
  // would discard it.
  assert.equal(result.holdId, 'h_abc')
})
