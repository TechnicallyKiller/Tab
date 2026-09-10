import assert from 'node:assert/strict'
import { test } from 'node:test'
import { registrationsFromMessages, type TopicMessage } from '@tab/ledger'
import { format, type MicroUsdc, micro, toWire, usdc } from '@tab/money'
import { encode, SCHEMA_VERSION, type TabMessage } from '@tab/protocol'
import { describeCeiling } from './ceilings.ts'
import { type GatewayEnv, loadEnv } from './env.ts'
import { nowConsensus } from './receipts.ts'
import { buildServer } from './server.ts'
import { type SpendDeps, spend } from './spend.ts'
import { LedgerState } from './state.ts'

/**
 * `apps/gateway` — the component that actually moves money.
 *
 * 1,646 lines with no tests, and the largest untested surface in the repo after
 * `mirror` was covered. Every rule asserted here exists because of a specific
 * failure, and the tests say which: the cap-not-the-charge debit, the display
 * string served as an API value, holds lost on restart, a refusal returned as
 * an error status. A comment records a lesson; a test enforces it.
 *
 * Nothing here touches Hedera or the network. `SpendDeps` takes the client and
 * the receipt writer as dependencies, which is what makes the money path
 * testable at all.
 */

/* ── fakes ───────────────────────────────────────────────────────────────── */

const ENV: GatewayEnv = {
  network: 'testnet',
  operatorId: '0.0.8812188',
  operatorKey: 'not-a-key',
  tokenId: '0.0.429274',
  tabAccountId: '0.0.1000',
  receiptTopic: '0.0.5001',
  ceilingTopic: '0.0.5002',
  settlementTopic: '0.0.5003',
  feePayerId: '0.0.9',
  feePayerKey: 'not-a-key',
  port: 8080,
  windowSeconds: 600,
  demoMode: true,
  starterCeiling: usdc('0.250000'),
  perCallCap: usdc('0.050000'),
  holdTtlSeconds: 60,
}

const TAB = '0.0.1000'
const SELLER = '0.0.5000'
const URL_FOR = (payTo = SELLER) => `http://seller.test/serve?payTo=${payTo}`

/** Records every receipt written, so ordering and content can be asserted. */
function fakeReceipts(opts: { failOn?: TabMessage['t'] } = {}) {
  const written: TabMessage[] = []
  let seq = 100
  return {
    written,
    writer: {
      write: async (message: TabMessage) => {
        if (opts.failOn === message.t) throw new Error(`HCS write failed for ${message.t}`)
        written.push(message)
        return { sequenceNumber: ++seq, transactionId: `tx-${seq}`, bytes: 200 }
      },
    },
  }
}

/** An x402 client whose settlement result the test controls. */
function fakeClient(result: {
  status?: number
  amountPaid?: bigint
  settlementTransaction?: string
  body?: unknown
  throws?: string
}) {
  const calls: string[] = []
  return {
    calls,
    client: {
      fetch: globalThis.fetch,
      http: {} as never,
      describe: () => 'fake',
      call: async (url: string) => {
        calls.push(url)
        if (result.throws) throw new Error(result.throws)
        return {
          status: result.status ?? 200,
          body: result.body ?? { ok: true },
          ...(result.amountPaid !== undefined ? { amountPaid: result.amountPaid } : {}),
          ...(result.settlementTransaction
            ? { settlementTransaction: result.settlementTransaction }
            : {}),
        }
      },
    },
  }
}

function depsFor(
  over: {
    client?: ReturnType<typeof fakeClient>['client']
    receipts?: ReturnType<typeof fakeReceipts>['writer']
    ceiling?: MicroUsdc
    env?: Partial<GatewayEnv>
  } = {},
) {
  const state = new LedgerState(over.ceiling ?? usdc('0.250000'))
  const receipts = over.receipts ?? fakeReceipts().writer
  const client = over.client ?? fakeClient({ amountPaid: 40_000n }).client
  return {
    deps: {
      env: { ...ENV, ...over.env },
      state,
      client,
      receipts,
      window: () => 5_963_000,
    } as unknown as SpendDeps,
    state,
  }
}

/* ── the debit must be the CHARGE, not the cap ───────────────────────────── */

test('the tab is debited what the seller CHARGED, never the cap it was allowed', async () => {
  /*
   * The bug: this recorded `request.max`, so a spend capped at 0.200000 against
   * a seller charging 0.040000 debited the agent 0.200000 — overstating what it
   * owed by 0.160000 while the float kept the difference. Invisible while every
   * demo set `max` equal to the price, and wrong the moment they differed.
   *
   * Worse, the first FIX read `maxAmountRequired` — the x402 V1 field name. v2
   * uses `amount`, so the wrong field silently fell back to the cap and
   * reproduced the bug behind a patch that looked like it worked.
   */
  const receipts = fakeReceipts()
  const { deps, state } = depsFor({
    client: fakeClient({ amountPaid: 40_000n, settlementTransaction: 'tx-abc' }).client,
    receipts: receipts.writer,
  })

  const result = await spend(deps, { tab: TAB, url: URL_FOR(), max: usdc('0.050000') })

  assert.equal(result.outcome, 'paid')
  assert.ok(result.outcome === 'paid')
  assert.equal(result.amount, usdc('0.040000'))

  const debit = receipts.written.find((m) => m.t === 'debit')
  assert.ok(debit && debit.t === 'debit')
  // Signed negative on the ledger, and the SETTLED figure.
  assert.equal(debit.amt, '-0.040000')

  // And the projection agrees, so `available` is not overstated.
  const position = state.position(TAB, nowConsensus())
  assert.equal(position.balance, usdc('-0.040000'))
})

test('an UNREPORTED price falls back to the cap, and says it is an upper bound', async () => {
  // The honest fallback. x402 not reporting a price means the debit is an upper
  // bound rather than a fact, and the reconciler flags it against the transfer.
  const receipts = fakeReceipts()
  const { deps } = depsFor({
    client: fakeClient({ settlementTransaction: 'tx-abc' }).client, // no amountPaid
    receipts: receipts.writer,
  })
  const result = await spend(deps, { tab: TAB, url: URL_FOR(), max: usdc('0.050000') })
  assert.ok(result.outcome === 'paid')
  assert.equal(result.amount, usdc('0.050000'))
})

