import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import {
  aprBpFor,
  caps,
  describeParams,
  MODEL_ID,
  MODEL_VERSION,
  params,
  paramsForVersion,
  tierMultipleBpFor,
  v1,
  weightPolicyFor,
} from './index.ts'
import { parameterSet } from './schema.ts'
import { v2 } from './versions/v2.ts'
import { v3 } from './versions/v3.ts'
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
  assert.notEqual(
    paramsForVersion(1).caps.starterCeilingUsdc,
    paramsForVersion(2).caps.starterCeilingUsdc,
  )
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

/* ── v3: the discount steps join the frozen record ───────────────────────── */

test('v3 is frozen — this hash may never change', () => {
  const hash = createHash('sha256').update(canonical(v3)).digest('hex')
  assert.equal(hash, '657871508679a290dd4e59f5139912cc6a1027fbc9a2d85b158649d8ef3dee8c')
})

test('v3 differs from v2 in EXACTLY one field, plus the version', () => {
  // One deliberate change per version. `weights` moving in IS the change.
  const differing = Object.keys({ ...v2, ...v3 }).filter(
    (k) => canonical(v2[k as keyof typeof v2]) !== canonical(v3[k as keyof typeof v3]),
  )
  assert.deepEqual(differing.sort(), ['version', 'weights'])
})

test('v1 and v2 carry NO weight policy, and that is the accurate record', () => {
  /*
   * They genuinely did not have one — the discount steps lived in
   * `apps/engine/src/recompute.ts`. Back-filling them would claim a weight
   * published under `tab-v1` is reproducible from the frozen set when it is
   * not, which is rewriting history rather than recording it.
   */
  assert.equal(v1.weights, undefined)
  assert.equal(v2.weights, undefined)
  assert.equal(weightPolicyFor(1), undefined)
  assert.equal(weightPolicyFor(2), undefined)
})

test('weightPolicyFor returns the steps from v3 onward', () => {
  const policy = weightPolicyFor(3)
  assert.ok(policy)
  // The first five are exactly what the engine used, so no weight changed by
  // moving them into the set.
  assert.equal(policy.reciprocalBp, 5000)
  assert.equal(policy.reciprocalThresholdBp, 2500)
  assert.equal(policy.sharedRootBp, 7000)
  assert.equal(policy.youngBp, 6000)
  assert.equal(policy.concentratedBp, 8000)
  // The new one.
  assert.equal(policy.unverifiedBp, 5000)
})

test('an unknown version still THROWS, where a pre-v3 version returns undefined', () => {
  // Two different situations that must not present identically: an unknown
  // version is a lookup bug, a known version without this field is a fact
  // about history.
  assert.throws(() => weightPolicyFor(99), /No parameter set for model version 99/)
  assert.equal(weightPolicyFor(1), undefined)
})

test('the unverified discount is no gentler than the unattested one', () => {
  /*
   * "I cannot tell you who this counterparty is" is a weaker position than
   * "money arrived without a receipt", so it must not count for MORE. A future
   * version that loosened this would quietly make unverifiable revenue the
   * cheapest kind to manufacture.
   */
  const policy = weightPolicyFor(3)!
  assert.ok(policy.unverifiedBp <= v3.unattestedDiscountBp)
})

test('the unverified discount is NOT zero — an indexer hiccup is not a refusal', () => {
  /*
   * Blocking would turn routine Mirror Node lag into a simultaneous refusal for
   * every counterparty, which is an outage caused by an index. The original
   * fail-open existed partly for that reason and the reason was sound; only its
   * magnitude was wrong.
   */
  assert.ok(weightPolicyFor(3)!.unverifiedBp > 0)
})

test('the config dump reports a missing weight policy rather than inventing one', () => {
  const v3Dump = describeParams(v3).join('\n')
  assert.match(v3Dump, /weight discounts.*unverified 50\.00%/)

  const v1Dump = describeParams(v1).join('\n')
  assert.match(v1Dump, /not in this parameter set/)
  // And it says what that means for a reader, not just that it is absent.
  assert.match(v1Dump, /not reproducible from the frozen record/)
})
