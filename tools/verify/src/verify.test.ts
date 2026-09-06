import assert from 'node:assert/strict'
import { test } from 'node:test'
import { canonicalHash } from '@tab/protocol'
import { format, usdc } from '@tab/money'
import { MODEL_ID } from '@tab/params'
import { computeCeiling } from '@tab/scoring'
import { inputsFrom, recheck, versionOf, type RecheckTarget } from './recheck.ts'

/**
 * A record shaped exactly like a published one.
 *
 * Built by running the real formula and serialising the way `apps/engine` does,
 * so these tests exercise the same path a real ceiling took rather than a
 * convenient stand-in.
 */
async function publish(over: Record<string, unknown> = {}): Promise<RecheckTarget> {
  const inputs = {
    rev: '2.500000',
    revAtt: '2.500000',
    revUnatt: '0.000000',
    tier: 'B',
    mult: 20_000,
    ramp: 4000,
    cap: '1000.000000',
    floor: '1.000000',
    def: false,
    ...over,
  }
  const result = computeCeiling(inputsFrom(inputs))
  return {
    ceiling: result.ceiling,
    binding: result.binding,
    model: MODEL_ID,
    hash: await canonicalHash(inputs),
    inputs,
  }
}

/* ── the happy path ──────────────────────────────────────────────────────── */

test('a genuine published ceiling verifies', async () => {
  const result = await recheck(await publish())
  assert.equal(result.ok, true)
  assert.equal(result.hashOk, true)
  assert.equal(result.valueOk, true)
  assert.equal(result.bindingOk, true)
  assert.equal(result.failure, undefined)
})

/* ── the property that makes a PASS worth anything ──────────────────────── */

test('TAMPERING with an input is caught as a hash mismatch', async () => {
  // Without this test, "it printed PASS against live data once" is all we know
  // — and a checker that cannot fail is not a checker.
  const target = await publish()
  const tampered: RecheckTarget = {
    ...target,
    inputs: { ...target.inputs, rev: '250.000000' },
  }
  const result = await recheck(tampered)
  assert.equal(result.ok, false)
  assert.equal(result.hashOk, false)
  assert.equal(result.failure, 'hash_mismatch', 'the record contradicts itself')
})

test('a ceiling VALUE inflated without touching the inputs is caught', async () => {
  // The other direction: inputs and hash agree, but the published number is not
  // what they produce. Hash checking alone would pass this.
  const target = await publish()
  const lying: RecheckTarget = { ...target, ceiling: usdc('999.000000') }
  const result = await recheck(lying)
  assert.equal(result.ok, false)
  assert.equal(result.hashOk, true, 'the inputs are authentic')
  assert.equal(result.valueOk, false, 'but they do not produce the published ceiling')
  assert.equal(result.failure, 'not_reproducible')
})

test('a changed BINDING is caught even when the number matches', async () => {
  // How the real seq-1 failure presented: same ceiling, different binding,
  // because computeCeiling's behaviour changed after publication.
  const target = await publish()
  const result = await recheck({ ...target, binding: 'hard_cap' })
  assert.equal(result.ok, false)
  assert.equal(result.valueOk, true)
  assert.equal(result.bindingOk, false)
  assert.equal(result.failure, 'not_reproducible')
})

/* ── the asymmetry rule must not read as fraud ──────────────────────────── */

test('a HELD growth verifies against `computed`, not against `ceil`', async () => {
  // A held ceiling is deliberately lower than the formula's result. Comparing
  // to `ceil` would fail every one of them and report the safety rule working
  // as though it were tampering.
  const target = await publish()
  const held: RecheckTarget = {
    ...target,
    ceiling: usdc('1.000000'),
    computed: target.ceiling,
  }
  const result = await recheck(held)
  assert.equal(result.ok, true)
  assert.equal(result.heldBack, true)
  assert.equal(result.claimed, target.ceiling)
})

/* ── unverifiable must never read as fine ───────────────────────────────── */

test('an unknown parameter version throws rather than silently using the current one', async () => {
  const target = await publish()
  await assert.rejects(
    () => recheck({ ...target, model: 'tab-v99' }),
    /No parameter set for model version 99/,
  )
})

test('a malformed input record throws rather than coercing', () => {
  // The tier enum is validated before the amounts, so each case supplies a
  // valid tier to reach the check it is actually testing.
  assert.throws(() => inputsFrom({ tier: 'B', rev: 2.5 }), /expected a decimal string/)
  assert.throws(() => inputsFrom({ tier: 'Z' }), /not a known tier/)
  assert.throws(() => inputsFrom({}), /not a known tier/, 'an empty record is unverifiable')
})

test('a float where basis points belong is rejected', () => {
  assert.throws(
    () =>
      inputsFrom({
        rev: '1.000000', revAtt: '1.000000', revUnatt: '0.000000', tier: 'B',
        mult: 2.5, ramp: 4000, cap: '1.000000', floor: '1.000000',
      }),
    /not an integer basis-point value/,
  )
})

test('an absent `def` means false, so pre-field ceilings stay readable', () => {
  const inputs = inputsFrom({
    rev: '0.000000', revAtt: '0.000000', revUnatt: '0.000000', tier: 'B',
    mult: 20_000, ramp: 4000, cap: '1000.000000', floor: '1.000000',
  })
  assert.equal(inputs.hasDefaulted, false)
})

/* ── version parsing ────────────────────────────────────────────────────── */

test('the model id yields its parameter-set version', () => {
  assert.equal(versionOf('tab-v1'), 1)
  assert.equal(versionOf('tab-v12'), 12)
  assert.throws(() => versionOf('tab-vX'), /Cannot read a parameter-set version/)
})

/* ── determinism, restated as the claim a stranger relies on ────────────── */

test('the same published record verifies identically twice', async () => {
  const target = await publish({ ramp: 3333, rev: '1.234567' })
  const a = await recheck(target)
  const b = await recheck(target)
  assert.equal(a.rehash, b.rehash)
  assert.equal(a.recomputed, b.recomputed)
  assert.equal(format(a.recomputed), format(b.recomputed))
})
