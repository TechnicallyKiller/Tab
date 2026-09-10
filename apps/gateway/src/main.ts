/**
 * Gateway entry point.
 *
 *   pnpm dev:gateway
 */
import { PrivateKey } from '@hiero-ledger/sdk'
import { clientFromEnv } from '@tab/hedera'
import { configureGlobalHttp, MirrorClient } from '@tab/mirror'
import { format } from '@tab/money'
import { windowOf } from '@tab/params'
import {
  blocky402FeePayer,
  createBlocky402Facilitator,
  createFacilitator,
  createSpendClient,
  NETWORKS,
  tokenAsset,
} from '@tab/x402'
import { describeCeiling, replayCeilings } from './ceilings.ts'
import { loadEnv } from './env.ts'
import { ReceiptWriter } from './receipts.ts'
import { buildServer } from './server.ts'
import { replaySettlements, type SettlementEntry } from './settlements.ts'
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
console.log(
  `  ceiling         ${format(env.starterCeiling)} · per-call cap ${format(env.perCallCap)}`,
)

// HCS is the source of truth. The in-memory projection is rebuilt from it, so a
// restart lands on the same position rather than an empty ledger.
process.stdout.write('  replaying HCS   ')
const state = new LedgerState(env.starterCeiling)
const rebuilt = await state.rebuild(mirror, env.receiptTopic)
console.log(`${rebuilt.replayed} entries · ${rebuilt.skipped} skipped · ${rebuilt.tabs} tab(s)`)
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
/**
 * Latest published weights, kept for the console to read.
 *
 * The gateway does not USE these — the graph runs in the engine and the fast
 * path never consults it. It serves them because `apps/web` may only talk to
 * the gateway, and the alternative was a console that showed a collapsed
 * ceiling with no visible reason. Held in memory and refreshed on the same poll
 * as the ceiling, so the two cannot disagree on screen.
 */
let latestWeights = new Map<
  string,
  Awaited<ReturnType<typeof replayCeilings>>['weights'] extends Map<string, infer W> ? W : never
>()

/**
 * The published ceiling SERIES, kept for the console.
 *
 * Separate from `state.setCeiling`, which holds the one value the fast path
 * enforces. Deliberately two things: the fast path must have exactly one
 * ceiling to check, and the console must be able to show that a zero was
 * preceded by a 0.2500 and caused by a graph change. Collapsing them would
 * either give the spend path a series to choose from or give the console a
 * number with no story.
 */
let latestCeilings = new Map<
  string,
  Awaited<ReturnType<typeof replayCeilings>>['history'] extends Map<string, infer C> ? C : never
>()

/**
 * Published account provenance, kept for the Counterparties evidence panel.
 *
 * The gateway does not USE these — the graph runs in the engine and the fast
 * path enforces only the published ceiling. It serves them because `apps/web`
 * may talk to nothing but the gateway, and without them the strongest claim in
 * the demo (`COMMON_FUNDER`: one operator on both sides) rendered with `—`
 * where its two supporting values should be.
 */
let latestFacts = new Map<
  string,
  Awaited<ReturnType<typeof replayCeilings>>['facts'] extends Map<string, infer F> ? F : never
>()

/** Starter Tab claims, kept for the console. Never consulted by the spend path. */
let latestRegistrations = new Map<
  string,
  Awaited<ReturnType<typeof replayCeilings>>['registrations'] extends Map<string, infer R>
    ? R
    : never
>()
let latestRootsClaimed = 0

export function weightsSnapshot() {
  return latestWeights
}

export function ceilingsSnapshot() {
  return latestCeilings
}

export function factsSnapshot() {
  return latestFacts
}

export function registrationsSnapshot() {
  return latestRegistrations
}

export function rootsClaimedSnapshot(): number {
  return latestRootsClaimed
}

