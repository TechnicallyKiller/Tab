/**
 * Probe 3, end to end: create a fresh account, associate it, and pay it.
 *
 * This is the spend leg's core mechanic with the gateway removed — if a
 * transfer to a brand-new counterparty does not work here, nothing above it
 * will. A fresh account is the honest test: the operator has unlimited
 * auto-association and would hide the failure mode.
 */
import { associateToken, clientFromEnv, createAccount, transferToken } from '@tab/hedera'
import { canReceiveToken, getUsdcBalance, MirrorClient, waitForAccount } from '@tab/mirror'
import { format, type MicroUsdc, micro, usdc } from '@tab/money'

const TOKEN = process.env['USDC_TOKEN_ID']
if (!TOKEN || TOKEN.includes('xxxxx')) {
  throw new Error('USDC_TOKEN_ID is not set. Run `pnpm token:check` first.')
}

const PAYMENT = usdc('0.040000') // the demo's per-call spend
const tab = clientFromEnv()
const mirror = new MirrorClient({ network: tab.network })
const operator = tab.operatorId.toString()

console.log(`\nProbe 3 — pay a brand-new account · token ${TOKEN}\n`)

// ── a fresh seller, with NO auto-association slots ───────────────────────────
// Zero slots on purpose: this is the failure mode the README warns about, and
// it fails silently if you never look for it.
const created = await createAccount(tab.client, {
  initialHbar: 2,
  maxAutomaticTokenAssociations: 0,
})
const seller = created.accountId
const sellerKey = created.privateKey
console.log(`  seller created      ${seller}  (0 auto-association slots)`)

// Consensus is immediate; Mirror Node indexing is not. Reading straight back
// gives a 404 that means "not indexed yet", not "does not exist".
process.stdout.write('  waiting for index   ')
await waitForAccount(mirror, seller)
console.log('indexed')

// ── it must REFUSE the transfer before association ───────────────────────────
const before = await canReceiveToken(mirror, seller, TOKEN)
console.log(`  can receive?        ${before.canReceive}  ← expected false`)
if (before.canReceive) {
  console.log('    WARNING: expected an unassociated account with 0 slots to be unable to receive')
} else {
  console.log(`    reason            ${before.reason}`)
}

let refused = false
try {
  await transferToken(tab.client, {
    tokenId: TOKEN,
    from: operator,
    to: seller,
    amount: PAYMENT,
    idempotencyKey: 'probe3:before-association',
  })
} catch (err) {
  refused = true
  const msg = err instanceof Error ? err.message : String(err)
  console.log(`  transfer refused    ${msg.split('\n')[0]}`)
}
if (!refused) console.log('  transfer SUCCEEDED before association — auto-association must be on')

// ── associate, then pay ──────────────────────────────────────────────────────
const assoc = await associateToken(tab.client, {
  accountId: seller,
  tokenId: TOKEN,
  signWith: sellerKey,
})
console.log(`  associated          ${assoc.alreadyAssociated ? 'already' : assoc.transactionId}`)

const paid = await transferToken(tab.client, {
  tokenId: TOKEN,
  from: operator,
  to: seller,
  amount: PAYMENT,
  idempotencyKey: 'probe3:seller-payment',
})
console.log(`  paid                ${format(PAYMENT)} · ${paid.consensusStatus}`)
console.log(`  transaction         ${paid.transactionId}`)

// ── confirm from Mirror Node, as a stranger would ────────────────────────────
process.stdout.write('  confirming          ')
let sellerBalance: MicroUsdc = micro(0n)
for (let i = 0; i < 10; i++) {
  await new Promise((r) => setTimeout(r, 2000))
  process.stdout.write('.')
  sellerBalance = await getUsdcBalance(mirror, seller, TOKEN)
  if (sellerBalance > 0n) break
}
console.log()

const operatorBalance = await getUsdcBalance(mirror, operator, TOKEN)
console.log(`  seller balance      ${format(sellerBalance)}`)
console.log(`  operator balance    ${format(operatorBalance)}`)

const ok = sellerBalance === PAYMENT
console.log(`\n  ${ok ? 'PASS' : 'FAIL'} — Probe 3: a fresh counterparty can be paid.`)
console.log(`  HashScan: https://hashscan.io/${tab.network}/account/${seller}\n`)

tab.close()
process.exit(ok ? 0 : 1)
