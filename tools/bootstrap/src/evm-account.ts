/**
 * Create an ECDSA account with a real EVM address, for EVM-oriented faucets.
 *
 * Why this exists: Circle's testnet faucet wants a `0x` address. Our operator
 * is ED25519 and has no true EVM address — only a synthetic "long-zero"
 * encoding of its account number, which such forms reject or misroute. Every
 * successful 20 USDC drip visible on testnet landed on an ECDSA account.
 *
 * This is not a step toward the EVM. Tab deploys no contracts and has no EVM
 * tooling in its dependency graph; this account exists only to receive a drip,
 * which we then forward to the operator.
 *
 *   pnpm evm:account
 */
import { clientFromEnv, createEvmAccount } from '@tab/hedera'
import { MirrorClient, waitForAccount } from '@tab/mirror'

const tab = clientFromEnv()
const mirror = new MirrorClient({ network: tab.network, timeoutMs: 30_000, maxRetries: 4 })

console.log(`\nCreating an ECDSA account with an EVM alias — Hedera ${tab.network}\n`)

const account = await createEvmAccount(tab.client, {
  initialHbar: 5,
  maxAutomaticTokenAssociations: -1,
})

process.stdout.write('  waiting for index   ')
await waitForAccount(mirror, account.accountId)
console.log('indexed')

console.log(`
  account id          ${account.accountId}
  EVM address         ${account.evmAddress}
  auto-association    unlimited (-1)   ← a faucet can send any token
  funded              5 HBAR

  NEXT — paste the EVM ADDRESS, not the account id:

    1. https://faucet.circle.com  →  Hedera Testnet
    2. address:  ${account.evmAddress}
    3. pnpm faucet:sweep   (moves the USDC to the operator)

  Save this key in .env — it is printed ONCE and never stored:

    FAUCET_ACCOUNT_ID=${account.accountId}
    FAUCET_ACCOUNT_KEY=${account.privateKey.toStringDer()}

  HashScan: https://hashscan.io/${tab.network}/account/${account.accountId}
`)

tab.close()
