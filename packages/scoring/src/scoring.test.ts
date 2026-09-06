import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHash } from 'node:crypto'
import { format, usdc } from '@tab/money'
import { MODEL_VERSION, tierMultipleBpFor } from '@tab/params'
import { effectiveRevenue } from './effective-revenue.ts'
import { tierOf } from './tier.ts'
import { computeCeiling, mayApplyMidWindow } from './ceiling.ts'
import type { CeilingInputs } from './inputs.ts'

const NO_CAP = usdc('1000.000000')
const FLOOR = usdc('1.000000')

function inputs(over: Partial<CeilingInputs> = {}): CeilingInputs {
  return {
    revenue: usdc('1.000000'),
    attested: usdc('1.000000'),
    unattested: usdc('0.000000'),
    tier: 'B',
    multipleBp: 20_000,
    rampBp: 10_000,
    hardCap: NO_CAP,
    starterFloor: FLOOR,
    hasDefaulted: false,
    ...over,
  }
}

/* ── effective revenue ───────────────────────────────────────────────────── */

test('unattested revenue counts at the discount, attested at face', () => {
  const r = effectiveRevenue(
    [{ window: 1, attested: usdc('1.000000'), unattested: usdc('1.000000') }],
    1,
    6000,
  )
  // 1.00 + (1.00 × 0.6) = 1.60
  assert.equal(format(r.perWindow), '1.6000')
  assert.equal(format(r.attested), '1.0000')
  assert.equal(format(r.unattested), '1.0000', 'the split stays visible so the discount is auditable')
})

test('an agent whose revenue is ENTIRELY unattested reflects only the discount', () => {
  const r = effectiveRevenue(
    [{ window: 1, attested: usdc('0.000000'), unattested: usdc('10.000000') }],
    1,
    6000,
  )
  assert.equal(format(r.perWindow), '6.0000')
})

test('the average divides by the window COUNT, not by windows with activity', () => {
  // Earning 6.00 once in six windows is a lower run-rate than 1.00 in each.
  // Dividing by non-empty windows would rate them identically and hand an
  // attacker a lever: earn once, borrow against a run-rate that never existed.
  const spiky = effectiveRevenue([{ window: 6, attested: usdc('6.000000'), unattested: usdc('0.000000') }], 6, 6000)
  assert.equal(format(spiky.perWindow), '1.0000')

  const steady = effectiveRevenue(
    Array.from({ length: 6 }, (_, i) => ({ window: i + 1, attested: usdc('1.000000'), unattested: usdc('0.000000') })),
    6,
    6000,
  )
  assert.equal(format(steady.perWindow), '1.0000')
  assert.equal(spiky.perWindow, steady.perWindow, 'same total over the same span')
})

test('only the trailing N windows count, whatever order they arrive in', () => {
  const history = [
    { window: 3, attested: usdc('3.000000'), unattested: usdc('0.000000') },
    { window: 1, attested: usdc('99.000000'), unattested: usdc('0.000000') },
    { window: 2, attested: usdc('3.000000'), unattested: usdc('0.000000') },
  ]
  // Windows 2 and 3 only — window 1's spike has aged out.
  assert.equal(format(effectiveRevenue(history, 2, 6000).perWindow), '3.0000')
  // And shuffling the input must not change the answer.
  const shuffled = [history[1]!, history[2]!, history[0]!]
  assert.equal(effectiveRevenue(shuffled, 2, 6000).perWindow, effectiveRevenue(history, 2, 6000).perWindow)
})

test('no history is zero revenue, not a crash', () => {
  const r = effectiveRevenue([], 6, 6000)
  assert.equal(r.perWindow, 0n)
  assert.equal(r.windows, 0)
})

test('negative revenue is rejected', () => {
  assert.throws(
    () => effectiveRevenue([{ window: 1, attested: -1n as never, unattested: usdc('0.000000') }], 1, 6000),
    /cannot be negative/,
  )
})

/* ── tier ────────────────────────────────────────────────────────────────── */

test('a default collapses the tab to Unrated regardless of revenue', () => {
  const t = tierOf({ perWindow: usdc('100.000000'), counterparties: 20, cleanStreak: 50, hasDefaulted: true })
  assert.equal(t.tier, 'Unrated')
  assert.match(t.reason, /no partial credit/)
})