/* ── write-ahead ordering: reserve → pay → commit ────────────────────────── */

test('the HOLD is published BEFORE the seller is called, in that order', async () => {
  /*
   * The safety property the whole rail rests on, and the one thing a stranger
   * had to take on trust until holds were published: an HCS replay showed
   * debits appearing from nowhere, so `verify-tab` could not assert
   * `debit_has_hold`.
   */
  const receipts = fakeReceipts()
  const client = fakeClient({ amountPaid: 40_000n, settlementTransaction: 'tx-abc' })
  const { deps } = depsFor({ client: client.client, receipts: receipts.writer })

  await spend(deps, { tab: TAB, url: URL_FOR(), max: usdc('0.040000') })

  assert.deepEqual(
    receipts.written.map((m) => m.t),
    ['hold', 'debit'],
  )
  const hold = receipts.written[0]!
  const debit = receipts.written[1]!
  assert.ok(hold.t === 'hold' && debit.t === 'debit')
  // Same hold id on both, which is what makes the pairing checkable.
  assert.equal(hold.hold, debit.hold)
})

test('a failed HOLD write FAILS CLOSED — the seller is never called', async () => {
  /*
   * Proceeding would pay a seller with no published authorisation, producing
   * exactly the debit-from-nowhere that publishing holds exists to eliminate —
   * and indistinguishable, to a stranger, from a gateway inventing debits.
   * Refusing costs the agent one job.
   */
  const client = fakeClient({ amountPaid: 40_000n })
  const { deps } = depsFor({
    client: client.client,
    receipts: fakeReceipts({ failOn: 'hold' }).writer,
  })

  const result = await spend(deps, { tab: TAB, url: URL_FOR(), max: usdc('0.040000') })

  assert.equal(result.outcome, 'failed')
  assert.ok(result.outcome === 'failed')
  assert.match(result.reason, /could not publish the hold, so the spend was not attempted/)
  // The decisive assertion: no payment was attempted.
  assert.equal(client.calls.length, 0)
})

test('an idempotency key becomes the hold id, so a retry cannot double-spend', async () => {
  const receipts = fakeReceipts()
  const { deps } = depsFor({
    client: fakeClient({ amountPaid: 40_000n }).client,
    receipts: receipts.writer,
  })
  await spend(deps, {
    tab: TAB,
    url: URL_FOR(),
    max: usdc('0.040000'),
    idempotencyKey: 'caller-key-123',
  })
  const hold = receipts.written[0]!
  assert.ok(hold.t === 'hold')
  assert.equal(hold.hold, 'caller-key-123')
})

test('a seller that throws leaves the hold STANDING, and returns the id', async () => {
  /*
   * Never release the hold here: we cannot know whether the seller was paid,
   * and releasing would let the agent spend the same headroom twice. It expires
   * on its own, so the headroom is not lost permanently.
   */
  const receipts = fakeReceipts()
  const { deps, state } = depsFor({
    client: fakeClient({ throws: 'connection reset' }).client,
    receipts: receipts.writer,
  })

  const result = await spend(deps, { tab: TAB, url: URL_FOR(), max: usdc('0.040000') })

  assert.ok(result.outcome === 'failed')
  assert.equal(result.reason, 'connection reset')
  assert.ok(result.holdId)
  // The hold is still reserving headroom in the projection.
  assert.equal(state.position(TAB, nowConsensus()).holds, usdc('0.040000'))
  // No debit was written — the money may or may not have moved, and the ledger
  // must not claim it did.
  assert.equal(receipts.written.filter((m) => m.t === 'debit').length, 0)
})

test('a non-200 from the seller is a failure, not a paid spend', async () => {
  const { deps } = depsFor({ client: fakeClient({ status: 503 }).client })
  const result = await spend(deps, { tab: TAB, url: URL_FOR(), max: usdc('0.040000') })
  assert.ok(result.outcome === 'failed')
  assert.match(result.reason, /seller returned HTTP 503/)
})

test('a missing settlement transaction is marked `unsettled:`, not left blank', async () => {
  // The reconciler needs to be able to find these. A blank transaction id would
  // read as a transfer that simply has not been matched yet.
  const receipts = fakeReceipts()
  const { deps } = depsFor({
    client: fakeClient({ amountPaid: 40_000n }).client, // no settlementTransaction
    receipts: receipts.writer,
  })
  await spend(deps, { tab: TAB, url: URL_FOR(), max: usdc('0.040000') })
  const debit = receipts.written.find((m) => m.t === 'debit')!
  assert.ok(debit.t === 'debit')
  assert.match(debit.tx, /^unsettled:/)
})

/* ── refusals are PUBLISHED, and are not errors ──────────────────────────── */

test('a spend over the per-call cap is refused and the refusal is PUBLISHED', async () => {
  const receipts = fakeReceipts()
  const client = fakeClient({ amountPaid: 40_000n })
  const { deps } = depsFor({ client: client.client, receipts: receipts.writer })

  const result = await spend(deps, { tab: TAB, url: URL_FOR(), max: usdc('0.500000') })

  assert.ok(result.outcome === 'refused')
  assert.equal(result.rule, 'PER_CALL_CAP')
  // Published, not logged — the Refusals view IS the product demonstrating that
  // underwriting works.
  const refusal = receipts.written.find((m) => m.t === 'refused')
  assert.ok(refusal && refusal.t === 'refused')
  assert.equal(refusal.rule, 'PER_CALL_CAP')
  // Nothing was paid.
  assert.equal(client.calls.length, 0)
})

test('the CHECKS run before the hold — a refusal reserves nothing', async () => {
  const receipts = fakeReceipts()
  const { deps, state } = depsFor({ receipts: receipts.writer })
  await spend(deps, { tab: TAB, url: URL_FOR(), max: usdc('0.500000') })
  assert.equal(receipts.written.filter((m) => m.t === 'hold').length, 0)
  assert.equal(state.position(TAB, nowConsensus()).holds, 0n)
})

test('a refusal survives a failed receipt write — it must not become a 500', async () => {
  // A refusal is the product working. Turning it into an infrastructure error
  // because HCS was briefly unavailable would hide the rule that fired.
  const { deps } = depsFor({ receipts: fakeReceipts({ failOn: 'refused' }).writer })
  const result = await spend(deps, { tab: TAB, url: URL_FOR(), max: usdc('0.500000') })
  assert.ok(result.outcome === 'refused')
  assert.equal(result.rule, 'PER_CALL_CAP')
})

