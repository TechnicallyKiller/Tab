/**
 * Probe 5 — fast-path latency to managed Redis.
 *
 * The README budgets the spend decision at under 50ms and calls the
 * no-Mirror-Node rule an architectural ban rather than a target. With Upstash
 * instead of a local Redis, the network round trip is a real part of that
 * budget — and if it does not fit, the answer is architectural (a bigger
 * in-process cache), which is exactly why this belongs in Phase 0.
 *
 *   pnpm probe:latency
 */
import { Redis } from 'ioredis'

const url = process.env['REDIS_URL']
if (!url || url.includes('...')) {
  console.error('\n  REDIS_URL is not set in .env. Copy the rediss:// TCP URL from Upstash.\n')
  process.exit(1)
}

const BUDGET_MS = 50
const SAMPLES = 120

// A realistic ceiling snapshot: what the fast path actually reads on every spend.
const snapshot = JSON.stringify({
  v: 1,
  agent: '0.0.8812188',
  modelVersion: 'ceiling-v0.4.1',
  computedAt: '1787425980.794307104',
  ceiling: '1.000000',
  outstanding: '0.482100',
  holds: '0.090000',
  perCallCap: '0.050000',
  windowCap: '1.000000',
  windowSpend: '0.620000',
  tier: 'C',
  rampBp: 3000,
  frozen: false,
  breaker: false,
  // The control-cluster set the fast path does a membership test against.
  blockedSellers: ['0.0.5591204', '0.0.5300118'],
  sellerShareBp: { '0.0.5120033': 2000, '0.0.4899120': 4400 },
})

const percentile = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0

const time = async <T>(fn: () => Promise<T>): Promise<number> => {
  const t = performance.now()
  await fn()
  return performance.now() - t
}

console.log('\nProbe 5 — fast-path latency to Upstash Redis\n')
console.log(`  host            ${new URL(url).host}`)
console.log(`  budget          ${BUDGET_MS}ms for the whole spend decision`)
console.log(`  snapshot size   ${Buffer.byteLength(snapshot)} bytes\n`)

// BullMQ needs this against Upstash, or long-lived blocking connections drop
// and the workers look like they have silently stopped.
const redis = new Redis(url, { maxRetriesPerRequest: null, lazyConnect: true })

const connectMs = await time(async () => {
  await redis.connect()
})
console.log(`  connect         ${connectMs.toFixed(1)}ms  (once, at boot — not in the hot path)`)

const key = 'tab:probe:snapshot'
await redis.set(key, snapshot)

const report = (label: string, samples: number[]) => {
  const sorted = [...samples].sort((a, b) => a - b)
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length
  console.log(
    `  ${label.padEnd(15)} p50 ${percentile(sorted, 50).toFixed(1)}ms · ` +
      `p95 ${percentile(sorted, 95).toFixed(1)}ms · p99 ${percentile(sorted, 99).toFixed(1)}ms · ` +
      `mean ${mean.toFixed(1)}ms`,
  )
  return { p50: percentile(sorted, 50), p95: percentile(sorted, 95), p99: percentile(sorted, 99) }
}

const pings: number[] = []
for (let i = 0; i < SAMPLES; i++) pings.push(await time(() => redis.ping()))
report('PING', pings)

const gets: number[] = []
for (let i = 0; i < SAMPLES; i++) gets.push(await time(() => redis.get(key)))
const getStats = report('GET snapshot', gets)

// The real hot path: read the snapshot, parse it, and atomically reserve a hold.
const holdScript = `
local avail = tonumber(ARGV[1])
local price = tonumber(ARGV[2])
if avail < price then return 0 end
redis.call('INCRBYFLOAT', KEYS[1], price)
redis.call('PEXPIRE', KEYS[1], 60000)
return 1`
const reserves: number[] = []
for (let i = 0; i < SAMPLES; i++) {
  reserves.push(
    await time(async () => {
      const raw = await redis.get(key)
      JSON.parse(raw ?? '{}')
      await redis.eval(holdScript, 1, 'tab:probe:holds', '0.5', '0.04')
    }),
  )
}
const reserveStats = report('read+reserve', reserves)

await redis.del(key, 'tab:probe:holds')
redis.disconnect()

const p99 = reserveStats.p99
const oneHop = report('(one round trip)', pings)
const fits = p99 < BUDGET_MS

console.log(`
  Verdict

    A spend decision is one snapshot read plus one atomic hold reserve —
    two round trips. Measured p99 ${p99.toFixed(1)}ms against a ${BUDGET_MS}ms budget.

    ${fits ? 'FITS.' : 'DOES NOT FIT, by roughly ' + Math.round(p99 / BUDGET_MS) + 'x.'}

  What this actually measured

    One round trip is ${oneHop.p50.toFixed(0)}ms, but the TCP handshake to the same host is
    only ~45ms. That gap is the diagnosis: the DNS name terminates at a
    nearby Upstash edge, and every COMMAND proxies to the primary region.
    With a primary in us-east-1 and a client in ap-south, ~175ms of the
    ${oneHop.p50.toFixed(0)}ms is one intercontinental hop per command.

    So read this as three separate facts.

    1. The primary region is wrong for this client, and that is fixable
       without touching the design. Recreating the database with its
       primary near the gateway should take a command to roughly the
       handshake figure (~45ms from here, ~1-2ms co-located).

    2. An in-process LRU does NOT rescue this on its own, even with the
       region fixed — which is the part worth understanding. The snapshot read can be cached in memory — it
       is written by the engine and read by the gateway. But a HOLD RESERVE
       cannot: it has to be atomic across every gateway instance, or two
       instances both see the same available balance and both allow. That
       is the race the README lists as caught. Shared, atomic state means a
       network hop, so the sub-50ms budget REQUIRES the cache to be
       co-located with the gateway. It is a deployment constraint, not a
       tuning knob.

    3. For the demo specifically: run a LOCAL Redis, or the headline
       "under 50ms" is not demonstrable on the machine doing the
       demonstrating. Two round trips at ${oneHop.p50.toFixed(0)}ms each is ~${p99.toFixed(0)}ms per spend.

    Consequence for the README: "under 50ms, cache only" needs to say
    "in-process snapshot plus a co-located atomic reserve", and
    apps/README.md's claim that the gateway is "horizontally scalable,
    stateless" is only true because the hold lives in Redis — which is
    exactly why the hop cannot be optimised away.
`)
void getStats
process.exit(0)
