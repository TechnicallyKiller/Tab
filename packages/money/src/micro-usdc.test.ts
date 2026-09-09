import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bp, bpFromRatio, formatBpDecimal, formatBpPercent, mulBp } from './basis-points.ts'
import { format, toWire } from './format.ts'
import { add, atLeastZero, micro, sub, sum, usdc } from './micro-usdc.ts'

test('parse and format round-trip', () => {
  for (const v of ['0.0000', '1.0000', '0.4821', '2.0000', '0.0180']) {
    assert.equal(format(usdc(v)), v)
  }
  assert.equal(format(usdc('-0.4821')), '−0.4821')
})

test('display truncates and never rounds up', () => {
  // The docs promise this. A display that rounds while the ledger truncates
  // makes the two disagree by a micro-USDC at the worst possible moment.
  assert.equal(format(usdc('0.999999')), '0.9999')
  assert.equal(format(usdc('-0.999999')), '−0.9999')
  assert.equal(format(micro(999_999n)), '0.9999')
})

test('sub-micro input is floored at parse, not carried', () => {
  assert.equal(usdc('0.0000005'), 0n)
})

test('wire form keeps all six decimals', () => {
  assert.equal(toWire(usdc('0.018')), '0.018000')
  assert.equal(toWire(usdc('-0.4821')), '-0.482100')
})

test('summing is order-independent', () => {
  const rows = ['-0.0400', '0.0250', '-0.0180', '0.0250', '-0.0180', '0.0120', '-0.0090'].map(usdc)
  const forward = sum(rows)
  const reverse = sum([...rows].reverse())
  assert.equal(forward, reverse)
  assert.equal(format(forward, { sign: 'always' }), '−0.0230')
})

test('mulBp requires a rounding direction and honours it', () => {
  // 0.333333 x 6000bp = 199_999.8 micro — a genuinely inexact case, which is
  // the only kind where the rounding argument changes anything.
  const amount = usdc('0.333333')
  assert.equal(mulBp(amount, bp(6000), 'down'), 199_999n)
  assert.equal(mulBp(amount, bp(6000), 'up'), 200_000n)
  assert.equal(mulBp(amount, bp(6000), 'half-up'), 200_000n)
  // An exact case must agree in every direction.
  assert.equal(mulBp(usdc('0.3333'), bp(6000), 'down'), mulBp(usdc('0.3333'), bp(6000), 'up'))
})

test('mulBp never leaves the [0, amount] range for rates at or below 1.0', () => {
  const amount = usdc('1.0000')
  for (const rate of [0, 1, 4000, 6000, 9999, 10_000]) {
    const out = mulBp(amount, bp(rate), 'down')
    assert.ok(out >= 0n && out <= amount, `rate ${rate} produced ${format(out)}`)
  }
})

test('mulBp preserves sign', () => {
  assert.equal(format(mulBp(usdc('-1.0000'), bp(5000), 'down')), '−0.5000')
})

test('basis points make the concentration cap exact at the boundary', () => {
  // 0.4 in floats is 0.4000000000000000222…, so a float comparison at exactly
  // 40% can flip depending on how the ratio was derived. This cannot.
  const share = bpFromRatio(usdc('0.4000'), usdc('1.0000'))
  assert.equal(share, 4000)
  assert.equal(share > 4000, false)
  assert.equal(formatBpPercent(share), '40.00%')
})

test('atLeastZero clamps a negative available balance', () => {
  assert.equal(atLeastZero(sub(usdc('0.1'), usdc('0.3'))), 0n)
})

test('add is exact across many small amounts', () => {
  let total = usdc('0.0000')
  for (let i = 0; i < 10_000; i++) total = add(total, usdc('0.0001'))
  assert.equal(format(total), '1.0000')
})

test('rejects a non-decimal string rather than silently producing NaN', () => {
  assert.throws(() => usdc('abc'))
  assert.throws(() => usdc(''))
})

test('formatBpDecimal renders a weight, not a percentage', () => {
  // Weights sit beside a share column that is already a percentage. Two
  // adjacent percentage columns meaning different things gets misread.
  assert.equal(formatBpDecimal(bp(10_000)), '1.00')
  assert.equal(formatBpDecimal(bp(8000)), '0.80')
  assert.equal(formatBpDecimal(bp(5000)), '0.50')
  assert.equal(formatBpDecimal(bp(0)), '0.00')
})