test('spending past the ceiling is refused, with the shortfall as evidence', async () => {
  const { deps, state } = depsFor({ ceiling: usdc('0.100000') })
  // Two spends of 0.05 fit; a third does not.
  state.push(TAB, {
    kind: 'debit',
    at: nowConsensus(),
    window: 5_963_000,
    holdId: 'h1',
    counterparty: SELLER,
    amount: micro(-100_000n),
    transactionId: 'tx1',
  })

  const result = await spend(deps, { tab: TAB, url: URL_FOR(), max: usdc('0.050000') })

  assert.ok(result.outcome === 'refused')
  assert.equal(result.rule, 'CEILING_EXCEEDED')
  // The numbers behind the decision, so an operator can see WHY.
  assert.ok(result.evidence)
  assert.equal(result.evidence['ceiling'], format(usdc('0.100000')))
  assert.equal(result.evidence['shortfall'], format(usdc('0.050000')))
})

test('a HOLD counts against the ceiling, so two racing spends cannot both pass', async () => {
  /*
   * The entire defence against racing a spend past the ceiling. Without holds
   * counting, two concurrent requests each see the same headroom.
   */
  const { deps, state } = depsFor({ ceiling: usdc('0.050000') })
  state.push(TAB, {
    kind: 'hold',
    at: nowConsensus(),
    window: 5_963_000,
    holdId: 'h1',
    counterparty: SELLER,
    amount: usdc('0.050000'),
    expiresAt: `${Math.floor(Date.now() / 1000) + 60}.000000000`,
  })
  const result = await spend(deps, { tab: TAB, url: URL_FOR(), max: usdc('0.050000') })
  assert.ok(result.outcome === 'refused')
  assert.equal(result.rule, 'CEILING_EXCEEDED')
})

/* ── amounts on the wire ─────────────────────────────────────────────────── */

test('receipt amounts use toWire — six decimals, never a display string', async () => {
  /*
   * `format` is a DISPLAY function: 4 decimals and a U+2212 minus. Serving it
   * as an API value was lossy and did happen — `1.234567` went out as
   * `"1.2345"` and parsed back as `1234500`, silently dropping 67 micro-USDC.
   */
  const receipts = fakeReceipts()
  const { deps } = depsFor({
    client: fakeClient({ amountPaid: 1_234_567n }).client,
    receipts: receipts.writer,
    env: { perCallCap: usdc('2.000000') },
    ceiling: usdc('2.000000'),
  })
  await spend(deps, { tab: TAB, url: URL_FOR(), max: usdc('2.000000') })

  const debit = receipts.written.find((m) => m.t === 'debit')!
  assert.ok(debit.t === 'debit')
  // Every micro-unit survives, and the minus is ASCII so `usdc()` round-trips.
  assert.equal(debit.amt, '-1.234567')
  assert.equal(usdc(debit.amt.replace('-', '')), 1_234_567n)
})

test('the request is HASHED, never stored', async () => {
  // A receipt carries a hash so a topic never becomes a log of what an agent
  // bought. The URL contains the seller and could contain a query payload.
  const receipts = fakeReceipts()
  const { deps } = depsFor({
    client: fakeClient({ amountPaid: 40_000n }).client,
    receipts: receipts.writer,
  })
  await spend(deps, { tab: TAB, url: `${URL_FOR()}&secret=hunter2`, max: usdc('0.040000') })

  const serialised = JSON.stringify(receipts.written)
  assert.doesNotMatch(serialised, /hunter2/)
  const hold = receipts.written[0]!
  assert.ok(hold.t === 'hold')
  assert.match(hold.req, /^[0-9a-f]{12}$/)
})

test('an UNRESOLVABLE seller writes no receipt at all, rather than one saying "unknown"', async () => {
  /*
   * This test used to assert the opposite — that the hold was published with
   * `cp: 'unknown'`. The reasoning was sound (an unattributed counterparty
   * beats a guessed one, which would corrupt the independence graph) but the
   * behaviour was not: `'unknown'` is not a Hedera id, so the receipt schema
   * rejected it, the hold never reached the topic, and the spend surfaced as a
   * 502 carrying a validation dump about a field the caller never supplied.
   *
   * Refusing to guess is still right. Doing it BEFORE any state changes is the
   * correction.
   */
  const receipts = fakeReceipts()
  const { deps } = depsFor({
    client: fakeClient({ amountPaid: 40_000n }).client,
    receipts: receipts.writer,
  })
  const result = await spend(deps, {
    tab: TAB,
    url: 'http://seller.test/serve',
    max: usdc('0.040000'),
  })

  assert.equal(result.outcome, 'failed')
  assert.match(result.reason, /could not work out who to pay/)
  // Nothing on the topic: no hold, no refusal, no debit.
  assert.equal(receipts.written.length, 0)
})

/* ── the hold TTL ────────────────────────────────────────────────────────── */

test('a hold expires at now + holdTtlSeconds, keeping the nanos', async () => {
  const receipts = fakeReceipts()
  const { deps } = depsFor({
    client: fakeClient({ amountPaid: 40_000n }).client,
    receipts: receipts.writer,
    env: { holdTtlSeconds: 60 },
  })
  await spend(deps, { tab: TAB, url: URL_FOR(), max: usdc('0.040000') })
  const hold = receipts.written[0]!
  assert.ok(hold.t === 'hold')

  const [heldSeconds] = hold.exp.split('.')
  const now = Math.floor(Date.now() / 1000)
  const expiry = Number(heldSeconds)
  // 60s ahead, allowing a second of slack for a slow test machine.
  assert.ok(expiry >= now + 59 && expiry <= now + 61, `expiry ${expiry} vs now ${now}`)
})

/* ── env ─────────────────────────────────────────────────────────────────── */