test('A-grade revenue with no settlement history does NOT get B by falling through', () => {
  // The bug this catches: awarding "the tier below" without checking that
  // tier's own requirements. B needs a streak of 4; this tab has none.
  const t = tierOf({ perWindow: usdc('50.000000'), counterparties: 20, cleanStreak: 0, hasDefaulted: false })
  assert.equal(t.tier, 'Unrated', 'no band is fully met, so no band is awarded')
  assert.match(t.reason, /clean streak/)
})

test('A-grade revenue with B-grade history settles at B', () => {
  const t = tierOf({ perWindow: usdc('50.000000'), counterparties: 5, cleanStreak: 4, hasDefaulted: false })
  assert.equal(t.tier, 'B')
})

test('revenue from a single buyer cannot reach a diversified tier', () => {
  const t = tierOf({ perWindow: usdc('50.000000'), counterparties: 1, cleanStreak: 50, hasDefaulted: false })
  assert.equal(t.tier, 'C', 'C needs only one counterparty; A and B need a market')
})

test('every requirement met earns the top tier', () => {
  const t = tierOf({ perWindow: usdc('5.000000'), counterparties: 5, cleanStreak: 10, hasDefaulted: false })
  assert.equal(t.tier, 'A')
})

test('revenue below the lowest band is Unrated', () => {
  const t = tierOf({ perWindow: usdc('0.010000'), counterparties: 9, cleanStreak: 99, hasDefaulted: false })
  assert.equal(t.tier, 'Unrated')
})

/* ── ceiling ─────────────────────────────────────────────────────────────── */

test('the formula multiplies revenue by the tier multiple and the ramp', () => {
  // 1.00 × 2.0 × 0.5 = 1.00
  const r = computeCeiling(inputs({ rampBp: 5000 }))
  assert.equal(format(r.ceiling), '1.0000')
})

test('an agent with revenue but a default gets EXACTLY zero, floor and all', () => {
  const r = computeCeiling(inputs({ tier: 'Unrated', revenue: usdc('500.000000'), hasDefaulted: true }))
  assert.equal(r.ceiling, 0n)
  assert.equal(r.binding, 'unrated')
  // The floor must not rescue a defaulted tab, or the harshest rule in the
  // product becomes a brief inconvenience.
  assert.ok(r.ceiling < FLOOR)
})

test('the starter floor lifts a rated tab that has not earned yet', () => {
  const r = computeCeiling(inputs({ revenue: usdc('0.000000') }))
  assert.equal(format(r.ceiling), '1.0000')
  assert.equal(r.binding, 'starter_floor')
})

test('the tier hard cap binds before the formula result does', () => {
  const r = computeCeiling(inputs({ revenue: usdc('100.000000'), hardCap: usdc('5.000000') }))
  assert.equal(format(r.ceiling), '5.0000')
  assert.equal(r.binding, 'hard_cap')
})

test('the hard cap beats the starter floor — a cap that yields is not a cap', () => {
  const r = computeCeiling(inputs({ revenue: usdc('0.000000'), hardCap: usdc('0.500000'), starterFloor: usdc('1.000000') }))
  assert.equal(format(r.ceiling), '0.5000')
  assert.equal(r.binding, 'hard_cap')
})

test('the ramp clamps behave at both ends', () => {
  const zero = computeCeiling(inputs({ revenue: usdc('10.000000'), rampBp: 0, starterFloor: usdc('0.000000') }))
  assert.equal(zero.ceiling, 0n, 'a collapsed ramp means no credit, whatever the revenue')

  const full = computeCeiling(inputs({ revenue: usdc('10.000000'), rampBp: 10_000 }))
  assert.equal(format(full.ceiling), '20.0000', '10.00 × 2.0 × 1.0')
})

test('one division, not two — truncation must not compound with the ramp', () => {
  // Two separate divisions truncate twice, and the loss lands harder on a low
  // ramp than a high one for no reason visible in the published inputs.
  const r = computeCeiling(inputs({ revenue: usdc('0.000001'), multipleBp: 30_000, rampBp: 3333, starterFloor: usdc('0.000000') }))
  // 1 × 30000 × 3333 / 100000000 = 0.99 → 0 micro-units, truncated once.
  assert.equal(r.ceiling, 0n)
})

