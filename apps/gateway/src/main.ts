/**
 * Gateway entry point.
 *
 *   pnpm dev:gateway
 */
import { PrivateKey } from '@hiero-ledger/sdk'
import { clientFromEnv } from '@tab/hedera'
import { MirrorClient, configureGlobalHttp } from '@tab/mirror'
import { format } from '@tab/money'
import { NETWORKS, createFacilitator, createSpendClient, tokenAsset } from '@tab/x402'
import { loadEnv } from './env.ts'
import { ReceiptWriter } from './receipts.ts'
import { buildServer } from './server.ts'
import { windowOf } from '@tab/params'
import { describeCeiling, replayCeilings } from './ceilings.ts'
import { LedgerState } from './state.ts'

// Node's fetch dies after a 10s CONNECT timeout that no AbortController can
// extend, and Mirror Node needs 5-15s from a high-latency link. Must run before
// any HTTP. See packages/mirror/src/http.ts.
// The spend leg waits on the SELLER, whose facilitator runs a Mirror Node
// preflight plus signature verification — measured at ~40s for an HTS token
// from a high-latency link. Header and body timeouts must clear that with room,
// or the gateway gives up on a payment that was about to succeed.
configureGlobalHttp({
  connectTimeoutMs: 60_000,
  headersTimeoutMs: 120_000,
  bodyTimeoutMs: 120_000,
})

const env = loadEnv()
const tab = clientFromEnv()
const mirror = new MirrorClient({ network: env.network, timeoutMs: 45_000, maxRetries: 4 })

console.log(`\nTab gateway · Hedera ${env.network}\n`)
console.log(`  operator        ${env.operatorId}   (hot float)`)
console.log(`  token           ${env.tokenId}`)
console.log(`  receipt topic   ${env.receiptTopic}`)
console.log(`  ceiling         ${format(env.starterCeiling)} · per-call cap ${format(env.perCallCap)}`)

// HCS is the source of truth. The in-memory projection is rebuilt from it, so a
// restart lands on the same position rather than an empty ledger.
process.stdout.write('  replaying HCS   ')
const state = new LedgerState(env.starterCeiling)
const rebuilt = await state.rebuild(mirror, env.receiptTopic)
console.log(
  `${rebuilt.replayed} entries · ${rebuilt.skipped} skipped · ${rebuilt.tabs} tab(s)`,
)
for (const t of state.tabs()) {
  console.log(`    ${t}  ${state.describe(t, `${Math.floor(Date.now() / 1000)}.000000000`)}`)
}

/*
 * Published ceilings, from the engine, over HCS.
 *
 * Nothing private passes between the engine and the gateway: the ceiling in
 * force is read from exactly the public record a stranger would read. That is
 * what makes the attack demo mean anything — the loop attacker gets caught
 * because the graph found a funding edge and the engine published a collapsed
 * ceiling, not because we told the gateway to refuse it.
 */
async function syncCeilings(label: string): Promise<void> {
  const replay = await replayCeilings(mirror, env.ceilingTopic)
  for (const [t, snapshot] of replay.byTab) {
    const before = state.ceilingFor(t)
    if (before === snapshot.ceiling) continue
    state.setCeiling(t, snapshot.ceiling)
    console.log(`  ceiling ${label}   ${t}  ${format(before)} → ${describeCeiling(snapshot)}`)
  }
  if (replay.read === 0) {
    console.log(`  ceiling ${label}   none published yet — holding the starter ceiling`)
  }
}

process.stdout.write('  ceilings        ')
try {
  await syncCeilings('boot ')
} catch (error) {
  /*
   * A ceiling that cannot be read is NOT a reason to refuse to start.
   *
   * The starter ceiling is already conservative, and the fast path has
   * something safe to enforce either way. Refusing to boot on Mirror Node lag
   * would make routine indexer delay an outage.
   */
  console.log(
    `unavailable (${error instanceof Error ? error.message : String(error)}) — holding the starter ceiling`,
  )
}

/*
 * Poll for a MID-WINDOW collapse.
 *
 * The demo's central moment depends on this: the engine detects the control
 * edge and publishes a zero ceiling, and the very next spend must be refused —
 * not the next spend after the window turns over. A shrink is a safety action
 * and applies immediately, so the fast path has to hear about it promptly.
 *
 * Polling rather than subscribing because Mirror Node's REST topic endpoint is
 * what we already depend on everywhere else; a second transport for one reader
 * is a second thing to be wrong on stage.
 */
const CEILING_POLL_MS = Number(process.env['CEILING_POLL_MS'] ?? 15_000)
const ceilingPoll = setInterval(() => {
  void syncCeilings('update').catch(() => {
    // Silent by design. A failed poll leaves the last known ceiling in force,
    // and logging every transient Mirror Node hiccup would bury the one line
    // that matters when the collapse actually lands.
  })
}, CEILING_POLL_MS)
ceilingPoll.unref()

const client = createSpendClient({
  network: NETWORKS.testnet,
  payerId: env.operatorId,
  payerKey: PrivateKey.fromStringDer(env.operatorKey.replace(/^0x/, '')),
  asset: tokenAsset(env.tokenId, 'TUSD'),
  maxAtomicPerPayment: env.perCallCap,
})

/*
 * Window bucketing comes from `@tab/params`, not from a local expression.
 *
 * The gateway and the settlement worker must agree on which window a receipt
 * belongs to. Two copies of `Math.floor(now / windowSeconds)` — which is what
 * this was — agree right up until one is handed milliseconds or reads a
 * different WINDOW_SECONDS, and then the gateway files receipts into a window
 * the worker never settles and the tab silently never settles at all.
 */
const currentWindow = () => windowOf(Math.floor(Date.now() / 1000), env.windowSeconds)

// The earn leg needs its own facilitator — we self-facilitate inbound, which
// is what lets the credit receipt be written in the same code path that
// settled the payment. ADR-0004.
const asset = tokenAsset(env.tokenId, 'TUSD')
const agentUpstream = process.env['AGENT_ENDPOINT_URL']

const app = buildServer(
  {
    env,
    state,
    client,
    receipts: new ReceiptWriter(tab, env.receiptTopic),
    window: currentWindow,
  },
  agentUpstream
    ? {
        network: NETWORKS.testnet,
        asset,
        facilitator: createFacilitator({
          network: NETWORKS.testnet,
          feePayerId: env.feePayerId,
          feePayerKey: PrivateKey.fromStringDer(env.feePayerKey.replace(/^0x/, '')),
        }),
        endpoint: {
          tab: env.tabAccountId,
          upstream: agentUpstream,
          atomicPrice: env.perCallCap,
          description: 'The agent’s own paid endpoint',
        },
      }
    : undefined,
)

await app.listen({ port: env.port, host: '0.0.0.0' })
console.log(
  `  earn leg        ${agentUpstream ? `fronting ${agentUpstream} at /v1/earn` : 'off (set AGENT_ENDPOINT_URL)'}`,
)
console.log(`\n  listening       http://localhost:${env.port}`)
console.log(`  window          ${currentWindow()} (${env.windowSeconds}s buckets)\n`)

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await app.close()
    tab.close()
    process.exit(0)
  })
}