const FULL_ENV: NodeJS.ProcessEnv = {
  HEDERA_OPERATOR_ID: '0.0.1',
  HEDERA_OPERATOR_KEY: 'k',
  USDC_TOKEN_ID: '0.0.429274',
  TAB_ACCOUNT_ID: '0.0.1000',
  TOPIC_RECEIPTS: '0.0.2',
  TOPIC_CEILINGS: '0.0.3',
  TOPIC_SETTLEMENTS: '0.0.4',
  FAUCET_ACCOUNT_ID: '0.0.5',
  FAUCET_ACCOUNT_KEY: 'k',
}

test('a PLACEHOLDER value counts as missing, not as configured', () => {
  /*
   * `.env.example` ships ids like `0.0.xxxxx`. Treating one as real is worse
   * than an empty string: the service starts, writes to a topic that does not
   * exist, and fails on the first receipt with an unrelated-looking error.
   */
  assert.throws(() => loadEnv({ ...FULL_ENV, TOPIC_RECEIPTS: '0.0.xxxxx' }), /TOPIC_RECEIPTS/)
})

test('every missing variable is named at ONCE, not one per restart', () => {
  // A service that reports one problem per restart turns a five-minute setup
  // into five restarts.
  try {
    loadEnv({ HEDERA_OPERATOR_ID: '0.0.1' })
    assert.fail('expected a throw')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    for (const name of [
      'USDC_TOKEN_ID',
      'TOPIC_RECEIPTS',
      'TOPIC_CEILINGS',
      'FAUCET_ACCOUNT_KEY',
    ]) {
      assert.match(message, new RegExp(name))
    }
  }
})

test('the starter ceiling defaults to @tab/params, not to a local constant', () => {
  /*
   * This read `STARTER_CEILING_USDC ?? '1.000000'`, a SECOND source of truth for
   * a number `@tab/params` exists to own — and it showed: v2 lowered the floor
   * to 0.250000 and the gateway kept granting 1.0000 to an unknown tab.
   */
  const env = loadEnv(FULL_ENV)
  assert.equal(env.starterCeiling, usdc('0.250000'))
  // The override still works, for a demo.
  assert.equal(
    loadEnv({ ...FULL_ENV, STARTER_CEILING_USDC: '1.000000' }).starterCeiling,
    usdc('1.000000'),
  )
})

test('TAB_ACCOUNT_ID falls back to PAYER_ACCOUNT_ID but is still REQUIRED', () => {
  /*
   * It used to default to the operator id, which made the tab and the hot float
   * one account: settlement scheduled a transfer from `0.0.x` to `0.0.x`,
   * consensus executed it, and the worker reported CLEAN having moved nothing.
   */
  const { TAB_ACCOUNT_ID: _omitted, ...withoutTab } = FULL_ENV
  assert.equal(loadEnv({ ...withoutTab, PAYER_ACCOUNT_ID: '0.0.77' }).tabAccountId, '0.0.77')
  assert.throws(() => loadEnv(withoutTab), /TAB_ACCOUNT_ID/)
})

/* ── nowConsensus ────────────────────────────────────────────────────────── */

test('nowConsensus produces a zero-padded nanosecond field', () => {
  /*
   * Consensus timestamps are compared as STRINGS in several places, and that
   * only works when the nanos are padded to 9 digits: `1788686819.57` would
   * sort before `1788686819.100000000`, silently reversing two entries.
   */
  for (let i = 0; i < 5; i++) {
    const ts = nowConsensus()
    const [seconds, nanos] = ts.split('.')
    assert.match(seconds!, /^\d{10}$/)
    assert.equal(nanos!.length, 9, `nanos "${nanos}" must be 9 digits`)
  }
})

/* ── describeCeiling ─────────────────────────────────────────────────────── */

test('describeCeiling FORMATS the amount rather than interpolating a bigint', () => {
  /*
   * A MicroUsdc is a bigint, so a template string prints raw micro-units. The
   * log read `0.0000 → 1000000`, which looks like a ceiling a million times too
   * large at exactly the moment an operator is trying to understand a refusal.
   */
  const line = describeCeiling({
    tab: TAB,
    ceiling: usdc('1.000000'),
    window: 5_963_000,
    binding: 'starter_floor',
    cause: 'clean_settlement',
    at: '1788686819.057159551',
    model: 'tab-v3',
    hash: 'abcdef012345',
    inputs: {
      rev: usdc('0.000000'),
      revAttested: usdc('0.000000'),
      revUnattested: usdc('0.000000'),
      tier: 'Unrated',
      multBp: 0,
      rampBp: 2500,
      cap: usdc('2.000000'),
      floor: usdc('0.250000'),
      defaulted: false,
    },
  })
  assert.match(line, /1\.0000/)
  /*
   * Derived rather than written as a literal, which is clearer AND keeps
   * `guard:money` quiet — it flags the raw micro-unit string on sight, and it
   * is right to: a bare `1000000` in a money path is almost always a bug.
   */
  const rawMicroUnits = String(usdc('1.000000'))
  assert.ok(!line.includes(rawMicroUnits), `raw micro-units leaked into "${line}"`)
  assert.match(line, /bound by starter_floor/)
  assert.match(line, /cause clean_settlement/)
})

test('a HELD growth is named in the description, not silently equal', () => {
  // `0.0000 bound by unrated` alone invites the guess that something broke.
  const line = describeCeiling({
    tab: TAB,
    ceiling: usdc('0.250000'),
    computed: usdc('0.400000'),
    window: 5_963_000,
    binding: 'computed',
    cause: 'clean_settlement',
    at: '1.0',
    model: 'tab-v3',
    hash: 'abcdef012345',
    inputs: {
      rev: usdc('0.000000'),
      revAttested: usdc('0.000000'),
      revUnattested: usdc('0.000000'),
      tier: 'C',
      multBp: 10_000,
      rampBp: 2500,
      cap: usdc('2.000000'),
      floor: usdc('0.250000'),
      defaulted: false,
    },
  })
  assert.match(line, /computed 0\.4000 HELD by the asymmetry rule/)
})

/* ── toWire is the shared one ────────────────────────────────────────────── */

test('the gateway serialises amounts with @tab/money, not a private copy', () => {
  /*
   * `spend.ts` carried its own byte-equivalent `toWire` while `server.ts`, in
   * the same app, imported the shared one. Two implementations of one function
   * side by side is the setup for drift — the fifth private copy of something
   * shared to appear in this repo.
   */
  assert.equal(toWire(micro(-1_234_567n)), '-1.234567')
  assert.equal(toWire(micro(0n)), '0.000000')
  assert.equal(toWire(micro(1n)), '0.000001')
})

