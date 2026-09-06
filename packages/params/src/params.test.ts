import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHash } from 'node:crypto'
import {
  MODEL_ID, MODEL_VERSION, aprBpFor, caps, describeParams, params, paramsForVersion, tierMultipleBpFor, v1,
} from './index.ts'
import { v2 } from './versions/v2.ts'
import { parameterSet } from './schema.ts'
import { windowConsensusRange, windowEnd, windowOf, windowStart } from './window.ts'

/* ── the snapshot ────────────────────────────────────────────────────────── */

/**
 * If this fails, you changed a v1 number.
 *
 * That is not a test to update — it is the test working. A ceiling published
 * under v1 carries `model: 1` and `verify-ceiling` recomputes it from v1's
 * numbers; changing one retroactively makes every historical ceiling
 * unverifiable. Add `v2.ts`, bump `MODEL_VERSION`, and leave v1 alone.
 */
/** Key-sorted, so the hash tracks the VALUES and not zod's insertion order. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
}

test('v1 is frozen — this hash may never change', () => {
  // Ceilings are published under tab-v1 and verify-ceiling recomputes them from
  // these numbers forever. If this fails, historical ceilings just became
  // unverifiable — that is not a test to update.
  const hash = createHash('sha256').update(canonical(v1)).digest('hex')
  assert.equal(hash, '59b1d9f691cd7fe6dce030f5fc5750583fcc3ab5c42aad6f051534874d3ccb0f')
})

test('v2 is frozen — this hash may never change', () => {
  const hash = createHash('sha256').update(canonical(v2)).digest('hex')
  assert.equal(hash, '5c08590b49a03e568326546b9ddf257c474247a4f52684dc49f5707e5687a7f9')
})

test('v2 differs from v1 in EXACTLY one field', () => {
  // One deliberate change per version. A version that moved several numbers at
  // once is one nobody can reason about after the fact.
  const differing = Object.keys(v1).filter(
    (k) => canonical(v1[k as keyof typeof v1]) !== canonical(v2[k as keyof typeof v2]),
  )
  assert.deepEqual(differing.sort(), ['caps', 'version'])
  const { starterCeilingUsdc: a, ...restV1 } = v1.caps
  const { starterCeilingUsdc: b, ...restV2 } = v2.caps
  assert.deepEqual(restV1, restV2, 'only the starter floor moved inside caps')
  assert.equal(a, '1.000000')
  assert.equal(b, '0.250000')
})

test('the v2 floor lets earned credit become visible, which v1 did not', () => {
  // The reason v2 exists, as arithmetic. Earned credit for one young customer
  // is revenue x weight x multiple x ramp = 1.0 x 0.336 x 1.0 x 0.70.
  const earned = 0.2352
  assert.ok(earned < Number(v1.caps.starterCeilingUsdc), 'v1: the grant dominates the earning')
  const threeCalls = 1.5 * 0.336 * 1.0 * 0.7
  assert.ok(
    threeCalls > Number(v2.caps.starterCeilingUsdc),
    'v2: three calls at 0.50 clear the floor, so the ceiling can be seen to rise',
  )
})

test('the schema rejects a version that omits a field', () => {
  // A v2 that forgot a field must fail at import, not silently recompute a
  // different ceiling than the one that was published.
  const { ageFullDays: _dropped, ...incomplete } = v1
  assert.throws(() => parameterSet.parse(incomplete), /ageFullDays/)
})

/* ── version lookup ─────────────────────────────────────────────────────── */

test('every published version stays resolvable, not just the current one', () => {
  // v1 must remain recomputable forever, or every ceiling published under it
  // becomes unverifiable.
  assert.equal(paramsForVersion(1).version, 1)
  assert.equal(paramsForVersion(2).version, 2)
  assert.notEqual(paramsForVersion(1).caps.starterCeilingUsdc, paramsForVersion(2).caps.starterCeilingUsdc)
})

