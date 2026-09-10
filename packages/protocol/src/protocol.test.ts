import assert from 'node:assert/strict'
import { test } from 'node:test'
import { canonicalHash, canonicalize } from './canonical.ts'
import { base58, hcs14Aid, hcs14Canonical, hcs14Uaid, tabAgent } from './hcs14.ts'
import type { CeilingUpdate, DebitReceipt, RefusalReceipt } from './messages.ts'
import { isRetryable, REFUSAL_CODES } from './refusal-codes.ts'
import { decode, encode, MAX_MESSAGE_BYTES } from './wire.ts'

const debit: DebitReceipt = {
  v: 1,
  t: 'debit',
  tab: '0.0.8812188',
  w: 148,
  cp: '0.0.5120033',
  amt: '-0.018000',
  hold: 'h_01J8Q2ZK4M',
  req: '0ac4f1918b',
  tx: '0.0.8812188@1788621525.013141208',
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
    v: 1,
    t: 'refused',
    tab: '0.0.8812188',
    w: 148,
    cp: '0.0.5591204',
    amt: '0.040000',
    rule: 'CONTROL_CLUSTER',
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
  assert.equal(canonicalize({ b: 1, a: { d: 2, c: 3 } }), canonicalize({ a: { c: 3, d: 2 }, b: 1 }))
})

test('canonicalize refuses a float, because its decimal form is writer-dependent', () => {
  assert.throws(() => canonicalize({ rate: 0.6 }), /float/)
  assert.doesNotThrow(() => canonicalize({ rateBp: 6000 }))
})

test('the ceiling hash is reproducible from published inputs', async () => {
  const inputs: CeilingUpdate['inputs'] = {
    rev: '0.334000',
    revAtt: '0.334000',
    revUnatt: '0.000000',
    tier: 'C',
    mult: 10_000,
    ramp: 3000,
    cap: '2.000000',
    floor: '1.000000',
  }
  const a = await canonicalHash(inputs)
  // Same values, different insertion order — a stranger recomputing must match.
  const b = await canonicalHash({
    floor: '1.000000',
    cap: '2.000000',
    ramp: 3000,
    mult: 10_000,
    tier: 'C',
    revUnatt: '0.000000',
    revAtt: '0.334000',
    rev: '0.334000',
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

/* ── HCS-14: a derived identifier, or it is worth nothing ────────────────── */

const AGENT = {
  registry: 'hol',
  name: 'Support Agent',
  version: '1.0.0',
  protocol: 'hcs-10',
  nativeId: 'hedera:testnet:0.0.123456',
  skills: [0, 17],
} as const

test('the canonical form matches the spec byte for byte', () => {
  /*
   * The whole standard IS the canonical form. Get these bytes wrong and the
   * identifier is not reproducible by anyone else — which is strictly worse
   * than not having one, because it looks interoperable and is not.
   *
   * Keys lexicographic, no whitespace, only the six required fields.
   */
  assert.equal(
    hcs14Canonical(AGENT),
    '{"name":"Support Agent","nativeId":"hedera:testnet:0.0.123456",' +
      '"protocol":"hcs-10","registry":"hol","skills":[0,17],"version":"1.0.0"}',
  )
})

test('ONLY the six required fields are hashed', () => {
  /*
   * Endpoints, topic ids and capabilities are excluded on purpose: the id has
   * to survive an endpoint move, or it is an address rather than an identity.
   */
  const withExtras = { ...AGENT, endpoint: 'https://example.com', topicId: '0.0.999' }
  assert.equal(hcs14Canonical(withExtras as never), hcs14Canonical(AGENT))
})

test('skills are sorted NUMERICALLY, not by string, and not by caller order', () => {
  // `[2, 10]` sorted as strings gives `[10, 2]` — a different identifier for
  // the same agent. An id that depended on how someone listed capabilities
  // would not be deterministic, which defeats the point.
  const a = hcs14Canonical({ ...AGENT, skills: [10, 2] })
  const b = hcs14Canonical({ ...AGENT, skills: [2, 10] })
  assert.equal(a, b)
  assert.match(a, /"skills":\[2,10\]/)
})

test('the AID is stable across runs and across field order', async () => {
  const first = await hcs14Aid(AGENT)
  const reordered = await hcs14Aid({
    skills: [17, 0],
    version: '1.0.0',
    nativeId: 'hedera:testnet:0.0.123456',
    registry: 'hol',
    protocol: 'hcs-10',
    name: 'Support Agent',
  })
  assert.equal(first, reordered)
  // Base58 alphabet only — no 0, O, I or l, which is the point of Base58.
  assert.match(first, /^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/)
})

test('a different agent gets a different AID', async () => {
  const mine = await hcs14Aid(AGENT)
  const theirs = await hcs14Aid({ ...AGENT, nativeId: 'hedera:testnet:0.0.999999' })
  assert.notEqual(mine, theirs)
})

test('base58 preserves leading zero bytes', () => {
  /*
   * Leading zeros carry no numeric value, so the bignum loop drops them. The
   * encoding requires one `1` per leading zero byte — without that, two
   * different digests could share an identifier.
   */
  assert.equal(base58(new Uint8Array([0, 0, 1])), '112')
  assert.equal(base58(new Uint8Array([0])), '1')
  assert.equal(base58(new Uint8Array([1])), '2')
})

test('the UAID carries the documented parameters in order', async () => {
  const uaid = await hcs14Uaid(AGENT)
  assert.match(
    uaid,
    /^uaid:aid:[1-9A-HJ-NP-Za-km-z]+;uid=0;registry=hol;proto=hcs-10;nativeId=hedera:testnet:0\.0\.123456$/,
  )
})

test('an absent domain is OMITTED, never emitted empty', async () => {
  // A trailing `domain=` would be a claim about an identifier nobody has.
  assert.doesNotMatch(await hcs14Uaid(AGENT), /domain=/)
  assert.match(await hcs14Uaid(AGENT, { domain: 'tab.xyz' }), /;domain=tab\.xyz$/)
})

test("the tab's own agent describes what it actually is", async () => {
  /*
   * `protocol: mcp` because that is how a third-party runtime actually reaches
   * this rail. Skills are the two it genuinely has — padding the list would
   * change the identifier AND claim capabilities it does not have, and the
   * value of a derived id is that it describes something true.
   */
  const agent = tabAgent('0.0.10390398')
  assert.equal(agent.nativeId, 'hedera:testnet:0.0.10390398')
  assert.equal(agent.protocol, 'mcp')
  assert.deepEqual([...agent.skills], [0, 17])

  const uaid = await hcs14Uaid(agent)
  assert.match(uaid, /^uaid:aid:/)
  assert.match(uaid, /nativeId=hedera:testnet:0\.0\.10390398$/)
})

test('the identity survives a redeployment onto a new account only if nativeId is stable', async () => {
  /*
   * Stated as a test because it is the honest limit of what this buys today.
   * The UAID is derived from `nativeId`, so moving the tab to a new Hedera
   * account DOES change it. What it fixes is portability across SYSTEMS, not
   * across accounts — closing that needs a stable nativeId (a DID), which is
   * the `uaid:did:` form and a later step.
   */
  const before = await hcs14Aid(tabAgent('0.0.10390398'))
  const after = await hcs14Aid(tabAgent('0.0.99999999'))
  assert.notEqual(before, after)
})