/* ── the HTTP surface, through Fastify's inject ──────────────────────────── */

test('a REFUSAL is a 200 with a discriminated body, not an error status', async () => {
  /*
   * The single most important shape in this API. Forcing every consumer into a
   * try/catch to read the rule would make the Refusals view harder to build and
   * would teach an agent that refusal is a fault — refusal is the product
   * working, and handling it is the agent developer's main job.
   */
  const { deps } = depsFor({})
  const app = buildServer(deps)
  const res = await app.inject({
    method: 'POST',
    url: '/v1/spend',
    payload: { tab: TAB, url: URL_FOR(), max: '0.500000' },
  })

  assert.equal(res.statusCode, 200)
  const body = res.json()
  assert.equal(body.refused.rule, 'PER_CALL_CAP')
  // Guidance and retryability travel with it, so a caller can act.
  assert.ok(body.refused.guidance)
  assert.equal(typeof body.refused.retryable, 'boolean')
  // Six decimals on the wire, so `usdc()` round-trips it.
  assert.match(body.available, /^-?\d+\.\d{6}$/)
  await app.close()
})

test('an INFRASTRUCTURE failure is a 502, so it cannot pollute the Refusals view', async () => {
  const { deps } = depsFor({ receipts: fakeReceipts({ failOn: 'hold' }).writer })
  const app = buildServer(deps)
  const res = await app.inject({
    method: 'POST',
    url: '/v1/spend',
    payload: { tab: TAB, url: URL_FOR(), max: '0.040000' },
  })

  assert.equal(res.statusCode, 502)
  const body = res.json()
  assert.match(body.note, /transport failure, not a refusal/)
  // The hold id, so a retry can be idempotent.
  assert.ok(body.holdId)
  await app.close()
})

test('EVERY amount in a JSON response is six decimals, never a display string', async () => {
  /*
   * `format` gives 4dp and a U+2212 minus. Serving it as an API value was lossy
   * and did happen: `1.234567` went out as `"1.2345"` and parsed back as
   * `1234500`, dropping 67 micro-USDC per value. A dashboard built on that
   * cannot match HashScan, which is the one thing a dashboard must do.
   */
  const { deps, state } = depsFor({})
  state.push(TAB, {
    kind: 'debit',
    at: nowConsensus(),
    window: 5_963_000,
    holdId: 'h1',
    counterparty: SELLER,
    amount: micro(-1_234_567n),
    transactionId: 'tx1',
  })
  const app = buildServer(deps)

  const body = (await app.inject({ method: 'GET', url: `/v1/tabs/${TAB}` })).json()
  for (const key of ['balance', 'outstanding', 'holds', 'available', 'ceiling', 'perCallCap']) {
    assert.match(String(body[key]), /^-?\d+\.\d{6}$/, `${key} was "${body[key]}"`)
  }
  // Every micro-unit survived, and the minus is ASCII.
  assert.equal(body.balance, '-1.234567')
  await app.close()
})

test('entries come back with amounts on the wire, and refusals keep `requested`', async () => {
  // A refusal moved no money, so it carries `requested` rather than `amount`.
  // Conflating them would make the Refusals view show refused intent as spend.
  const { deps, state } = depsFor({})
  state.push(TAB, {
    kind: 'refusal',
    at: nowConsensus(),
    window: 5_963_000,
    counterparty: SELLER,
    requested: usdc('0.500000'),
    rule: 'PER_CALL_CAP',
  })
  const app = buildServer(deps)
  const rows = (await app.inject({ method: 'GET', url: `/v1/tabs/${TAB}/entries` })).json()

  assert.equal(rows.length, 1)
  assert.equal(rows[0].kind, 'refusal')
  assert.equal(rows[0].requested, '0.500000')
  assert.equal(rows[0].amount, undefined)
  await app.close()
})

test('an unpublished ceiling is a 200 with `published: false`, never a 404', async () => {
  /*
   * A tab with no published ceiling is the NORMAL state for its first minutes —
   * the engine has not run — and the gateway is enforcing the starter ceiling
   * meanwhile. A 404 would render an error for a healthy tab AND hide that a
   * real limit is in force.
   */
  const { deps } = depsFor({})
  const app = buildServer(deps)
  const res = await app.inject({ method: 'GET', url: `/v1/tabs/${TAB}/ceiling` })

  assert.equal(res.statusCode, 200)
  const body = res.json()
  assert.equal(body.published, false)
  assert.equal(body.enforced, '0.250000')
  assert.match(body.note, /starter ceiling is in force/)
  assert.deepEqual(body.history, [])
  await app.close()
})

test('a published ceiling carries its arithmetic and what is ENFORCED right now', async () => {
  const published = {
    tab: TAB,
    ceiling: usdc('0.400000'),
    window: 5_963_000,
    binding: 'computed',
    cause: 'clean_settlement',
    at: '1.0',
    model: 'tab-v3',
    hash: 'abcdef012345',
    seq: 12,
    inputs: {
      rev: usdc('1.000000'),
      revAttested: usdc('0.600000'),
      revUnattested: usdc('0.400000'),
      tier: 'C' as const,
      multBp: 10_000,
      rampBp: 7000,
      cap: usdc('2.000000'),
      floor: usdc('0.250000'),
      defaulted: false,
    },
  }
  const { deps } = depsFor({})
  const app = buildServer({
    ...deps,
    ceilings: () => new Map([[TAB, [published]]]),
  } as unknown as SpendDeps)

  const body = (await app.inject({ method: 'GET', url: `/v1/tabs/${TAB}/ceiling` })).json()
  assert.equal(body.published, true)
  assert.equal(body.ceiling, '0.400000')
  // The gap that matters: published vs what the fast path is checking. The
  // poll has not run here, so the state still holds the starter ceiling.
  assert.equal(body.enforced, '0.250000')
  assert.equal(body.inputs.tier, 'C')
  assert.equal(body.inputs.revenueAttested, '0.600000')
  assert.equal(body.seq, 12)
  await app.close()
})

