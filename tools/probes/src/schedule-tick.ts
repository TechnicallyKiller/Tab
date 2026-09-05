/**
 * Probe 6 — HIP-423: does the settlement tick execute by consensus, with no
 * keeper?
 *
 * This is the fourth Hedera service and the README claims it explicitly:
 * "Scheduled Transactions execute the settlement tick without a keeper."
 * Untested until now.
 *
 *   pnpm probe:schedule
 */
import { buildSettlementTransfer, clientFromEnv, scheduleSettlement } from '@tab/hedera'
import {
  MirrorClient,
  getSchedule,
  getTransactionAt,
  hbarNetFor,
  waitForScheduleExecution,
} from '@tab/mirror'
import { micro } from '@tab/money'
import { configureGlobalHttp } from '@tab/mirror'

// Node's fetch dies after a 10s CONNECT timeout that no AbortController can
// extend, and Mirror Node needs 5-15s from a high-latency link. Must run before
// any HTTP. See packages/mirror/src/http.ts.
configureGlobalHttp()

const WAIT_SECONDS = Number(process.env['SCHEDULE_WAIT_SECONDS'] ?? 45)

const tab = clientFromEnv()
const mirror = new MirrorClient({ network: tab.network, timeoutMs: 30_000, maxRetries: 4 })
const operator = tab.operatorId.toString()
const seller = process.env['X402_SELLER_ID']
if (!seller) throw new Error('X402_SELLER_ID missing — run `pnpm seller:create`')

const AMOUNT = micro(10_000_000n) // 0.1 HBAR in tinybars
const expiresAt = new Date(Date.now() + WAIT_SECONDS * 1000)

const tinybars = async (id: string) => {
  const a = await mirror.get<{ balance?: { balance?: number } }>(`/api/v1/accounts/${id}?limit=1`)
  return BigInt(a.balance?.balance ?? 0)
}
const hbar = (t: bigint) => `${(Number(t) / 1e8).toFixed(4)} ℏ`

console.log(`\nProbe 6 — HIP-423 settlement tick · Hedera ${tab.network}\n`)
console.log(`  from            ${operator}`)
console.log(`  to              ${seller}`)
console.log(`  net             ${hbar(AMOUNT)}`)
console.log(`  expires at      ${expiresAt.toISOString()}  (+${WAIT_SECONDS}s)\n`)

// The inner transaction is built but never submitted by us — that is the point.
const inner = buildSettlementTransfer({ from: operator, to: seller, amount: AMOUNT })

const scheduled = await scheduleSettlement(tab.client, {
  inner,
  expiresAt,
  memo: 'tab:settlement:window-0148',
  adminKey: tab.operatorKey,
})
console.log(`  [1] scheduled       ${scheduled.scheduleId}`)
console.log(`      waitForExpiry   ${scheduled.waitForExpiry}   <- evaluated AT expiry, not on last signature`)

const before = await tinybars(seller)
console.log(`      seller before   ${hbar(before)}`)

// Read schedule state from MIRROR NODE, not a consensus node. A
// ScheduleInfoQuery returns INVALID_SCHEDULE_ID when it lands on a node the
// create has not propagated to yet; Mirror Node has one consistent view.
process.stdout.write('  [2] indexing        ')
let initial = await getSchedule(mirror, scheduled.scheduleId)
for (let i = 0; i < 10 && !initial; i++) {
  await new Promise((r) => setTimeout(r, 3000))
  process.stdout.write('.')
  initial = await getSchedule(mirror, scheduled.scheduleId)
}
console.log(initial ? 'indexed' : 'NOT INDEXED')
if (!initial) {
  console.error('\n  FAIL — schedule never appeared on Mirror Node.\n')
  tab.close()
  process.exit(1)
}
console.log(`      wait_for_expiry ${initial.wait_for_expiry}`)
console.log(`      memo            ${initial.memo}`)
// Only a fire BEFORE expiry would disprove waitForExpiry. Mirror Node indexing
// can easily take longer than a short expiry, so "already executed" here is
// usually just slow indexing — saying otherwise would be a false alarm.
const firedEarly =
  initial.executed_timestamp !== null &&
  Number(initial.executed_timestamp.split('.')[0]) < Math.floor(expiresAt.getTime() / 1000)
console.log(
  `      executed yet?   ${
    firedEarly
      ? 'BEFORE EXPIRY — waitForExpiry is NOT working'
      : initial.executed_timestamp
        ? 'yes, but at/after expiry (indexing was slower than the window)'
        : 'no (correct)'
  }`,
)

console.log(`\n  [3] waiting for consensus to fire it — we submit NOTHING from here`)
const fired = await waitForScheduleExecution(mirror, scheduled.scheduleId, {
  timeoutMs: (WAIT_SECONDS + 120) * 1000,
})
const executedSeconds = Number(fired.executed_timestamp!.split('.')[0])
const expirySeconds = Number((fired.expiration_time ?? '0').split('.')[0])
console.log(`  [4] executed        ${new Date(executedSeconds * 1000).toISOString()}`)
console.log(`      expiry          ${new Date(expirySeconds * 1000).toISOString()}`)
console.log(`      delta           ${executedSeconds - expirySeconds}s from expiry`)

// Assert on the TRANSACTION, not on balances. Mirror Node account balances are
// snapshots — a read moments after a transfer can still return the old figure —
// and a schedule can fire while its inner transaction fails, so "executed" and
// "value moved" are separate claims. The transfer list settles the second one.
console.log('  [5] verifying the inner transaction')
const inner_tx = await getTransactionAt(mirror, fired.executed_timestamp!)
if (!inner_tx) {
  console.error('\n  FAIL — no transaction at the executed timestamp.\n')
  tab.close()
  process.exit(1)
}
const sellerNet = hbarNetFor(inner_tx, seller)
const payerNet = hbarNetFor(inner_tx, operator)
console.log(`      name            ${inner_tx.name}`)
console.log(`      result          ${inner_tx.result}`)
console.log(`      scheduled flag  ${(inner_tx as { scheduled?: boolean }).scheduled}`)
console.log(`      seller net      ${hbar(sellerNet)}`)
console.log(`      payer net       ${hbar(payerNet)}   (net + network fee)`)

const moved = inner_tx.result === 'SUCCESS' && sellerNet === AMOUNT
void before
void tinybars
console.log(`
  ${moved ? 'PASS' : 'FAIL'} — the tick ${moved ? 'executed by consensus, with no keeper' : 'did not settle as expected'}.
  We created the schedule and then submitted nothing. Consensus ran the
  transfer at expiry. That is the settlement tick with no bot to run or fund.

  HashScan: https://hashscan.io/${tab.network}/transaction/${scheduled.transactionId}
`)
tab.close()
process.exit(moved ? 0 : 1)
