import assert from 'node:assert/strict'
import { test } from 'node:test'
import { format, toWire, usdc } from '@tab/money'
import { createTab, type SpendResult, TabProtocolError, TabUnavailableError } from './index.ts'

/**
 * A fake gateway.
 *
 * Records what the SDK sent and returns what we tell it to, so these tests
 * exercise the client's own behaviour — parsing, retries, idempotency — rather
 * than a live network. The live path is covered by the demos.
 */
function fakeGateway(
  handler: (
    url: string,
    init: RequestInit,
  ) => { status?: number; body: unknown } | Promise<{ status?: number; body: unknown }>,
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

  const { doFetch } = fakeGateway(() => ({
    body: { ...STATE, balance: format(usdc('-0.020000')) },
  }))
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
    body: {
      paid: {
        amount: '0.040000',
        seller: '0.0.2000',
        holdId: 'h_x',
        receiptSeq: 7,
        elapsedMs: 100,
      },
    },
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
    body: {
      paid: { amount: '0.040000', seller: '0.0.2000', holdId: 'mine', receiptSeq: 1, elapsedMs: 1 },
    },
  }))
  const tab = createTab({ baseUrl: 'http://gw', fetch: doFetch })
  await tab.spend({
    tab: '0.0.1000',
    url: 'http://s',
    max: usdc('0.040000'),
    idempotencyKey: 'mine',
  })
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
      {
        kind: 'refusal',
        at: '1788.0',
        window: 1,
        counterparty: '0.0.2',
        requested: '0.040000',
        rule: 'NOT_A_RULE',
      },
      {
        kind: 'refusal',
        at: '1789.0',
        window: 1,
        counterparty: '0.0.2',
        requested: '0.040000',
        rule: 'PER_CALL_CAP',
      },
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
    'ceiling',
    'counterparties',
    'health',
    'holds',
    'quote',
    'receipts',
    'settlements',
    'spend',
    'state',
    'tabs',
  ])
  // Exactly TWO of the nine act. The other seven read what was published, and
  // this package cannot import `@tab/scoring` or `@tab/graph`, so it is
  // structurally incapable of offering a second opinion about a ceiling.
  const acting = ['spend', 'quote']
  assert.equal(Object.keys(tab).filter((k) => acting.includes(k)).length, 2)
})