test('/health reports the network, token and window without touching a key', async () => {
  const { deps } = depsFor({})
  const app = buildServer(deps)
  const body = (await app.inject({ method: 'GET', url: '/health' })).json()
  assert.equal(body.ok, true)
  assert.equal(body.network, 'testnet')
  assert.equal(body.token, '0.0.429274')
  assert.equal(typeof body.window, 'number')
  // Nothing resembling key material is ever in a response.
  assert.doesNotMatch(JSON.stringify(body), /operatorKey|feePayerKey|302e|302a/)
  await app.close()
})

test('the counterparties route carries the two values COMMON_FUNDER compares', async () => {
  const { deps } = depsFor({})
  const app = buildServer({
    ...deps,
    weights: () =>
      new Map([
        [
          `${TAB}:${SELLER}`,
          {
            tab: TAB,
            counterparty: SELLER,
            bp: 0,
            reasons: ['COMMON_FUNDER'] as const,
            blocking: true,
            revenue: usdc('0.500000'),
            shareBp: 884,
            window: 5_963_000,
            at: '1.0',
          },
        ],
      ]),
    facts: () =>
      new Map([
        [TAB, { account: TAB, funder: '0.0.8812188' }],
        [SELLER, { account: SELLER, funder: '0.0.8812188', funderSeq: 16 }],
      ]),
  } as unknown as SpendDeps)

  const rows = (await app.inject({ method: 'GET', url: `/v1/tabs/${TAB}/counterparties` })).json()
  assert.equal(rows.length, 1)
  assert.equal(rows[0].funder, '0.0.8812188')
  assert.equal(rows[0].tabFunder, '0.0.8812188')
  assert.equal(rows[0].funderSeq, 16)
  // Amount on the wire, not formatted.
  assert.equal(rows[0].revenue, '0.500000')
  await app.close()
})

test('an unknown provenance stays ABSENT rather than being defaulted', async () => {
  // A counterparty whose provenance has not been observed is a different fact
  // from one funded by nobody, and inventing a funder here would fabricate the
  // exact evidence the panel exists to expose.
  const { deps } = depsFor({})
  const app = buildServer({
    ...deps,
    weights: () =>
      new Map([
        [
          'k',
          {
            tab: TAB,
            counterparty: SELLER,
            bp: 10_000,
            reasons: ['INDEPENDENT'] as const,
            blocking: false,
            revenue: usdc('0.100000'),
            shareBp: 100,
            window: 5_963_000,
            at: '1.0',
          },
        ],
      ]),
    facts: () => new Map(),
  } as unknown as SpendDeps)

  const rows = (await app.inject({ method: 'GET', url: `/v1/tabs/${TAB}/counterparties` })).json()
  assert.equal(rows[0].funder, undefined)
  assert.equal(rows[0].tabFunder, undefined)
  assert.equal(rows[0].firstSeen, undefined)
  await app.close()
})

test('the tab list states the registration RULE, on the response itself', async () => {
  /*
   * This asserted `registrationEnforced: false` and a note saying no
   * registration flow existed — and it failed the moment the flow landed, which
   * is the test doing its job rather than a test to delete.
   *
   * The flag describes the RULE, applied on every engine pass. `rootsClaimed`
   * is the data, and a caller asking "has this actually run" reads that.
   * Keeping both on the response is what stops a consumer rendering this list
   * under a "Registry" heading — which the console did, for a feature that did
   * not then exist.
   */
  const { deps, state } = depsFor({})
  state.push(TAB, {
    kind: 'debit',
    at: nowConsensus(),
    window: 5_963_000,
    holdId: 'h1',
    counterparty: SELLER,
    amount: micro(-40_000n),
    transactionId: 'tx1',
  })
  const app = buildServer(deps)
  const body = (await app.inject({ method: 'GET', url: '/v1/tabs' })).json()

  assert.equal(body.registrationEnforced, true)
  assert.match(body.note, /One Starter Tab per funding root/)
  // No claim has been published in this fixture, and that is reported as data
  // rather than folded into the flag.
  assert.equal(body.rootsClaimed, 0)
  assert.equal(body.tabs.length, 1)
  // No tier, because nothing has been published for this tab — NOT `Unrated`.
  assert.equal(body.tabs[0].tier, undefined)
  assert.match(body.tabs[0].ceiling, /^\d+\.\d{6}$/)
  // And no claim recorded, which is NOT the same as denied — the gateway
  // cannot resolve a funding root and must not imply that it can.
  assert.equal(body.tabs[0].registeredRoot, undefined)
  await app.close()
})

test('a tab that HOLDS a claim reports the root and the seq that established it', async () => {
  const { deps, state } = depsFor({})
  state.push(TAB, {
    kind: 'debit',
    at: nowConsensus(),
    window: 5_963_000,
    holdId: 'h1',
    counterparty: SELLER,
    amount: micro(-40_000n),
    transactionId: 'tx1',
  })
  const app = buildServer({
    ...deps,
    rootsClaimed: () => 1,
    registrations: () =>
      new Map([
        [
          TAB,
          {
            tab: TAB,
            root: '0.0.8812188',
            ceiling: usdc('0.250000'),
            perCall: usdc('0.050000'),
            allowlist: [],
            at: '1.0',
            seq: 41,
          },
        ],
      ]),
  } as unknown as SpendDeps)

  const body = (await app.inject({ method: 'GET', url: '/v1/tabs' })).json()
  assert.equal(body.rootsClaimed, 1)
  assert.equal(body.tabs[0].registeredRoot, '0.0.8812188')
  assert.equal(body.tabs[0].registrationSeq, 41)
  await app.close()
})

test('settlements pass through absent gross legs rather than defaulting to zero', async () => {
  // A window whose credits were genuinely zero and one that never recorded them
  // are different facts. Both rendering as `0.0000` invents a netting.
  const { deps } = depsFor({})
  const app = buildServer({
    ...deps,
    settlements: () =>
      new Map([
        [
          TAB,
          [
            {
              kind: 'settlement' as const,
              at: '1.0',
              window: 5_963_000,
              net: usdc('0.110000'),
              outcome: 'clean' as const,
              rampFromBp: 2500,
              rampToBp: 4000,
            },
          ],
        ],
      ]),
  } as unknown as SpendDeps)

  const rows = (await app.inject({ method: 'GET', url: `/v1/tabs/${TAB}/settlements` })).json()
  assert.equal(rows[0].net, '0.110000')
  assert.equal(rows[0].credits, undefined)
  assert.equal(rows[0].receiptCount, undefined)
  await app.close()
})

