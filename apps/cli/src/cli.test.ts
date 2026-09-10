import assert from 'node:assert/strict'
import { test } from 'node:test'
import { usdc } from '@tab/money'
import type { Tab } from '@tab/sdk'
import * as commands from './commands.ts'

/**
 * The operator surface.
 *
 * The behaviour worth pinning is the EXIT CODE, because that is what a shell
 * script guards on and getting it wrong makes the command unusable in one.
 */

const TAB = '0.0.1000'

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

test('A REFUSAL EXITS ZERO — the rail answered, and the answer is the output', async () => {
  /*
   * Exiting non-zero would make `tab spend` unusable in a shell script: every
   * refusal would look like the command broke, and a script guarding on `$?`
   * could not tell "the rule said no" from "the gateway is down".
   */
  const result = await commands.spend(
    fakeTab({
      spend: async () => ({
        outcome: 'refused',
        rule: 'CEILING_EXCEEDED',
        reason: 'Spend of 0.3000 refused.',
        guidance: 'Earn more attested revenue.',
        retryable: false,
        evidence: { ceiling: '0.250000', shortfall: '0.050000' },
      }),
    }),
    TAB,
    'http://seller',
    '0.300000',
  )
  assert.equal(result.exitCode, 0)
  const out = result.lines.join('\n')
  assert.match(out, /REFUSED {2}CEILING_EXCEEDED/)
  assert.match(out, /shortfall\s+0\.050000/)
  assert.match(out, /Retrying this exact call will be refused again/)
})

test('an INFRASTRUCTURE failure exits NON-ZERO, and hands back the key', async () => {
  // Nobody knows whether the seller was paid, so a script must be able to tell
  // this apart from a refusal — and a retry needs the same idempotency key.
  const result = await commands.spend(
    fakeTab({
      spend: async () => ({
        outcome: 'failed',
        reason: 'gateway unreachable',
        holdId: 'hold-abc123',
      }),
    }),
    TAB,
    'http://seller',
    '0.040000',
  )
  assert.equal(result.exitCode, 1)
  const out = result.lines.join('\n')
  assert.match(out, /NOT a refusal/)
  assert.match(out, /hold-abc123/)
})

test('a paid spend reports the SETTLED amount, not the cap', async () => {
  const result = await commands.spend(
    fakeTab({
      spend: async () => ({
        outcome: 'paid',
        amount: usdc('0.040000'),
        seller: '0.0.5000',
        holdId: 'h1',
        receiptSeq: 29,
        body: 'ok',
        elapsedMs: 31_000,
      }),
    }),
    TAB,
    'http://seller',
    '0.200000',
  )
  assert.equal(result.exitCode, 0)
  const out = result.lines.join('\n')
  assert.match(out, /PAID {2}0\.0400 to 0\.0\.5000/)
  assert.doesNotMatch(out, /0\.2000/)
})

test('an unpublished ceiling explains itself rather than printing a bare number', async () => {
  const result = await commands.ceiling(
    fakeTab({
      ceiling: async () => ({
        tab: TAB,
        published: false,
        enforced: usdc('0.250000'),
        history: [],
      }),
    }),
    TAB,
  )
  assert.equal(result.exitCode, 0)
  const out = result.lines.join('\n')
  assert.match(out, /No ceiling published yet/)
  // Something is ALWAYS enforced, and an operator needs that number.
  assert.match(out, /enforcing 0\.2500/)
  assert.match(out, /normal state/)
})

test('a lagging ceiling is FLAGGED, because that gap decides the next spend', async () => {
  const result = await commands.ceiling(
    fakeTab({
      ceiling: async () => ({
        tab: TAB,
        published: true,
        enforced: usdc('0.250000'),
        current: {
          ceiling: usdc('0.400000'),
          window: 1,
          binding: 'computed',
          cause: 'clean_settlement',
          at: '1.0',
          model: 'tab-v3',
          hash: 'abc',
          seq: 12,
          inputs: {
            revenue: usdc('1.000000'),
            revenueAttested: usdc('0.600000'),
            revenueUnattested: usdc('0.400000'),
            tier: 'C',
            multBp: 10_000,
            rampBp: 7000,
            cap: usdc('2.000000'),
            floor: usdc('0.250000'),
            defaulted: false,
          },
        },
        history: [],
      }),
    }),
    TAB,
  )
  const out = result.lines.join('\n')
  assert.match(out, /differs; the gateway polls the topic every 15s/)
})

test('the counterparties view shows the two values COMMON_FUNDER compares', async () => {
  const result = await commands.counterparties(
    fakeTab({
      counterparties: async () => [
        {
          counterparty: '0.0.10385196',
          bp: 0,
          reasons: ['COMMON_FUNDER'],
          blocking: true,
          revenue: usdc('0.500000'),
          shareBp: 884,
          window: 1,
          at: '1.0',
          funder: '0.0.8812188',
          tabFunder: '0.0.8812188',
        },
      ],
    }),
    TAB,
  )
  const out = result.lines.join('\n')
  assert.match(out, /BLOCKED/)
  assert.match(out, /SAME, which is what COMMON_FUNDER tests/)
})

test('an absent claim reads "no claim recorded", not "denied"', async () => {
  // The gateway cannot resolve a funding root, so it must not imply it can.
  const result = await commands.tabs(
    fakeTab({
      tabs: async () => ({
        window: 1,
        registrationEnforced: true,
        rootsClaimed: 1,
        note: 'note',
        tabs: [
          {
            tab: TAB,
            balance: usdc('0.000000'),
            outstanding: usdc('0.000000'),
            holds: usdc('0.000000'),
            available: usdc('0.250000'),
            ceiling: usdc('0.250000'),
            entries: 3,
          },
        ],
      }),
    }),
  )
  const out = result.lines.join('\n')
  assert.match(out, /no claim recorded/)
  assert.match(out, /no tier published/)
})

test('config reads the frozen parameter set and needs no gateway', () => {
  // No `tab` argument at all — it cannot depend on a reachable gateway, because
  // it is one of the two commands you run when nothing is configured.
  const result = commands.config()
  assert.equal(result.exitCode, 0)
  const out = result.lines.join('\n')
  assert.match(out, /tab-v3/)
  assert.match(out, /weight discounts/)
})

test('an empty receipt list says so rather than printing a blank table', async () => {
  const result = await commands.receipts(fakeTab({ receipts: async () => [] }), TAB, 10)
  assert.match(result.lines.join('\n'), /No receipts yet/)
})

test('receipts come back NEWEST first and honour the limit', async () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({
    leg: 'debit' as const,
    at: `${i}.0`,
    window: 1,
    seq: i,
    amount: usdc('0.010000'),
    counterparty: `0.0.${i}`,
  }))
  const result = await commands.receipts(fakeTab({ receipts: async () => rows }), TAB, 3)
  const out = result.lines.join('\n')
  assert.match(out, /3 of 20 entries, newest first/)
  assert.match(out, /seq 19/)
  assert.doesNotMatch(out, /seq 16/)
})
