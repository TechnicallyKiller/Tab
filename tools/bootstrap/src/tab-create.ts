/**
 * Create the agent's tab account.
 *
 * The tab is the agent's identity on the rail and the destination for a
 * positive net at settlement. It is NOT the hot float, and it is NOT the
 * agent's customer.
 *
 * This exists because those had been collapsed. The gateway used the operator
 * id as the tab id, so the tab and the hot float were one account: settlement
 * scheduled a transfer from `0.0.8812188` to `0.0.8812188`, consensus executed
 * it, and the worker reported CLEAN having moved nothing between two parties.
 * A demo that shows a perfect settlement moving zero is worse than one that
 * shows nothing. Four accounts are genuinely distinct and each has a reason:
 *
 *   hot float   fronts the money the agent spends, pays out a positive net
 *   tab         the agent — receives, funds nothing, holds no key it needs
 *   payer       the agent's CUSTOMER, buying from its endpoint
 *   fee payer   co-signs x402 transfers, touches none of the value
 *
 * Note what this account is NOT given: nothing. It is created with the minimum
 * HBAR to exist and zero of the token. The product's claim is that the agent
 * holds no float, so funding its tab at bootstrap would quietly undermine the
 * only thing worth demonstrating — every micro-USDC in that account has to
 * arrive as earnings or as a settlement payout.
 *
 *   pnpm tab:create
 */
import { clientFromEnv, createAccount } from '@tab/hedera'
import { MirrorClient, configureGlobalHttp, getUsdcBalance, waitForAccount } from '@tab/mirror'
import { format } from '@tab/money'

configureGlobalHttp({ connectTimeoutMs: 60_000 })

const tokenId = process.env['USDC_TOKEN_ID']
if (!tokenId) throw new Error('USDC_TOKEN_ID missing from .env')

const client = clientFromEnv()
const mirror = new MirrorClient({ network: client.network, timeoutMs: 45_000, maxRetries: 4 })

console.log(`\nCreating the agent's tab account — Hedera ${client.network}\n`)

if (process.env['TAB_ACCOUNT_ID'] === client.operatorId.toString()) {
  console.log('  NOTE: TAB_ACCOUNT_ID currently equals the operator (the hot float).')
  console.log('        That is the misconfiguration this script exists to fix.\n')
}

/*
 * Unlimited auto-association.
 *
 * The tab must be able to receive the settlement token without a prior
 * association step, because the agent is not around to sign one — it holds no
 * key by design. An unassociated tab would make every clean settlement fail
 * with TOKEN_NOT_ASSOCIATED_TO_ACCOUNT at the moment of payout, which is the
 * worst possible time to discover it.
 */
const tab = await createAccount(client.client, {
  initialHbar: 1,
  maxAutomaticTokenAssociations: -1,
})

process.stdout.write('  waiting for index   ')
await waitForAccount(mirror, tab.accountId)
console.log('indexed')

const balance = await getUsdcBalance(mirror, tab.accountId, tokenId)

console.log(`  tab account         ${tab.accountId}`)
console.log(`  token balance       ${format(balance)}  (deliberately zero — the agent holds no float)`)
console.log(`  hot float           ${client.operatorId.toString()}  (must differ from the tab)`)

console.log(`
  Add to .env:

    TAB_ACCOUNT_ID=${tab.accountId}

  The private key is printed nowhere and is not needed. The tab receives; it
  never signs. Anything that wants this account to authorise a transfer has
  misunderstood the product.

  Then restart the gateway so it files receipts under this tab, and run
  \`pnpm settle --dry-run\` to confirm the worker sees them.
`)

client.close()
process.exit(0)
