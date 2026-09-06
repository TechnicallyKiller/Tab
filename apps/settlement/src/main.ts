/**
 * The settlement worker.
 *
 *   pnpm settle          one pass over every unsettled window, then exit
 *   pnpm --filter @tab/settlement start    the same, on a loop
 *
 * This is the process that makes the tab a credit rail rather than a ledger of
 * intentions: ten thousand receipts fold into one transfer, interest is charged
 * on what was carried, and the outcome moves the agent's credit ramp.
 *
 * It holds no state of its own. Every number is replayed from the receipt topic
 * and every decision comes from `@tab/ledger`, so this worker can be killed at
 * any point and the next run reaches the same conclusions from the public
 * record. That is deliberate — HCS is the state, and a worker with private
 * memory would be a second source of truth to disagree with it.
 */
import { clientFromEnv, submitMessage } from '@tab/hedera'
import { MirrorClient, configureGlobalHttp, getUsdcBalance } from '@tab/mirror'
import { format, micro, toWire, usdc } from '@tab/money'
import { rampAfter } from '@tab/ledger'
import { describeParams, params, windowOf } from '@tab/params'
import { encode, settlement as settlementMessage } from '@tab/protocol'
import { replayEntries, unsettledWindows } from './entries.ts'
import { describeTick, tick } from './tick.ts'

// Before any HTTP. Node's fetch has a 10s connect timeout no AbortController
// can extend, and Mirror Node routinely needs 5-15s.
configureGlobalHttp({ connectTimeoutMs: 60_000 })

const once = process.argv.includes('--once')
const dryRun = process.argv.includes('--dry-run')

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value || value.includes('xxxxx')) {
    throw new Error(
      `The settlement worker cannot start. Missing from .env: ${name}\n` +
        'Run `pnpm chain:status` to see what is configured.',
    )
  }
  return value
}

const tokenId = requireEnv('USDC_TOKEN_ID')
const receiptTopic = requireEnv('TOPIC_RECEIPTS')
const settlementTopic = requireEnv('TOPIC_SETTLEMENTS')

/*
 * The tab is the AGENT's account, and it must not be the float.
 *
 * When these were the same account the settlement transfer went from the float
 * to itself: Hedera accepted it, consensus executed it, and this worker printed
 * CLEAN with a schedule id having moved nothing between two parties. `tick`
 * now refuses that, and this resolves the id the same way the gateway does so
 * the two cannot disagree about whose tab is being settled.
 */
const tabAccount = requireEnv('TAB_ACCOUNT_ID')

/*
 * Window length comes from params, not the environment.
 *
 * The gateway and this worker MUST bucket receipts identically. If the gateway
 * reads WINDOW_SECONDS=600 and this worker reads 300, the gateway files a
 * receipt into a window this worker will never look at and the tab silently
 * never settles. `@tab/params` is the single source, and DEMO_MODE is the one
 * documented override — it appears in the dump below so it can never be a
 * surprise.
 */
const demoMode = process.env['DEMO_MODE'] === 'true'
const windowSeconds = demoMode
  ? Number(process.env['WINDOW_SECONDS'] ?? params.window.seconds)
  : params.window.seconds

/**
 * Tier is `Unrated` until `@tab/scoring` exists.
 *
 * Stated rather than hidden: an unrated tab pays the C rate, which is the worst
 * one, so this default is conservative in the agent's disfavour and cannot
 * flatter the demo.
 */
const tier = 'Unrated' as const

const hedera = clientFromEnv()
const mirror = new MirrorClient({ network: hedera.network, timeoutMs: 45_000, maxRetries: 4 })
/*
 * `??` is the wrong operator here and printing `float 0.0.xxxxx` proved it: an
 * unfilled placeholder is a non-empty string, so the fallback never fired and
 * the worker announced a float account that does not exist. A placeholder is
 * unset — that is what `requireEnv` already knows and what this must agree with.
 */
function optionalAccount(name: string): string | undefined {
  const value = process.env[name]
  return !value || value.includes('xxxxx') ? undefined : value
}

const floatAccount = optionalAccount('HOT_FLOAT_ACCOUNT_ID') ?? hedera.operatorId.toString()