async function syncCeilings(label: string): Promise<void> {
  const replay = await replayCeilings(mirror, env.ceilingTopic)
  latestWeights = replay.weights
  latestCeilings = replay.history
  latestFacts = replay.facts
  latestRegistrations = replay.registrations
  latestRootsClaimed = replay.rootsClaimed
  for (const [t, snapshot] of replay.byTab) {
    const before = state.ceilingFor(t)
    if (before === snapshot.ceiling) continue
    state.setCeiling(t, snapshot.ceiling)
    console.log(`  ceiling ${label}   ${t}  ${format(before)} → ${describeCeiling(snapshot)}`)
  }
  if (replay.read === 0) {
    console.log(`  ceiling ${label}   none published yet — holding the starter ceiling`)
    return
  }
  if (label === 'boot ') {
    /*
     * Always print SOMETHING on boot.
     *
     * The loop above only logs a tab whose ceiling CHANGED, so a restart that
     * resumed the exact ceiling it already had printed nothing after the
     * `ceilings` progress prefix — and the next line ran on directly, giving
     * `ceilings          settlements       settlements boot  5 window(s)`. A
     * boot line that renders as garbage is a boot line nobody reads.
     */
    console.log(
      `${replay.byTab.size} tab(s) · ${replay.read} message(s) · ` +
        `${replay.facts.size} account(s) of published provenance · ` +
        `${replay.rootsClaimed} funding root(s) claimed by ${replay.registrations.size} tab(s)`,
    )
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

/*
 * Settled windows, for the console.
 *
 * Its own timer, at a much slower cadence, because a settlement happens once
 * per 600s window while a ceiling can collapse mid-window and must be picked
 * up in seconds. Sharing the ceiling's 15s poll would read the settlements
 * topic forty times per window to see one new message.
 *
 * Read-only, and never consulted by the spend path. The gateway makes no claim
 * about whether a window settled — that claim belongs to the worker, which
 * reads both topics to make it. This is the console's window onto it.
 */
let latestSettlements = new Map<string, SettlementEntry[]>()

export function settlementsSnapshot(): ReadonlyMap<string, SettlementEntry[]> {
  return latestSettlements
}

async function syncSettlements(label: string): Promise<void> {
  const replay = await replaySettlements(mirror, env.settlementTopic)
  latestSettlements = replay.byTab
  const total = [...replay.byTab.values()].reduce((n, list) => n + list.length, 0)
  if (label === 'boot ') {
    console.log(`${total} settlement(s) across ${replay.byTab.size} tab(s)`)
  }
}

process.stdout.write('  settlements     ')
try {
  await syncSettlements('boot ')
} catch (error) {
  // Same reasoning as the ceiling: this is a read surface for the console, so
  // an unreadable topic degrades one view rather than stopping the rail.
  console.log(
    `unavailable (${error instanceof Error ? error.message : String(error)}) — the settlements view will be empty`,
  )
}

const SETTLEMENT_POLL_MS = Number(process.env['SETTLEMENT_POLL_MS'] ?? 120_000)
const settlementPoll = setInterval(() => {
  void syncSettlements('update').catch(() => {
    // Silent, for the same reason the ceiling poll is.
  })
}, SETTLEMENT_POLL_MS)
settlementPoll.unref()

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

/*
 * Which facilitator settles the EARN leg.
 *
 * `X402_FACILITATOR` picks: `blocky402` for the hosted one, anything else (or
 * unset) keeps the self-hosted default from ADR-0004.
 *
 * Both satisfy `TabFacilitator`, which is only verify/settle/getSupported — so
 * the resource server cannot tell which it was handed, and this is a config
 * choice rather than a code path. The trade is real either way: self-hosting
 * removes a liveness dependency and keeps settlement in the same process that
 * writes the attested receipt; Blocky402 removes a funded fee-payer account we
 * have to keep topped up, and settles with THEIR account instead.
 */
const useBlocky402 = (process.env['X402_FACILITATOR'] ?? '').toLowerCase() === 'blocky402'

const earnFacilitator = useBlocky402
  ? createBlocky402Facilitator(NETWORKS.testnet, {
      ...(process.env['X402_FACILITATOR_URL']
        ? { baseUrl: process.env['X402_FACILITATOR_URL'] }
        : {}),
      ...(process.env['X402_FACILITATOR_API_KEY']
        ? { apiKey: process.env['X402_FACILITATOR_API_KEY'] }
        : {}),
      /*
       * Their fee payer, READ from /supported rather than configured.
       *
       * It is their operational detail and can change; a value copied into our
       * env would be right until the day it silently was not, and the failure
       * would surface as an unexplained settlement error. Resolved once at
       * boot, and a failure here is not fatal — the id is only reported, never
       * used to sign.
       */
      ...(agentUpstream
        ? {
            feePayerId:
              (await blocky402FeePayer(NETWORKS.testnet, {
                ...(process.env['X402_FACILITATOR_URL']
                  ? { baseUrl: process.env['X402_FACILITATOR_URL'] }
                  : {}),
              }).catch(() => undefined)) ?? 'blocky402:unresolved',
          }
        : {}),
    })
  : createFacilitator({
      network: NETWORKS.testnet,
      feePayerId: env.feePayerId,
      feePayerKey: PrivateKey.fromStringDer(env.feePayerKey.replace(/^0x/, '')),
    })

const app = buildServer(
  {
    env,
    state,
    client,
    receipts: new ReceiptWriter(tab, env.receiptTopic),
    window: currentWindow,
    // Read-only, for the console. The spend path never consults any of these.
    weights: weightsSnapshot,
    ceilings: ceilingsSnapshot,
    settlements: settlementsSnapshot,
    facts: factsSnapshot,
    registrations: registrationsSnapshot,
    rootsClaimed: rootsClaimedSnapshot,
  },
  agentUpstream
    ? {
        network: NETWORKS.testnet,
        asset,
        facilitator: earnFacilitator,
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
console.log(
  `  facilitator     ${useBlocky402 ? `Blocky402 (hosted) · fee payer ${earnFacilitator.feePayerId}` : `self-hosted · fee payer ${earnFacilitator.feePayerId}`}`,
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