test('negative inputs are rejected rather than producing a negative ceiling', () => {
  assert.throws(() => computeCeiling(inputs({ multipleBp: -1 })), /cannot be negative/)
  assert.throws(() => computeCeiling(inputs({ revenue: -1n as never })), /cannot be negative/)
})

test('every result carries the model version it was computed under', () => {
  assert.equal(computeCeiling(inputs()).modelVersion, MODEL_VERSION)
})

/* ── determinism, which is the verify-ceiling claim ──────────────────────── */

test('a ceiling recomputed from its published inputs hash-matches', () => {
  // The transparency claim in miniature: publish the inputs, and anyone can
  // rerun the formula and get the same number and the same hash.
  const published = computeCeiling(inputs({ revenue: usdc('2.500000'), rampBp: 4000 }))

  const canonical = (v: unknown): string =>
    v === null || typeof v !== 'object'
      ? JSON.stringify(typeof v === 'bigint' ? v.toString() : v)
      : Array.isArray(v)
        ? `[${v.map(canonical).join(',')}]`
        : `{${Object.entries(v as Record<string, unknown>)
            .sort(([a], [b]) => (a < b ? -1 : 1))
            .map(([k, x]) => `${JSON.stringify(k)}:${canonical(x)}`)
            .join(',')}}`

  const hashOf = (r: typeof published) =>
    createHash('sha256').update(canonical(r.inputs)).digest('hex')

  const recomputed = computeCeiling(published.inputs)
  assert.equal(recomputed.ceiling, published.ceiling)
  assert.equal(hashOf(recomputed), hashOf(published))
  assert.equal(recomputed.binding, published.binding)
})

test('the tier multiple comes from params, so the formula tracks a version bump', () => {
  const r = computeCeiling(inputs({ tier: 'A', multipleBp: tierMultipleBpFor('A'), revenue: usdc('1.000000') }))
  assert.equal(format(r.ceiling), '3.0000', 'A is 3.0x at MODEL_VERSION 1')
})

/* ── the asymmetry rule ──────────────────────────────────────────────────── */

test('a ceiling may SHRINK mid-window, instantly', () => {
  const r = mayApplyMidWindow(usdc('10.000000'), usdc('2.000000'))
  assert.equal(r.allowed, true)
  assert.match(r.reason, /safety action/)
})

test('a ceiling may NOT GROW mid-window', () => {
  // The loop attacker's fastest path if this were allowed: fake revenue, watch
  // the ceiling rise in the same window, spend against it before anything
  // settles, repeat.
  const r = mayApplyMidWindow(usdc('2.000000'), usdc('10.000000'))
  assert.equal(r.allowed, false)
  assert.match(r.reason, /waits for a clean settlement/)
})

test('an unchanged ceiling is not a growth', () => {
  assert.equal(mayApplyMidWindow(usdc('2.000000'), usdc('2.000000')).allowed, true)
})

test('A BRAND-NEW TAB CAN START: no revenue, Unrated, but gets the starter floor', () => {
  // The bug this locks down: zeroing on `tier === Unrated` meant a new agent
  // had no revenue, so was Unrated, so had a ceiling of zero, so could not
  // spend, so could never earn the revenue that would rate it. The starter
  // floor existed for exactly this case and was unreachable.
  const r = computeCeiling(inputs({
    tier: 'Unrated', revenue: usdc('0.000000'), multipleBp: 0, hasDefaulted: false,
  }))
  assert.equal(format(r.ceiling), '1.0000')
  assert.equal(r.binding, 'starter_floor')
})

test('a DEFAULTED tab gets zero even though a new tab with identical inputs does not', () => {
  // Same tier, same revenue, same floor. The only difference is the default,
  // and it is the whole difference.
  const base = { tier: 'Unrated' as const, revenue: usdc('0.000000'), multipleBp: 0 }
  const fresh = computeCeiling(inputs({ ...base, hasDefaulted: false }))
  const burned = computeCeiling(inputs({ ...base, hasDefaulted: true }))
  assert.equal(format(fresh.ceiling), '1.0000')
  assert.equal(burned.ceiling, 0n)
})