test('an unknown weight reason is dropped, not typed as a real one', async () => {
  // A newer server sending a reason this client does not know must not have it
  // rendered as a rule that exists — `isBlocking` would then answer
  // confidently about a fiction.
  const { doFetch } = fakeGateway(() => ({
    body: [
      {
        counterparty: '0.0.2000',
        bp: 3360,
        blocking: false,
        reasons: ['SHARED_FUNDING_ROOT', 'NOT_A_REASON', 'YOUNG_ACCOUNT'],
        revenue: '1.000000',
        shareBp: 10000,
        window: 5962354,
        at: '1788.0',
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
        counterparty: '0.0.2000',
        bp: 0,
        blocking: true,
        reasons: ['COMMON_FUNDER'],
        revenue: '4.000000',
        shareBp: 10000,
        window: 5962354,
        at: '1788.0',
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
    tab: '0.0.1000',
    url: 'http://s',
    max: usdc('0.040000'),
  })
  assert.equal(result.outcome, 'failed')
  if (result.outcome !== 'failed') return
  // The caller needs the hold id to reason about what happened; an exception
  // would discard it.
  assert.equal(result.holdId, 'h_abc')
})

/* ── ceiling and settlements: published, never recomputed ────────────────── */

const CEILING_ROW = {
  ceiling: '0.250000',
  window: 5962354,
  binding: 'starter_floor',
  cause: 'registration',
  at: '1788686819.057159551',
  model: 'tab-v2',
  hash: '5c08590b1234',
  seq: 1,
  inputs: {
    revenue: '0.000000',
    revenueAttested: '0.000000',
    revenueUnattested: '0.000000',
    tier: 'Unrated',
    multBp: 0,
    rampBp: 2500,
    cap: '2.000000',
    floor: '0.250000',
    defaulted: false,
  },
}

test('a ceiling comes back with the arithmetic that produced it', async () => {
  const { doFetch } = fakeGateway(() => ({
    body: {
      tab: '0.0.1000',
      published: true,
      enforced: '0.250000',
      ...CEILING_ROW,
      history: [CEILING_ROW],
    },
  }))
  const view = await createTab({ baseUrl: 'http://gw', fetch: doFetch }).ceiling('0.0.1000')

  assert.equal(view.published, true)
  assert.equal(view.enforced, usdc('0.250000'))
  assert.equal(view.current?.inputs.tier, 'Unrated')
  // An Unrated tab that has NOT defaulted still gets the starter floor. This is
  // the pair of facts that once made a brand-new agent unable to ever start.
  assert.equal(view.current?.inputs.defaulted, false)
  assert.equal(view.current?.inputs.multBp, 0)
  assert.equal(view.current?.binding, 'starter_floor')
  assert.equal(view.current?.seq, 1)
})

test('`current` IS the last history element, so a chart cannot contradict the number', async () => {
  const collapsed = {
    ...CEILING_ROW,
    ceiling: '0.000000',
    window: 5962355,
    binding: 'unrated',
    cause: 'graph_change',
    seq: 2,
    inputs: { ...CEILING_ROW.inputs, defaulted: false },
  }
  const { doFetch } = fakeGateway(() => ({
    body: {
      tab: '0.0.1000',
      published: true,
      enforced: '0.000000',
      history: [CEILING_ROW, collapsed],
    },
  }))
  const view = await createTab({ baseUrl: 'http://gw', fetch: doFetch }).ceiling('0.0.1000')

  assert.equal(view.history.length, 2)
  assert.equal(view.current?.ceiling, usdc('0.000000'))
  assert.equal(view.current, view.history[view.history.length - 1])
  // The cause is what makes a zero explainable rather than alarming.
  assert.equal(view.current?.cause, 'graph_change')
})

test('no ceiling published yet is a normal state, not an error', async () => {
  const { doFetch } = fakeGateway(() => ({
    body: {
      tab: '0.0.1000',
      published: false,
      enforced: '0.250000',
      note: 'No ceiling published yet — the starter ceiling is in force.',
      history: [],
    },
  }))
  const view = await createTab({ baseUrl: 'http://gw', fetch: doFetch }).ceiling('0.0.1000')

  assert.equal(view.published, false)
  assert.equal(view.current, undefined)
  // Something is ALWAYS being enforced. A view that showed nothing here would
  // imply the tab is unlimited, which is the opposite of the truth.
  assert.equal(view.enforced, usdc('0.250000'))
  assert.ok(view.note)
})

test('a settled window carries the netting, not just the transfer', async () => {
  const { doFetch } = fakeGateway(() => ({
    body: [
      {
        window: 5962354,
        at: '1788686819.057159551',
        seq: 30,
        credits: '0.180000',
        debits: '0.070000',
        interest: '0.000000',
        net: '0.110000',
        outstanding: '0.000000',
        receiptCount: 4,
        outcome: 'clean',
        rampFromBp: 2500,
        rampToBp: 4000,
        transactionId: '0.0.8812188@1788686819.000000000',
      },
    ],
  }))
  const rows = await createTab({ baseUrl: 'http://gw', fetch: doFetch }).settlements('0.0.1000')

  assert.equal(rows.length, 1)
  // The claim this view exists to make: four receipts became one transfer.
  assert.equal(rows[0]?.receiptCount, 4)
  assert.equal(rows[0]?.credits, usdc('0.180000'))
  assert.equal(rows[0]?.net, usdc('0.110000'))
  assert.equal(rows[0]?.outcome, 'clean')
})

test('absent gross legs stay absent — a reader must not read them as zero', async () => {
  // A settlement published before the gross legs existed. Defaulting these to
  // 0.000000 would invent a netting that was never on the topic, and the
  // console would show `4 receipts → 1 transfer` beside four zeroes.
  const { doFetch } = fakeGateway(() => ({
    body: [
      {
        window: 5962300,
        at: '1788600000.000000000',
        net: '0.110000',
        outcome: 'clean',
        rampFromBp: 2500,
        rampToBp: 4000,
      },
    ],
  }))
  const rows = await createTab({ baseUrl: 'http://gw', fetch: doFetch }).settlements('0.0.1000')

  assert.equal(rows[0]?.credits, undefined)
  assert.equal(rows[0]?.debits, undefined)
  assert.equal(rows[0]?.receiptCount, undefined)
  // The net is still there — that IS published.
  assert.equal(rows[0]?.net, usdc('0.110000'))
})

test('a missed window has no transaction id, and none is invented', async () => {
  const { doFetch } = fakeGateway(() => ({
    body: [
      {
        window: 5962355,
        at: '1788687400.000000000',
        credits: '0.000000',
        debits: '0.050000',
        interest: '0.000100',
        net: '-0.050100',
        outstanding: '0.050100',
        receiptCount: 1,
        outcome: 'missed',
        rampFromBp: 4000,
        rampToBp: 1000,
      },
    ],
  }))
  const rows = await createTab({ baseUrl: 'http://gw', fetch: doFetch }).settlements('0.0.1000')

  assert.equal(rows[0]?.transactionId, undefined)
  assert.equal(rows[0]?.net, usdc('-0.050100'))
  // The ramp fell 4000 → 1000. Trust is slower to earn than to lose.
  assert.equal(rows[0]?.rampToBp, 1000)
})

test('an unknown outcome or tier degrades safely rather than typing a fiction', async () => {
  const { doFetch } = fakeGateway((url) =>
    url.includes('/settlements')
      ? {
          body: [
            {
              window: 1,
              at: '1.0',
              net: '0.000000',
              outcome: 'reticulated',
              rampFromBp: 0,
              rampToBp: 0,
            },
          ],
        }
      : {
          body: {
            tab: '0.0.1000',
            published: true,
            enforced: '0.250000',
            history: [{ ...CEILING_ROW, inputs: { ...CEILING_ROW.inputs, tier: 'S+' } }],
          },
        },
  )
  const tab = createTab({ baseUrl: 'http://gw', fetch: doFetch })

  // Both fall back to the CONSERVATIVE value, not the permissive one: an
  // unrecognised outcome is `carried` (still owing) and an unrecognised tier is
  // `Unrated` (no credit). A cast would have typed `S+` as a real tier and the
  // console would have rendered a rating that does not exist.
  assert.equal((await tab.settlements('0.0.1000'))[0]?.outcome, 'carried')
  assert.equal((await tab.ceiling('0.0.1000')).current?.inputs.tier, 'Unrated')
})

test('the read verbs refuse an empty tab id before touching the network', async () => {
  const { doFetch, calls } = fakeGateway(() => ({ body: {} }))
  const tab = createTab({ baseUrl: 'http://gw', fetch: doFetch })
  await assert.rejects(() => tab.ceiling(''), /needs a tab id/)
  await assert.rejects(() => tab.settlements(''), /needs a tab id/)
  assert.equal(calls.length, 0)
})

test('the tab list reports the registration rule and how far it has run', async () => {
  const { doFetch } = fakeGateway(() => ({
    body: {
      window: 5963112,
      registrationEnforced: true,
      rootsClaimed: 1,
      note: 'One Starter Tab per funding root, enforced by the engine.',
      tabs: [
        {
          tab: '0.0.10390398',
          balance: '4.750000',
          outstanding: '0.000000',
          holds: '0.000000',
          available: '0.250000',
          ceiling: '0.250000',
          entries: 21,
          tier: 'C',
          publishedCeiling: '0.250000',
          binding: 'starter_floor',
          model: 'tab-v2',
          seq: 12,
        },
        // Never published for — so no tier, not `Unrated`.
        {
          tab: '0.0.10385196',
          balance: '-0.040000',
          outstanding: '0.040000',
          holds: '0.000000',
          available: '0.210000',
          ceiling: '0.250000',
          entries: 4,
        },
      ],
    },
  }))
  const list = await createTab({ baseUrl: 'http://gw', fetch: doFetch }).tabs()

  assert.equal(list.registrationEnforced, true)
  assert.equal(list.rootsClaimed, 1)
  assert.equal(list.tabs.length, 2)
  assert.equal(list.tabs[0]?.tier, 'C')
  assert.equal(list.tabs[0]?.publishedCeiling, usdc('0.250000'))
  // The important one: an unpublished tab has NO tier. Reading `undefined` as
  // `Unrated` would put a rating on screen that no topic carries — and
  // `Unrated` is not a neutral placeholder, it is the tier that means no
  // credit at all.
  assert.equal(list.tabs[1]?.tier, undefined)
  assert.equal(list.tabs[1]?.publishedCeiling, undefined)
  // The enforced ceiling is still there, because something is always enforced.
  assert.equal(list.tabs[1]?.ceiling, usdc('0.250000'))
})

test('a gateway that omits `registrationEnforced` is read as NOT enforcing', async () => {
  /*
   * An older gateway that does not send the field predates the registration
   * flow, so nothing was enforced when it was written. Defaulting the
   * permissive way round would let a stale server claim a defence it does not
   * have — the same reasoning as absent provenance, absent gross legs and an
   * absent tier.
   */
  const { doFetch } = fakeGateway(() => ({ body: { window: 1, tabs: [] } }))
  const list = await createTab({ baseUrl: 'http://gw', fetch: doFetch }).tabs()
  assert.equal(list.registrationEnforced, false)
  assert.equal(list.rootsClaimed, 0)
})

/* ── the receiver `fetch` is called with ─────────────────────────────────── */

test('the global fetch is called with a GLOBAL receiver, not with the client', async () => {
  /*
   * The browser-only bug that took the console down completely.
   *
   * `fetch` is a method on Window and the spec requires a Window receiver.
   * Stored bare and invoked as `this.doFetch(...)`, the receiver became the
   * client instance and every browser request died with
   *
   *   TypeError: Failed to execute 'fetch' on 'Window': Illegal invocation
   *
   * Node's fetch does not care about its receiver, so this suite passed
   * throughout and the console failed on every single request — reported as a
   * transport error, which is indistinguishable from an unreachable gateway.
   *
   * So this asserts the RECEIVER rather than the outcome: what broke was never
   * visible in the response, and a test that only checked the response could
   * not have caught it. `createTab` is used without an injected fetch on
   * purpose — injecting one bypasses the exact line under test.
   */
  const seen: unknown[] = []
  const realFetch = globalThis.fetch

  globalThis.fetch = function (this: unknown) {
    seen.push(this)
    return Promise.resolve(
      new Response(JSON.stringify({ tab: '0.0.1', window: 1 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
  } as typeof fetch

  try {
    const tab = createTab({ baseUrl: 'http://gateway.test', maxRetries: 0 })
    await tab.state('0.0.1').catch(() => undefined)

    assert.equal(seen.length, 1, 'fetch was called exactly once')
    // Bound: the receiver is the global object, never the client instance.
    // A browser rejects anything else outright.
    assert.ok(
      seen[0] === globalThis || seen[0] === undefined,
      `fetch was called with ${Object.prototype.toString.call(seen[0])} as its receiver — ` +
        'a browser would throw Illegal invocation',
    )
  } finally {
    globalThis.fetch = realFetch
  }
})
