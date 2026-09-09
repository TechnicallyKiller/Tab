import assert from 'node:assert/strict'
import { test } from 'node:test'
import { format, usdc } from '@tab/money'
import { MODEL_ID } from '@tab/params'
import { canonicalHash } from '@tab/protocol'
import { computeCeiling } from '@tab/scoring'
import { inputsFrom, type RecheckTarget, recheck, versionOf } from './recheck.ts'
import { reweigh } from './reweigh.ts'

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
        rev: '1.000000',
        revAtt: '1.000000',
        revUnatt: '0.000000',
        tier: 'B',
        mult: 2.5,
        ramp: 4000,
        cap: '1.000000',
        floor: '1.000000',
      }),
    /not an integer basis-point value/,
  )
})

test('an absent `def` means false, so pre-field ceilings stay readable', () => {
  const inputs = inputsFrom({
    rev: '0.000000',
    revAtt: '0.000000',
    revUnatt: '0.000000',
    tier: 'B',
    mult: 20_000,
    ramp: 4000,
    cap: '1000.000000',
    floor: '1.000000',
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

/* ── reweigh: proving a published WEIGHT, not just reading it ─────────────── */

const WEIGHT = {
  counterparty: '0.0.10393567',
  bp: 3360,
  reasons: ['SHARED_FUNDING_ROOT', 'YOUNG_ACCOUNT', 'CONCENTRATED'] as const,
  blocking: false,
  model: 'tab-v3',
}

test('a live weight reproduces from its published reasons — 0.7 × 0.6 × 0.8', () => {
  /*
   * The actual message on testnet, seq 28. Before v3 the discount steps lived
   * in `apps/engine`, so this number was readable and uncheckable; freezing
   * them in `@tab/params` is what makes the arithmetic available to a stranger.
   */
  const r = reweigh(WEIGHT)
  assert.equal(r.verdict, 'ok')
  assert.equal(r.recomputed, 3360)
  assert.equal(r.parameterVersion, 3)
})

test('a TAMPERED weight fails — which is the only thing that makes a PASS worth anything', () => {
  // Same reasons, a better number. This is what a publisher inflating its own
  // credit would look like on the topic.
  const r = reweigh({ ...WEIGHT, bp: 9000 })
  assert.equal(r.verdict, 'bp_mismatch')
  assert.equal(r.recomputed, 3360)
  assert.match(r.note!, /reproduce 3360bp, but the message published 9000bp/)
})

test('DROPPING a reason to justify a higher weight also fails', () => {
  // The other direction of the same fraud: keep the number, shorten the story.
  const r = reweigh({ ...WEIGHT, reasons: ['SHARED_FUNDING_ROOT'], bp: 3360 })
  assert.equal(r.verdict, 'bp_mismatch')
  assert.equal(r.recomputed, 7000)
})

test('a pre-v3 weight is NOT VERIFIABLE, and that is not a failure', () => {
  /*
   * v1 and v2 genuinely had no frozen weight policy — the steps lived in the
   * engine. So a weight published under them cannot be reproduced from the
   * frozen record, and the honest verdict is absence of proof rather than
   * evidence of a problem. Reporting FAIL would make the tool cry wolf about a
   * limitation it documents.
   */
  const r = reweigh({ ...WEIGHT, model: 'tab-v2' })
  assert.equal(r.verdict, 'not_verifiable')
  assert.match(r.note!, /no weight policy/)
  assert.equal(r.parameterVersion, 2)
})

test('a weight with NO model id is not verifiable — never "assume current"', () => {
  // Guessing the current set would check an old weight against numbers that
  // were not in force when it was written, and report PASS for it.
  const { model, ...noModel } = WEIGHT
  const r = reweigh(noModel)
  assert.equal(r.verdict, 'not_verifiable')
  assert.match(r.note!, /carries no model id/)
})

test('an unknown parameter version is not verifiable rather than a crash', () => {
  const r = reweigh({ ...WEIGHT, model: 'tab-v99' })
  assert.equal(r.verdict, 'not_verifiable')
  assert.match(r.note!, /No parameter set for model version 99/)
})

test('a hard block must be exactly zero AND carry a blocking reason', () => {
  const good = reweigh({
    counterparty: '0.0.10385196',
    bp: 0,
    reasons: ['COMMON_FUNDER'],
    blocking: true,
    model: 'tab-v3',
  })
  assert.equal(good.verdict, 'ok')

  // A blocking reason that did not block.
  const notZero = reweigh({
    counterparty: '0.0.1',
    bp: 5000,
    reasons: ['COMMON_FUNDER'],
    blocking: true,
    model: 'tab-v3',
  })
  assert.equal(notZero.verdict, 'blocking_inconsistent')

  // Zero weight with no blocking reason — a refusal nobody can explain.
  const unexplained = reweigh({
    counterparty: '0.0.1',
    bp: 0,
    reasons: ['YOUNG_ACCOUNT'],
    blocking: false,
    model: 'tab-v3',
  })
  assert.equal(unexplained.verdict, 'blocking_inconsistent')

  // Blocking flag set without a blocking reason.
  const mislabelled = reweigh({
    counterparty: '0.0.1',
    bp: 0,
    reasons: ['YOUNG_ACCOUNT'],
    blocking: true,
    model: 'tab-v3',
  })
  assert.equal(mislabelled.verdict, 'blocking_inconsistent')
})

test('a blocking inconsistency is caught WITHOUT a model id', () => {
  // It needs no parameter set — zero is zero in every version — so an old
  // message with no model can still fail this check rather than being skipped.
  const r = reweigh({ counterparty: '0.0.1', bp: 0, reasons: ['YOUNG_ACCOUNT'], blocking: false })
  assert.equal(r.verdict, 'blocking_inconsistent')
})

test('INDEPENDENT reproduces full weight, and carries no step', () => {
  const r = reweigh({
    counterparty: '0.0.1',
    bp: 10_000,
    reasons: ['INDEPENDENT'],
    blocking: false,
    model: 'tab-v3',
  })
  assert.equal(r.verdict, 'ok')
  assert.equal(r.recomputed, 10_000)
})

test('the new UNVERIFIED_FUNDING step reproduces, and applies FIRST', () => {
  const r = reweigh({
    counterparty: '0.0.1',
    bp: 2400,
    reasons: ['UNVERIFIED_FUNDING', 'YOUNG_ACCOUNT', 'CONCENTRATED'],
    blocking: false,
    model: 'tab-v3',
  })
  // 10000 → 5000 → 3000 → 2400. Order matters because truncation is not
  // commutative, so this pins the sequence as well as the numbers.
  assert.equal(r.verdict, 'ok')
  assert.equal(r.recomputed, 2400)
})

test('reason ORDER on the message does not change the result', () => {
  /*
   * The checker applies its own frozen ORDER, not the order the message happens
   * to list. A publisher that shuffled its reason array must not be able to
   * shift the number by a micro-unit and still pass.
   */
  const r = reweigh({
    ...WEIGHT,
    reasons: ['CONCENTRATED', 'YOUNG_ACCOUNT', 'SHARED_FUNDING_ROOT'],
  })
  assert.equal(r.verdict, 'ok')
  assert.equal(r.recomputed, 3360)
})