/* ── the port a managed host actually sets ───────────────────────────────── */

test('PORT is honoured, because that is what Render and every other host sets', () => {
  /*
   * Render, Fly, Heroku and Cloud Run all inject `PORT` and expect the service
   * to bind it. A service listening anywhere else fails its health check and the
   * deploy is marked dead with NO error in the logs — from the process's point
   * of view nothing went wrong, which is what makes it hard to diagnose.
   */
  assert.equal(loadEnv({ ...FULL_ENV, PORT: '10000' }).port, 10_000)
})

test('GATEWAY_PORT still wins, so a local override is unchanged', () => {
  assert.equal(loadEnv({ ...FULL_ENV, PORT: '10000', GATEWAY_PORT: '8080' }).port, 8080)
})

test('with neither set it falls back to 8080', () => {
  assert.equal(loadEnv(FULL_ENV).port, 8080)
})

test('rootsClaimed counts ROOTS, not tabs — they are not the same number', () => {
  /*
   * Served as `registrations.size` at first, which counts TABS. On live data
   * that reported 1 where 2 roots were claimed: one tab held claims on two
   * roots, because an early claim on `0.0.2` was left inert when system
   * accounts stopped resolving as roots.
   *
   * Asserted against the ledger reader rather than the route, because that is
   * where the two maps are built and where the distinction lives.
   */
  const claims = [
    published(
      {
        v: SCHEMA_VERSION,
        t: 'register',
        tab: TAB,
        w: 1,
        root: '0.0.2',
        ceil: '0.250000',
        perCall: '0.050000',
        allowlist: [],
      } as TabMessage,
      1000,
      1,
    ),
    published(
      {
        v: SCHEMA_VERSION,
        t: 'register',
        tab: TAB,
        w: 2,
        root: '0.0.8812188',
        ceil: '0.250000',
        perCall: '0.050000',
        allowlist: [],
      } as TabMessage,
      2000,
      2,
    ),
  ]
  const replay = registrationsFromMessages(claims)
  assert.equal(replay.byTab.size, 1)
  assert.equal(replay.byRoot.size, 2)
})

/** Encode a message the way a topic carries it. */
function published(message: TabMessage, seconds: number, seq: number): TopicMessage {
  return {
    payload: encode(message),
    consensusTimestamp: `${seconds}.000000000`,
    sequenceNumber: seq,
  }
}

/* ── CORS: the console is a browser on another origin ────────────────────── */

test('a READ carries a wildcard CORS header, or the console cannot display it', async () => {
  /*
   * This whole family of bug is invisible to curl: the request succeeds, the
   * status is 200, the body is correct, and the browser throws it away because
   * the header is missing. The console showed "GATEWAY UNREACHABLE" against a
   * gateway that was answering every request perfectly.
   *
   * Reads are `*` because they serve what is already public on an HCS topic.
   */
  const { deps } = depsFor({})
  const app = buildServer(deps)
  const res = await app.inject({
    method: 'GET',
    url: '/v1/tabs',
    headers: { origin: 'https://tab.vercel.app' },
  })
  assert.equal(res.statusCode, 200)
  assert.equal(res.headers['access-control-allow-origin'], '*')
  await app.close()
})

test('a preflight is answered 204, not the 404 an unrouted OPTIONS would give', async () => {
  /*
   * Fastify has no OPTIONS route for these paths, so without the hook a
   * preflight 404s — which fails CORS exactly as hard as a missing header, but
   * reports itself in the browser as a routing problem.
   */
  const { deps } = depsFor({})
  const app = buildServer(deps)
  const res = await app.inject({
    method: 'OPTIONS',
    url: '/v1/tabs',
    headers: { origin: 'https://tab.vercel.app', 'access-control-request-method': 'GET' },
  })
  assert.equal(res.statusCode, 204)
  assert.equal(res.headers['access-control-allow-origin'], '*')
  assert.match(String(res.headers['access-control-allow-methods']), /GET/)
  await app.close()
})

test('SPEND is not wildcarded — an unlisted origin gets no allow header', async () => {
  /*
   * /v1/spend has no authentication. A wildcard would let any page on the
   * internet make a visitor's browser spend against a tab.
   *
   * The request still SUCCEEDS server-side — CORS is a browser rule and inject
   * is not a browser — so what is asserted is the absence of the header, which
   * is the thing the browser actually reads.
   */
  const { deps } = depsFor({})
  const app = buildServer(deps)
  const res = await app.inject({
    method: 'OPTIONS',
    url: '/v1/spend',
    headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' },
  })
  assert.equal(res.statusCode, 204)
  assert.equal(res.headers['access-control-allow-origin'], undefined)
  await app.close()
})

test('a LISTED origin may spend, and the response says it varies by origin', async () => {
  const previous = process.env['CORS_ORIGINS']
  process.env['CORS_ORIGINS'] = 'https://tab.vercel.app, http://localhost:3000'
  try {
    const { deps } = depsFor({})
    const app = buildServer(deps)
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/v1/spend',
      headers: { origin: 'http://localhost:3000', 'access-control-request-method': 'POST' },
    })
    // Echoed exactly, never `*` — and marked Vary so a cache cannot hand this
    // response to a different origin.
    assert.equal(res.headers['access-control-allow-origin'], 'http://localhost:3000')
    assert.equal(res.headers['vary'], 'Origin')
    await app.close()
  } finally {
    if (previous === undefined) delete process.env['CORS_ORIGINS']
    else process.env['CORS_ORIGINS'] = previous
  }
})

test('a non-browser client is untouched — no Origin, no CORS headers', async () => {
  /*
   * Agents and the CLI send no Origin. Emitting CORS headers at them would be
   * noise, and asserting their absence pins that the hook returns early rather
   * than treating a missing Origin as a disallowed one.
   */
  const { deps } = depsFor({})
  const app = buildServer(deps)
  const res = await app.inject({ method: 'GET', url: '/health' })
  assert.equal(res.statusCode, 200)
  assert.equal(res.headers['access-control-allow-origin'], undefined)
  await app.close()
})