test('the current set is the one MODEL_VERSION names', () => {
  assert.equal(params.version, MODEL_VERSION)
  assert.deepEqual(paramsForVersion(MODEL_VERSION), params)
})

test('an unknown version throws rather than falling back to current', () => {
  // Verifying a v1 ceiling against v2 numbers reports a mismatch that looks
  // like fraud but is only a lookup bug.
  assert.throws(() => paramsForVersion(99), /No parameter set for model version 99/)
})

/* ── tier lookups ───────────────────────────────────────────────────────── */

test('Unrated pays the C rate — an unknown agent gets no benefit of the doubt', () => {
  assert.equal(aprBpFor('Unrated'), aprBpFor('C'))
  assert.ok(aprBpFor('A') < aprBpFor('C'), 'a better tier must cost less')
})

test('a better tier earns a higher ceiling multiple', () => {
  assert.ok(tierMultipleBpFor('A') > tierMultipleBpFor('B'))
  assert.ok(tierMultipleBpFor('B') > tierMultipleBpFor('C'))
  assert.ok(tierMultipleBpFor('C') > tierMultipleBpFor('Unrated'))
})

test('caps parse to money without going through a float', () => {
  assert.equal(caps.perCall, 50_000n)
  assert.equal(caps.perWindow, 1_000_000n)
  assert.equal(caps.starterCeiling, 250_000n, 'v2 lowered the starter floor')
  assert.equal(typeof caps.starterCeiling, 'bigint')
})

test('the ramp is asymmetric — trust is slower to earn than to lose', () => {
  assert.ok(v1.ramp.missedStepBp > v1.ramp.cleanStepBp)
})

test('the config dump names the testnet age tuning out loud', () => {
  const dump = describeParams().join('\n')
  assert.match(dump, /TUNED DOWN FOR TESTNET/)
  // Tracks MODEL_VERSION rather than pinning a literal, so a version bump does
  // not fail a test about the age tuning.
  assert.match(dump, new RegExp(`model version {8}${MODEL_VERSION}`))
})

/* ── window bucketing ───────────────────────────────────────────────────── */

test('a window is a floor division of epoch seconds', () => {
  assert.equal(windowOf(0, 600), 0)
  assert.equal(windowOf(599, 600), 0)
  assert.equal(windowOf(600, 600), 1)
  assert.equal(windowOf(1_788_654_023, 600), 2_981_090)
})

test('milliseconds passed by accident are rejected, not silently bucketed', () => {
  // The failure this prevents: the gateway files receipts into one window
  // number and the worker settles a different one, so nothing ever settles.
  assert.throws(() => windowOf(Date.now(), 600), /that is milliseconds/)
})

test('a non-positive window length is a programming error', () => {
  assert.throws(() => windowOf(1000, 0), /positive integer/)
  assert.throws(() => windowOf(1000, -600), /positive integer/)
  assert.throws(() => windowOf(1000, 1.5), /positive integer/)
})

test('window bounds are half-open, so a boundary receipt is counted once', () => {
  const w = 2_981_090
  assert.equal(windowStart(w, 600), 1_788_654_000)
  assert.equal(windowEnd(w, 600), 1_788_654_600)
  // The end of one window is the start of the next, never both.
  assert.equal(windowEnd(w, 600), windowStart(w + 1, 600))
  assert.equal(windowOf(windowEnd(w, 600), 600), w + 1)
})

test('the consensus range is what Mirror Node expects', () => {
  const range = windowConsensusRange(2_981_090, 600)
  assert.deepEqual(range, { from: '1788654000.000000000', to: '1788654600.000000000' })
})

test('MODEL_ID satisfies the protocol’s model field (3-32 chars)', () => {
  // A bare version number, or "v1", would fail the schema at publish time —
  // after the ceiling had already been computed.
  assert.ok(MODEL_ID.length >= 3 && MODEL_ID.length <= 32, MODEL_ID)
  assert.match(MODEL_ID, /^tab-v\d+$/)
  assert.ok(MODEL_ID.endsWith(String(MODEL_VERSION)))
})
