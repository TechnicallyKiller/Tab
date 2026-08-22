/**
 * Probe 1: get a spendable 6-decimal token into the operator account.
 *
 * Prefers real testnet USDC. Falls back to minting a stand-in, which is the
 * fallback decided in hour one — it costs one line in the pitch and nothing
 * structural, because every claim in the design is about credit mechanics
 * rather than which token moves.
 *
 *   pnpm token:check      report only
 *   pnpm token:mint       mint the stand-in if USDC is absent
 */
import { associateToken, clientFromEnv, mintStandInToken, transferToken } from '@tab/hedera'
import { MirrorClient, canReceiveToken, getToken, getUsdcBalance } from '@tab/mirror'
import { format, usdc } from '@tab/money'

const REAL_USDC = '0.0.429274'
const MINT_SUPPLY = usdc('1000.000000')

const shouldMint = process.argv.includes('--mint')
const tab = clientFromEnv()
const mirror = new MirrorClient({ network: tab.network })
const operator = tab.operatorId.toString()

console.log(`\nSpendable token — Hedera ${tab.network}, operator ${operator}\n`)

// ── real USDC first ──────────────────────────────────────────────────────────
const token = await getToken(mirror, REAL_USDC)
const balance = await getUsdcBalance(mirror, operator, REAL_USDC)
const recv = await canReceiveToken(mirror, operator, REAL_USDC)

console.log(`  ${REAL_USDC}  ${token.symbol} "${token.name}" · ${token.decimals} dp`)
console.log(`  associated          ${recv.associated}`)
console.log(`  can receive         ${recv.canReceive}`)
console.log(`  balance             ${format(balance)} ${token.symbol}`)

if (balance > 0n) {
  console.log('\n  Real testnet USDC present. No fallback needed.')
  console.log(`  Set  USDC_TOKEN_ID=${REAL_USDC}\n`)
  tab.close()
  process.exit(0)
}

console.log('\n  No USDC balance. Get 20 free at https://faucet.circle.com')
console.log(`  (Hedera Testnet, address ${operator}, permissionless, every 2h)`)

if (!shouldMint) {
  console.log('\n  Re-run with --mint to create the stand-in token instead.\n')
  tab.close()
  process.exit(0)
}

// ── fallback: mint a stand-in ────────────────────────────────────────────────
console.log('\n  Minting stand-in token')
const minted = await mintStandInToken(tab.client, {
  treasuryId: operator,
  treasuryKey: tab.operatorKey,
  initialSupply: MINT_SUPPLY,
  symbol: 'TUSD',
  name: 'Tab Test Dollar',
})
console.log(`    token               ${minted.tokenId}`)
console.log(`    supply              ${format(MINT_SUPPLY)} TUSD to ${operator}`)

// The treasury is auto-associated, but proving association works matters:
// a transfer to an unassociated account with no slots fails, and it is not
// obvious why. Probe 3 exists for exactly this.
const assoc = await associateToken(tab.client, {
  accountId: operator,
  tokenId: minted.tokenId,
  signWith: tab.operatorKey,
})
console.log(
  `    association         ${assoc.alreadyAssociated ? 'already associated (treasury)' : 'associated'}`,
)

// Prove it actually moves — a token that cannot transfer is not a fallback.
const self = await transferToken(tab.client, {
  tokenId: minted.tokenId,
  from: operator,
  to: operator,
  amount: usdc('0.010000'),
  idempotencyKey: 'bootstrap:token:selftest',
})
console.log(`    transfer self-test  ${self.consensusStatus} · ${self.transactionId}`)

console.log('\n  Paste into .env:\n')
console.log(`    USDC_TOKEN_ID=${minted.tokenId}`)
console.log(`\n  HashScan: https://hashscan.io/${tab.network}/token/${minted.tokenId}\n`)

tab.close()