/* ── resolving who to pay ────────────────────────────────────────────────── */

test('a PLAIN seller url resolves the counterparty from the 402 challenge', async () => {
  /*
   * The demo's first sentence. `?payTo=` was a fixture convention every script
   * appended, so this path was never exercised until someone pasted a real URL
   * and got a 502 carrying a schema dump about a field they never supplied.
   */
  const challenge = Buffer.from(
    JSON.stringify({ accepts: [{ payTo: '0.0.10379572', amount: '50000' }] }),
  ).toString('base64')

  const realFetch = globalThis.fetch
  globalThis.fetch = (async () =>
    new Response('{}', {
      status: 402,
      headers: { 'payment-required': challenge },
    })) as typeof fetch

  try {
    const { deps } = depsFor({})
    const app = buildServer(deps)
    const res = await app.inject({
      method: 'POST',
      url: '/v1/spend',
      payload: {
        tab: '0.0.10390398',
        url: 'https://tab-seller.onrender.com/feed/25',
        max: '0.050000',
      },
    })
    // Whatever the outcome, it must NOT be the unresolved-counterparty failure:
    // the challenge named an account, so the rail knows who it is paying.
    assert.doesNotMatch(JSON.stringify(res.json()), /could not work out who to pay/)
    await app.close()
  } finally {
    globalThis.fetch = realFetch
  }
})

test('a seller that serves NO challenge fails cleanly, without reserving anything', async () => {
  /*
   * The important half is "without reserving anything". The old code published
   * a hold naming `'unknown'`, the schema rejected it, and the spend died as a
   * 502 — after the hold had already been pushed into state, stranding credit.
   */
  const realFetch = globalThis.fetch
  globalThis.fetch = (async () => new Response('hello', { status: 200 })) as typeof fetch

  try {
    const { deps } = depsFor({})
    const app = buildServer(deps)
    const before = await app.inject({ method: 'GET', url: '/v1/tabs/0.0.10390398' })
    const res = await app.inject({
      method: 'POST',
      url: '/v1/spend',
      payload: { tab: '0.0.10390398', url: 'https://example.com/free', max: '0.050000' },
    })
    // An infrastructure failure is a 502 carrying `error` — deliberately NOT
    // the 200-with-a-refusal shape, so it can never pollute the Refusals view.
    const body = res.json()
    assert.equal(res.statusCode, 502)
    assert.match(String(body.error), /could not work out who to pay/)

    // No credit moved: holds are exactly what they were.
    const after = await app.inject({ method: 'GET', url: '/v1/tabs/0.0.10390398' })
    assert.equal(after.json().holds, before.json().holds)
    await app.close()
  } finally {
    globalThis.fetch = realFetch
  }
})

test('an explicit ?payTo= still wins, so existing demo scripts keep working', async () => {
  let fetched = false
  const realFetch = globalThis.fetch
  globalThis.fetch = (async () => {
    fetched = true
    return new Response('{}', { status: 402 })
  }) as typeof fetch

  try {
    const { deps } = depsFor({})
    const app = buildServer(deps)
    await app.inject({
      method: 'POST',
      url: '/v1/spend',
      payload: {
        tab: '0.0.10390398',
        url: 'https://seller.example/rank?payTo=0.0.10379572',
        max: '0.050000',
      },
    })
    // A well-formed query id short-circuits the network entirely.
    assert.equal(fetched, false, 'a valid ?payTo= must not trigger a challenge fetch')
    await app.close()
  } finally {
    globalThis.fetch = realFetch
  }
})

test('the per-call cap fires on the SELLER quote when no max is given', async () => {
  /*
   * The regression that made this test exist.
   *
   * When the chat tool defaulted `max` to the per-call cap, every spend arrived
   * exactly AT the cap, passed the check, and then failed at payment time
   * against a seller charging more. PER_CALL_CAP — the refusal the entire
   * product is built to demonstrate — could no longer fire at all, and an
   * underwriting decision surfaced to the user as a 502.
   *
   * A seller asking 0.200000 against a 0.050000 cap must be REFUSED, on the
   * rule, at a 200, without a caller-supplied number anywhere in it.
   */
  const challenge = Buffer.from(
    JSON.stringify({ accepts: [{ payTo: '0.0.10379572', amount: '200000' }] }),
  ).toString('base64')

  const realFetch = globalThis.fetch
  globalThis.fetch = (async () =>
    new Response('{}', { status: 402, headers: { 'payment-required': challenge } })) as typeof fetch

  try {
    const { deps } = depsFor({})
    const app = buildServer(deps)
    const res = await app.inject({
      method: 'POST',
      url: '/v1/spend',
      payload: { tab: '0.0.10390398', url: 'https://seller.example/feed/100' },
    })

    assert.equal(res.statusCode, 200, 'a refusal is a 200, never an error status')
    const body = res.json()
    assert.equal(body.refused.rule, 'PER_CALL_CAP')
    // The evidence quotes the SELLER's price, not a number the caller invented.
    assert.equal(body.refused.evidence.requested, '0.2000')
    await app.close()
  } finally {
    globalThis.fetch = realFetch
  }
})

test('a quote WITHIN the cap is underwritten at the seller price, not at the cap', async () => {
  /*
   * The other half: accepting the quote must debit what the seller asked, not
   * the ceiling it was checked against. Reserving the cap would overstate every
   * hold and eat headroom the agent never spent.
   */
  const challenge = Buffer.from(
    JSON.stringify({ accepts: [{ payTo: '0.0.10379572', amount: '2000' }] }),
  ).toString('base64')

  const receipts = fakeReceipts()
  const realFetch = globalThis.fetch
  globalThis.fetch = (async () =>
    new Response('{}', { status: 402, headers: { 'payment-required': challenge } })) as typeof fetch

  try {
    const { deps } = depsFor({
      client: fakeClient({ amountPaid: 2_000n }).client,
      receipts: receipts.writer,
    })
    await spend(deps, { tab: TAB, url: 'https://seller.example/feed/1' })

    const hold = receipts.written.find((m) => m.t === 'hold')
    assert.ok(hold, 'a hold was published')
    assert.equal(hold.amt, '0.002000', 'reserved the quote, not the per-call cap')
  } finally {
    globalThis.fetch = realFetch
  }
})