async function pass(): Promise<number> {
  const nowSeconds = Math.floor(Date.now() / 1000)
  const currentWindow = windowOf(nowSeconds, windowSeconds)

  const replay = await replayEntries(mirror, receiptTopic)
  const entries = replay.byTab.get(tabAccount) ?? []
  const pending = unsettledWindows(entries, currentWindow)

  console.log(
    `\n  window ${currentWindow} open · ${replay.replayed} receipt(s) replayed · ` +
      `${pending.length} window(s) to settle`,
  )

  if (pending.length === 0) {
    // Not a failure. The common case for a healthy rail is nothing to do.
    console.log('  nothing to settle — every closed window already has a settlement receipt\n')
    return 0
  }

  // The float's capacity to pay out, read once per pass. A positive net we
  // cannot cover is MISSED rather than clean; claiming a clean settlement we
  // could not fund would be the worst kind of wrong.
  const floatBalance = await getUsdcBalance(mirror, floatAccount, tokenId)
  console.log(`  float balance   ${format(floatBalance)}`)

  let settled = 0
  for (const window of pending) {
    // Replayed fresh per window: settling window N writes a receipt that
    // changes the ramp window N+1 opens with, so a stale snapshot would settle
    // the whole backlog at the ramp in force before any of it.
    const current = replay.byTab.get(tabAccount) ?? []
    const rampBp = rampAfter(current)

    const config = {
      tab: tabAccount,
      window,
      windowSeconds,
      ceiling: usdc(params.caps.starterCeilingUsdc),
      tokenId,
      floatAccount,
      rampBp,
      tier,
      floatBalance,
    }

    const result = await tick({ hedera, mirror }, current, config, { execute: !dryRun })
    for (const line of describeTick(result, config)) console.log(line)

    if (dryRun) {
      // Nothing moved and nothing is written, so the window stays unsettled and
      // a later real pass will handle it. That is the whole contract of the flag.
      console.log('    receipt        NOT WRITTEN (--dry-run)\n')
      continue
    }

    /*
     * The settlement receipt is what makes the window settled.
     *
     * Written AFTER the transfer, deliberately. If this write fails the money
     * has already moved and the next pass will see the window as unsettled and
     * try again — which the reconciler catches as a duplicate rather than
     * losing it. The reverse order would risk marking a window settled that
     * never paid, and an overstated ledger is far worse than a repeated one.
     */
    const message = settlementMessage.parse({
      v: 1,
      t: 'settlement',
      tab: tabAccount,
      w: window,
      credits: toWire(result.plan.net.credits),
      debits: toWire(result.plan.net.debits),
      interest: toWire(micro(-result.interest)),
      net: toWire(result.plan.net.net),
      n: result.plan.net.receiptCount,
      outcome: result.plan.outcome,
      rampFrom: result.plan.rampFromBp,
      rampTo: result.plan.rampToBp,
      outstanding: toWire(result.plan.outstandingAfter),
      ...(result.transactionId ? { tx: result.transactionId } : {}),
    })
    const written = await submitMessage(hedera.client, settlementTopic, encode(message))
    console.log(`    receipt        seq ${written.sequenceNumber} on ${settlementTopic}\n`)

    // Fold the new settlement into the in-memory replay so the next window in
    // this same pass opens on the ramp this one just set.
    replay.byTab.set(tabAccount, [
      ...current,
      {
        kind: 'settlement',
        at: `${Math.floor(Date.now() / 1000)}.000000000`,
        window,
        net: result.plan.net.net,
        outcome: result.plan.outcome,
        rampFromBp: result.plan.rampFromBp,
        rampToBp: result.plan.rampToBp,
        ...(result.transactionId ? { transactionId: result.transactionId } : {}),
      },
    ])
    settled++
  }
  return settled
}

console.log('\nTab · settlement worker\n')
console.log(`  network         ${hedera.network}`)
console.log(`  float           ${floatAccount}   (pays out a positive net)`)
console.log(`  tab             ${tabAccount}   (the agent — must differ from the float)`)
console.log(`  token           ${tokenId}`)
console.log(`  receipts        ${receiptTopic}`)
console.log(`  settlements     ${settlementTopic}`)
console.log(`  tier            ${tier}  (until @tab/scoring exists — the worst rate, not the best)`)
console.log(`  mode            ${once ? 'single pass' : 'loop'}${dryRun ? ' · DRY RUN' : ''}`)
if (demoMode && windowSeconds !== params.window.seconds) {
  console.log(`  window          ${windowSeconds}s  (DEMO_MODE override of params' ${params.window.seconds}s)`)
}
console.log()
for (const line of describeParams()) console.log(`  ${line}`)

if (once) {
  const settled = await pass()
  console.log(`  settled ${settled} window(s)\n`)
  hedera.close()
  process.exit(0)
}

// The loop. Ticks on the window boundary rather than a fixed interval, so a
// slow pass does not drift the schedule.
let running = true
process.on('SIGINT', () => {
  console.log('\n  stopping after this pass — HCS is the state, so nothing is lost\n')
  running = false
})

while (running) {
  try {
    await pass()
  } catch (error) {
    // A worker that dies on one bad pass stops settling every tab. Log and
    // carry on; the next pass replays from the topic and reaches the same
    // conclusions, so a transient Mirror Node failure costs one window's delay
    // rather than the run.
    console.error(`  pass failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  const nowSeconds = Math.floor(Date.now() / 1000)
  const nextBoundary = (windowOf(nowSeconds, windowSeconds) + 1) * windowSeconds
  const sleepMs = Math.max(5_000, (nextBoundary - nowSeconds) * 1000)
  console.log(`  next pass in ${Math.round(sleepMs / 1000)}s (window boundary)\n`)
  await new Promise((resolve) => setTimeout(resolve, sleepMs))
}

hedera.close()
process.exit(0)
