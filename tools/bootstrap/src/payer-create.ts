/**
 * Create an independent payer for the earn leg.
 *
 * x402's exact scheme rejects a transaction where the facilitator's fee payer
 * is also moving funds — `invalid_exact_hedera_payload_fee_payer_transferring_funds`.
 * The fee payer co-signs and pays gas; it must not be a party to the transfer.
 *
 * So a working x402 payment needs THREE distinct accounts:
 *
 *   payer      debits itself, signs the partial transaction
 *   payTo      receives
 *   fee payer  co-signs and submits, touches none of the value
 *
 * Independence matters beyond the protocol here: revenue from a payer Tab
 * controls is exactly what @tab/graph exists to discount, so a demo payer that
 * shares an account with our own infrastructure would be self-dealing.
 *
 *   pnpm payer:create
 */
import { clientFromEnv, createAccount, transferToken } from '@tab/hedera'
import { MirrorClient, configureGlobalHttp, getUsdcBalance, waitForAccount } from '@tab/mirror'
import { format, usdc } from '@tab/money'

configureGlobalHttp({ connectTimeoutMs: 60_000 })

const tokenId = process.env['USDC_TOKEN_ID']
if (!tokenId) throw new Error('USDC_TOKEN_ID missing from .env')
const funding = usdc(process.argv[2] ?? '2.000000')

const tab = clientFromEnv()
const mirror = new MirrorClient({ network: tab.network, timeoutMs: 45_000, maxRetries: 4 })

console.log(`\nCreating an independent payer — Hedera ${tab.network}\n`)

// Unlimited auto-association so it can receive the token with no extra step.
const payer = await createAccount(tab.client, { initialHbar: 2, maxAutomaticTokenAssociations: -1 })
process.stdout.write('  waiting for index   ')
await waitForAccount(mirror, payer.accountId)
console.log('indexed')
console.log(`  payer               ${payer.accountId}`)

const moved = await transferToken(tab.client, {
  tokenId, from: tab.operatorId.toString(), to: payer.accountId,
  amount: funding, idempotencyKey: 'bootstrap:payer-create',
})
console.log(`  funded              ${format(funding)} · ${moved.consensusStatus}`)

process.stdout.write('  confirming          ')
let balance = 0n as ReturnType<typeof usdc>
for (let i = 0; i < 12; i++) {
  await new Promise((r) => setTimeout(r, 2500))
  process.stdout.write('.')
  balance = await getUsdcBalance(mirror, payer.accountId, tokenId)
  if (balance > 0n) break
}
console.log(`\n  balance             ${format(balance)}`)

console.log(`
  Add to .env:

    PAYER_ACCOUNT_ID=${payer.accountId}
    PAYER_ACCOUNT_KEY=${payer.privateKey.toStringDer()}

  HashScan: https://hashscan.io/${tab.network}/account/${payer.accountId}
`)
tab.close()
