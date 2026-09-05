/**
 * Create a dedicated seller account for the x402 probe.
 *
 * Separate from the facilitator fee payer, or the net movement is confusing:
 * one account both receiving payment and paying network fees nets to
 * price-minus-fees, which reads like the price was wrong.
 *
 * HBAR needs no association, so the seller holds no key here — it only receives.
 *
 *   pnpm seller:create
 */
import { clientFromEnv, createAccount } from '@tab/hedera'
import { MirrorClient, waitForAccount } from '@tab/mirror'

const tab = clientFromEnv()
const mirror = new MirrorClient({ network: tab.network, timeoutMs: 30_000, maxRetries: 4 })

const seller = await createAccount(tab.client, { initialHbar: 1, maxAutomaticTokenAssociations: -1 })
process.stdout.write('\n  waiting for index   ')
await waitForAccount(mirror, seller.accountId)
console.log('indexed')

console.log(`
  seller account      ${seller.accountId}
  funded              1 HBAR (only needs to exist and receive)

  Add to .env:

    X402_SELLER_ID=${seller.accountId}

  HashScan: https://hashscan.io/${tab.network}/account/${seller.accountId}
`)
tab.close()
