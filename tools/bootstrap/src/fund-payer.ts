/**
 * Fund a demo payer with the spend token.
 *
 * The earn leg needs a payer that actually holds the token — a payer with zero
 * balance gets a 402 on its own payment, which reads like a protocol failure
 * and is not one.
 *
 *   pnpm fund:payer [accountId] [amount]
 */
import { clientFromEnv, transferToken } from '@tab/hedera'
import { MirrorClient, canReceiveToken, configureGlobalHttp, getUsdcBalance } from '@tab/mirror'
import { format, usdc } from '@tab/money'

configureGlobalHttp({ connectTimeoutMs: 60_000 })

const tokenId = process.env['USDC_TOKEN_ID']
if (!tokenId) throw new Error('USDC_TOKEN_ID missing from .env')

const target = process.argv[2] ?? process.env['FAUCET_ACCOUNT_ID']
if (!target) throw new Error('pass an account id, or set FAUCET_ACCOUNT_ID')
const amount = usdc(process.argv[3] ?? '5.000000')

const tab = clientFromEnv()
const mirror = new MirrorClient({ network: tab.network, timeoutMs: 45_000, maxRetries: 4 })
const operator = tab.operatorId.toString()

console.log(`\nFunding ${target} with ${format(amount)} of ${tokenId}\n`)

const before = await getUsdcBalance(mirror, target, tokenId)
console.log(`  before          ${format(before)}`)

const recv = await canReceiveToken(mirror, target, tokenId)
console.log(`  can receive     ${recv.canReceive}${recv.reason ? ` — ${recv.reason}` : ''}`)
if (!recv.canReceive) {
  console.error('\n  Cannot fund: the account cannot receive this token.\n')
  tab.close()
  process.exit(1)
}

const moved = await transferToken(tab.client, {
  tokenId, from: operator, to: target, amount,
  idempotencyKey: 'bootstrap:fund-payer',
})
console.log(`  transferred     ${format(amount)} · ${moved.consensusStatus}`)
console.log(`  transaction     ${moved.transactionId}`)

process.stdout.write('  confirming      ')
let after = before
for (let i = 0; i < 12; i++) {
  await new Promise((r) => setTimeout(r, 2500))
  process.stdout.write('.')
  after = await getUsdcBalance(mirror, target, tokenId)
  if (after !== before) break
}
console.log(`\n  after           ${format(after)}\n`)
tab.close()
process.exit(after > before ? 0 : 1)
