/**
 * Watch for a faucet drip on either account, then tell you exactly what to run.
 *
 *   pnpm faucet:watch
 *
 * Exists because the faucet has twice reported success and delivered nothing.
 * The only authority on whether a drip landed is the chain.
 */
import { MirrorClient, getUsdcBalance } from '@tab/mirror'
import { format, type MicroUsdc } from '@tab/money'

const REAL_USDC = '0.0.429274'
const OPERATOR = process.env['HEDERA_OPERATOR_ID'] ?? ''
const RELAY = process.env['FAUCET_ACCOUNT_ID'] ?? ''
const INTERVAL_MS = 8000
const ATTEMPTS = 45 // ~6 minutes

const mirror = new MirrorClient({ network: 'testnet', timeoutMs: 25_000, maxRetries: 3 })
const targets = [
  { label: 'operator', id: OPERATOR },
  { label: 'relay   ', id: RELAY },
].filter((t) => t.id && !t.id.includes('xxxxx'))

if (targets.length === 0) {
  console.error('\n  No HEDERA_OPERATOR_ID or FAUCET_ACCOUNT_ID in .env.\n')
  process.exit(1)
}

console.log(`\nWatching for USDC ${REAL_USDC} — Ctrl+C to stop\n`)
for (const t of targets) console.log(`  ${t.label}  ${t.id}`)
console.log()

for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
  const results: { label: string; id: string; balance: MicroUsdc }[] = []
  for (const t of targets) {
    try {
      results.push({ ...t, balance: await getUsdcBalance(mirror, t.id, REAL_USDC) })
    } catch {
      // A slow or lagging mirror is expected; keep watching.
    }
  }
  const line = results.map((r) => `${r.label.trim()} ${format(r.balance)}`).join('  ·  ')
  process.stdout.write(`\r  [${String(attempt).padStart(2)}/${ATTEMPTS}]  ${line}   `)

  const landed = results.find((r) => r.balance > 0n)
  if (landed) {
    console.log('\n')
    console.log(`  ARRIVED — ${format(landed.balance)} USDC on ${landed.id} (${landed.label.trim()})`)
    if (landed.label.trim() === 'relay') {
      console.log('\n  Next:  pnpm faucet:sweep      # forward it to the operator')
      console.log(`         then set USDC_TOKEN_ID=${REAL_USDC} in .env`)
    } else {
      console.log(`\n  Next:  set USDC_TOKEN_ID=${REAL_USDC} in .env`)
      console.log('         then  pnpm chain:status')
    }
    console.log()
    process.exit(0)
  }
  if (attempt < ATTEMPTS) await new Promise((r) => setTimeout(r, INTERVAL_MS))
}

console.log(`

  Nothing after ~${Math.round((ATTEMPTS * INTERVAL_MS) / 60000)} minutes.

  The faucet form rejects a 0x address for Hedera — it wants the account id.
  Paste one of these instead, and watch that the submit actually completes
  (reCAPTCHA can fail silently):

    ${RELAY || '(no relay configured)'}
    ${OPERATOR}

  Both accept any token: unlimited auto-association, nothing to associate first.
`)
process.exit(1)
