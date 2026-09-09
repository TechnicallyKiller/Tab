/**
 * Move a faucet drip from the EVM-alias account to the operator.
 *
 *   pnpm faucet:sweep
 *
 * Reads FAUCET_ACCOUNT_ID / FAUCET_ACCOUNT_KEY from .env. Idempotent: with a
 * zero balance it reports and exits rather than sending an empty transfer.
 */
import { clientFromEnv, parsePrivateKey, transferToken } from '@tab/hedera'
import { canReceiveToken, getUsdcBalance, MirrorClient } from '@tab/mirror'
import { format } from '@tab/money'

const REAL_USDC = '0.0.429274'
const faucetId = process.env['FAUCET_ACCOUNT_ID']
const faucetKey = process.env['FAUCET_ACCOUNT_KEY']

if (!faucetId || !faucetKey) {
  console.error(
    '\n  FAUCET_ACCOUNT_ID and FAUCET_ACCOUNT_KEY are not in .env.' +
      '\n  Run `pnpm evm:account` first — it prints both.\n',
  )
  process.exit(1)
}

const tab = clientFromEnv()
const mirror = new MirrorClient({ network: tab.network, timeoutMs: 30_000, maxRetries: 4 })
const operator = tab.operatorId.toString()

console.log(`\nSweeping ${faucetId} → ${operator}\n`)

const balance = await getUsdcBalance(mirror, faucetId, REAL_USDC)
console.log(`  faucet account holds  ${format(balance)} USDC`)

if (balance <= 0n) {
  console.log(`
  Nothing to sweep. If you have already used the faucet, Mirror Node may still
  be indexing — wait ~30s and re-run. Otherwise send the drip to the EVM
  address, not the account id.
`)
  tab.close()
  process.exit(0)
}

const recv = await canReceiveToken(mirror, operator, REAL_USDC)
console.log(`  operator can receive  ${recv.canReceive}`)
if (!recv.canReceive) {
  console.error(`  ${recv.reason}`)
  tab.close()
  process.exit(1)
}

const moved = await transferToken(tab.client, {
  tokenId: REAL_USDC,
  from: faucetId,
  to: operator,
  amount: balance,
  signWith: parsePrivateKey(faucetKey),
  idempotencyKey: 'bootstrap:faucet-sweep',
})
console.log(`  swept                 ${format(balance)} USDC · ${moved.consensusStatus}`)
console.log(`  transaction           ${moved.transactionId}`)

console.log(`
  Now switch to real USDC in .env:

    USDC_TOKEN_ID=${REAL_USDC}

  Then confirm:  pnpm chain:status
`)

tab.close()
