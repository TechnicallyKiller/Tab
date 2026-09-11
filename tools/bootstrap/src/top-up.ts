/**
 * Top up the demo payer from the operator, but only when it is actually low.
 *
 *   pnpm topup            top up to 6.000000 if below 1.500000
 *   pnpm topup 10 3       top up to 10.000000 if below 3.000000
 *
 * ## Why this exists rather than reusing `demo:payer`
 *
 * `demo:payer` CREATES an intermediary and a payer account every time it runs.
 * That is right for setting the demo up and wrong for keeping it alive: on a
 * schedule it would mint a fresh account every half hour and rotate
 * DEMO_PAYER_ACCOUNT_ID out from under the workflow that depends on it.
 *
 * ## Why topping up is not the same as spending money
 *
 * The earn leg pays TO the operator — that is the account `/v1/earn` names in
 * its 402. So operator → payer → earn → operator is a loop, and this moves the
 * same tokens back to the start of it rather than consuming anything. Fees
 * aside, the demo's revenue is self-funding.
 *
 * That matters because the token cannot be minted: testnet USDC (0.0.429274) is
 * treasuried at 0.0.5176, which is not ours. The float is fixed at what we hold,
 * so recycling is the only way the demo survives more than a few hours.
 *
 * ## Why a threshold rather than a fixed transfer
 *
 * Run on a schedule, an unconditional transfer would move tokens on every tick
 * and pay a fee each time for no reason. Below the threshold it tops up to the
 * target; above it, it does nothing and says so.
 */

import { clientFromEnv, transferToken } from '@tab/hedera'
import { configureGlobalHttp, getUsdcBalance, MirrorClient } from '@tab/mirror'
import { format, micro, usdc } from '@tab/money'

configureGlobalHttp({ connectTimeoutMs: 60_000 })

const tokenId = process.env['USDC_TOKEN_ID']
if (!tokenId) throw new Error('USDC_TOKEN_ID missing')

/*
 * Every demo customer, not just the first.
 *
 * Revenue has to be SPREAD across them — a counterparty holding more than the
 * 40% share cap is CONCENTRATED and has its weight multiplied by 0.80 — so a
 * pool where one member is empty defeats the point of having a pool. They are
 * all topped up, or the concentration the discount punishes is exactly what
 * the funding produces.
 */
const payers = ['', '2', '3', '4', '5']
  .map((n) => ({ name: `DEMO_PAYER${n}_ACCOUNT_ID`, id: process.env[`DEMO_PAYER${n}_ACCOUNT_ID`] }))
  .filter((p): p is { name: string; id: string } => !!p.id && !p.id.includes('xxxxx'))

if (payers.length === 0) {
  throw new Error('No DEMO_PAYER*_ACCOUNT_ID set — run `pnpm demo:payer` to create one')
}

const target = usdc(process.argv[2] ?? '6.000000')
const floor = usdc(process.argv[3] ?? '1.500000')

const operator = clientFromEnv()
const mirror = new MirrorClient({ network: operator.network, timeoutMs: 45_000, maxRetries: 4 })

console.log(`\ntop-up · Hedera ${operator.network}\n`)
console.log(`  operator    ${operator.operatorId.toString()}`)
console.log(`  payers      ${payers.length}   (floor ${format(floor)}, target ${format(target)})\n`)

for (const p of payers) {
  const before = await getUsdcBalance(mirror, p.id, tokenId)
  const held = await getUsdcBalance(mirror, operator.operatorId.toString(), tokenId)

  if (before >= floor) {
    console.log(`  ${p.id.padEnd(16)} ${format(before)}   above the floor, nothing moved`)
    continue
  }

  // Arithmetic on a branded bigint drops the brand; `micro` puts it back.
  const wanted = micro(target - before)

  /*
   * Never transfer more than the operator holds.
   *
   * Asking for more than the balance fails on chain AFTER the fee is spent,
   * and on a schedule that is a failure every tick until somebody looks.
   * Sending what is there keeps the demo running on a thinning float and puts
   * the shortfall in the log instead of a stack trace.
   */
  const amount = micro(wanted > held ? held : wanted)

  if (amount <= 0n) {
    console.log(`  ${p.id.padEnd(16)} ${format(before)}   operator is empty — float exhausted`)
    continue
  }

  await transferToken(operator.client, {
    tokenId,
    from: operator.operatorId.toString(),
    to: p.id,
    amount,
    /*
     * Keyed by the hour, so a retry within the hour cannot double-send while a
     * genuine top-up an hour later still goes through.
     */
    idempotencyKey: `topup:${p.id}:${Math.floor(Date.now() / 3_600_000)}`,
  })

  const short = amount < wanted ? `  (wanted ${format(wanted)})` : ''
  console.log(`  ${p.id.padEnd(16)} ${format(before)} -> ${format(micro(before + amount))}${short}`)
}

console.log()

/*
 * Close the client, or this never exits.
 *
 * The SDK holds open gRPC channels to every node it has talked to, which keep
 * the event loop alive after the last await resolves. Run by hand that looks
 * like a hang; run in CI it is a step that sits there until the job timeout
 * kills it — thirty-five minutes of a runner doing nothing, after the work had
 * already succeeded.
 */
operator.client.close()
