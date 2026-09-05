import assert from 'node:assert/strict'
import { test } from 'node:test'
import { canonicalHash, canonicalize } from './canonical.ts'
import { decode, encode, MAX_MESSAGE_BYTES } from './wire.ts'
import { REFUSAL_CODES, isRetryable } from './refusal-codes.ts'
import type { CeilingUpdate, DebitReceipt, RefusalReceipt } from './messages.ts'

const debit: DebitReceipt = {
  v: 1, t: 'debit', tab: '0.0.8812188', w: 148,
  cp: '0.0.5120033', amt: '-0.018000',
  hold: 'h_01J8Q2ZK4M', req: '0ac4f1918b', tx: '0.0.8812188@1788621525.013141208',
}

test('a receipt round-trips through the wire format', () => {
  const out = decode(encode(debit))
  assert.equal(out.ok, true)
  if (out.ok) assert.deepEqual(out.message, debit)
})

test('a realistic receipt stays well under the single-chunk limit', () => {
  // Above ~1KB HCS chunks the payload and a lone chunk parses as truncated
  // JSON. Measured on testnet. Keep headroom, do not sail close.
  const size = encode(debit).length
  assert.ok(size < 400, `receipt is ${size} bytes; budget is ${MAX_MESSAGE_BYTES}`)
})

test('an oversized message is refused rather than silently chunked', () => {
  const bloated: RefusalReceipt = {
    v: 1, t: 'refused', tab: '0.0.8812188', w: 148,
    cp: '0.0.5591204', amt: '0.040000', rule: 'CONTROL_CLUSTER',
    ev: Object.fromEntries([...Array(200)].map((_, i) => [`k${i}`, 'x'.repeat(20)])),
  }
  assert.throws(() => encode(bloated), /single-chunk limit/)
})

test('decode reports failure instead of throwing, so a replay survives one bad message', () => {
  // The receipt topic already holds a bootstrap.hello from before the schema
  // existed. A replay must skip it, not abort everything after it.
  const stray = decode(JSON.stringify({ v: 1, type: 'bootstrap.hello', note: 'x' }))
  assert.equal(stray.ok, false)
  const truncated = decode('{"v":1,"t":"deb')
  assert.equal(truncated.ok, false)
  if (!truncated.ok) assert.match(truncated.reason, /JSON/)
})

test('amounts must carry exactly six decimals', () => {
  assert.throws(() => encode({ ...debit, amt: '-0.018' } as never))
  assert.throws(() => encode({ ...debit, amt: '-0.0180000' } as never))
  assert.doesNotThrow(() => encode({ ...debit, amt: '-0.018000' }))
})

test('canonical form is key-order independent', () => {
  assert.equal(
    canonicalize({ b: 1, a: { d: 2, c: 3 } }),
    canonicalize({ a: { c: 3, d: 2 }, b: 1 }),
  )
})

test('canonicalize refuses a float, because its decimal form is writer-dependent', () => {
  assert.throws(() => canonicalize({ rate: 0.6 }), /float/)
  assert.doesNotThrow(() => canonicalize({ rateBp: 6000 }))
})

test('the ceiling hash is reproducible from published inputs', async () => {
  const inputs: CeilingUpdate['inputs'] = {
    rev: '0.334000', revAtt: '0.334000', revUnatt: '0.000000',
    tier: 'C', mult: 10_000, ramp: 3000, cap: '2.000000', floor: '1.000000',
  }
  const a = await canonicalHash(inputs)
  // Same values, different insertion order — a stranger recomputing must match.
  const b = await canonicalHash({
    floor: '1.000000', cap: '2.000000', ramp: 3000, mult: 10_000,
    tier: 'C', revUnatt: '0.000000', revAtt: '0.334000', rev: '0.334000',
  })
  assert.equal(a, b)
  assert.match(a, /^[0-9a-f]{64}$/)
})

test('every refusal code has guidance and a retry answer', () => {
  assert.equal(REFUSAL_CODES.length, 6)
  for (const code of REFUSAL_CODES) assert.equal(typeof isRetryable(code), 'boolean')
  // Only these two can succeed on a later identical attempt.
  assert.deepEqual(REFUSAL_CODES.filter(isRetryable), ['WINDOW_CAP', 'CEILING_EXCEEDED'])
})
