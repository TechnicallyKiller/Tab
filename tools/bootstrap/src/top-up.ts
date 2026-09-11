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

const payer = process.env['DEMO_PAYER_ACCOUNT_ID']
if (!payer || payer.includes('xxxxx')) {
  throw new Error('DEMO_PAYER_ACCOUNT_ID missing — run `pnpm demo:payer` once to create one')
}

const target = usdc(process.argv[2] ?? '6.000000')
const floor = usdc(process.argv[3] ?? '1.500000')

const operator = clientFromEnv()
const mirror = new MirrorClient({ network: operator.network, timeoutMs: 45_000, maxRetries: 4 })

console.log(`\ntop-up · Hedera ${operator.network}\n`)
console.log(`  operator    ${operator.operatorId.toString()}`)
console.log(`  payer       ${payer}`)

const before = await getUsdcBalance(mirror, payer, tokenId)
const held = await getUsdcBalance(mirror, operator.operatorId.toString(), tokenId)
console.log(`  payer has   ${format(before)}   (floor ${format(floor)}, target ${format(target)})`)
console.log(`  operator    ${format(held)}`)

if (before >= floor) {
  console.log(`\n  Above the floor — nothing moved.\n`)
  process.exit(0)
}

// Arithmetic on a branded bigint drops the brand; `micro` puts it back.
const wanted = micro(target - before)

/*
 * Never transfer more than the operator holds.
 *
 * A transfer of more than the balance fails on-chain after the fee is spent,
 * and on a schedule that is a failure every tick until someone notices. Sending
 * what is there keeps the demo running on a thinning float and makes the
 * shortfall visible in the log instead of as a stack trace.
 */
const amount = micro(wanted > held ? held : wanted)

if (amount <= 0n) {
  console.log(`\n  Operator has nothing to send. The float is exhausted.`)
  console.log(`  Earn payments credit ${operator.operatorId.toString()}, so this recovers on its`)
  console.log(`  own once the earn leg runs — or fund it from a faucet.\n`)
  process.exit(0)
}

if (amount < wanted) {
  console.log(`\n  Only ${format(amount)} available of the ${format(wanted)} wanted.`)
}

await transferToken(operator.client, {
  tokenId,
  from: operator.operatorId.toString(),
  to: payer,
  amount,
  /*
   * Keyed by the hour, so a retry inside the same hour cannot double-send while
   * a genuine top-up an hour later still goes through. The schedule is every 30
   * minutes and the threshold check already suppresses most runs.
   */
  idempotencyKey: `topup:${payer}:${Math.floor(Date.now() / 3_600_000)}`,
})

console.log(`\n  Sent        ${format(amount)} to ${payer}`)
console.log(`  payer now   ${format(micro(before + amount))}\n`)
