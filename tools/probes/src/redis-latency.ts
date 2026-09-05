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
import { configureGlobalHttp } from '@tab/mirror'

// Node's fetch dies after a 10s CONNECT timeout that no AbortController can
// extend, and Mirror Node needs 5-15s from a high-latency link. Must run before
// any HTTP. See packages/mirror/src/http.ts.
configureGlobalHttp()

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
const remote = oneHop.p50 > 5

console.log(`
  Verdict

    A spend decision is one snapshot read plus one atomic hold reserve —
    two round trips. Measured p99 ${p99.toFixed(1)}ms against a ${BUDGET_MS}ms budget.

    ${fits ? `FITS, with ${(BUDGET_MS / p99).toFixed(0)}x headroom.` : `DOES NOT FIT, by roughly ${Math.round(p99 / BUDGET_MS)}x.`}
`)

if (!remote) {
  console.log(`  This is a co-located cache — ${oneHop.p50.toFixed(1)}ms per round trip. That is the
  shape the budget assumes, and it holds comfortably.
`)
} else {
  console.log(`  This is a REMOTE cache — ${oneHop.p50.toFixed(0)}ms per round trip. Compare that to the
  TCP handshake against the same host: if the handshake is far cheaper than a
  command, the hostname is an edge endpoint and every command is proxying to a
  primary in another region. That is geography, not a design problem.
`)
}

console.log(`  What cannot be optimised away

    An in-process LRU serves the snapshot read — the engine writes it, the
    gateway reads it. But a HOLD RESERVE cannot be cached: it must be atomic
    across every gateway instance, or two instances both see the same
    available balance and both allow. That is the race the README lists as
    caught. Shared atomic state means one network hop, so the budget needs
    the cache CO-LOCATED with the gateway.

    A deployment precondition, not a tuning knob — and satisfiable for free:
    a local Redis for development and the demo, or the gateway deployed in
    the same region as the managed cache.
`)
void getStats
process.exit(fits ? 0 : 1)
