/**
 * Probe 7 — the same loop, but through @tab/x402 instead of raw @x402/*.
 *
 * The spike in x402-loop.ts proved the protocol works. This proves the ADAPTER
 * works, which is what the gateway will actually import. Extracting a package
 * that compiles but was never run is how you discover a broken seam inside the
 * gateway instead of here.
 *
 *   pnpm probe:adapter          native HBAR
 *   pnpm probe:adapter --hts    the dollar token
 */
import express from 'express'
import { paymentMiddleware } from '@x402/express'
import { PrivateKey } from '@hiero-ledger/sdk'
import {
  NETWORKS,
  createEarnServer,
  createFacilitator,
  createSpendClient,
  formatAtomic,
  hbarAsset,
  tokenAsset,
} from '@tab/x402'
import { MirrorClient, getTransactionAt, hbarNetFor } from '@tab/mirror'
import { configureGlobalHttp } from '@tab/mirror'

// Node's fetch dies after a 10s CONNECT timeout that no AbortController can
// extend, and Mirror Node needs 5-15s from a high-latency link. Must run before
// any HTTP. See packages/mirror/src/http.ts.
// The HTS path makes more Mirror Node calls than HBAR — the facilitator's
// preflight checks payer balance AND payTo association, and each token query
// runs 5-15s from here. Give it room.
configureGlobalHttp({ connectTimeoutMs: 90_000, headersTimeoutMs: 90_000, bodyTimeoutMs: 90_000 })

const USE_HTS = process.argv.includes('--hts')
const PORT = 4022
const NETWORK = NETWORKS.testnet

const env = (k: string) => {
  const v = process.env[k]
  if (!v || v.includes('xxxxx')) throw new Error(`${k} missing from .env`)
  return v
}
const key = (k: string) => PrivateKey.fromStringDer(env(k).replace(/^0x/, ''))

const asset = USE_HTS ? tokenAsset(env('USDC_TOKEN_ID'), 'TUSD') : hbarAsset()
const price = USE_HTS ? 40_000n : 50_000_000n // 0.04 token / 0.5 HBAR

const mirror = new MirrorClient({ network: 'testnet', timeoutMs: 30_000, maxRetries: 4 })

console.log(`\nProbe 7 — @tab/x402 adapter · ${asset.symbol}\n`)
console.log(`  asset      ${asset.id} · ${asset.decimals}dp · price ${formatAtomic(asset, price)}`)

// ── earn leg: our facilitator + our resource server ──────────────────────────
const facilitator = createFacilitator({
  network: NETWORK,
  feePayerId: env('FAUCET_ACCOUNT_ID'),
  feePayerKey: key('FAUCET_ACCOUNT_KEY'),
})
console.log(`  facilitator fee payer  ${facilitator.feePayerId}`)

const earn = createEarnServer({
  network: NETWORK,
  facilitator,
  routes: [
    {
      route: 'GET /invoke',
      payTo: env('X402_SELLER_ID'),
      asset,
      atomicPrice: price,
      description: 'The agent’s own paid endpoint',
    },
  ],
})

const app = express()
app.use(paymentMiddleware(earn.routes as never, earn.server as never))
app.get('/invoke', (_req, res) => res.json({ result: 'served', at: new Date().toISOString() }))
const server = app.listen(PORT)
await new Promise((r) => server.once('listening', r))
console.log(`  earn server            :${PORT}`)

// ── spend leg: the hot float pays ────────────────────────────────────────────
const spend = createSpendClient({
  network: NETWORK,
  payerId: env('HEDERA_OPERATOR_ID'),
  payerKey: key('HEDERA_OPERATOR_KEY'),
  asset,
  maxAtomicPerPayment: price * 4n,
})
console.log(`  spend client           ${spend.describe()}\n`)

try {
  const unpaid = await fetch(`http://localhost:${PORT}/invoke`)
  console.log(`  unpaid                 HTTP ${unpaid.status} ${unpaid.status === 402 ? '(challenge)' : 'UNEXPECTED'}`)
  // The challenge must carry extra.feePayer. Without it the client builds a
  // transaction with the wrong fee payer and verify rejects the signature.
  const challengeHeader = unpaid.headers.get('payment-required')
  if (challengeHeader) {
    const decoded = JSON.parse(Buffer.from(challengeHeader, 'base64').toString('utf8'))
    console.log(`  challenge accepts[0]   ${JSON.stringify(decoded.accepts?.[0])}`)
  }

  // Surface WHY a 402 came back on the paid attempt — an empty body tells you
  // nothing, and the header carries the failure reason.
  const raw = await spend.fetch(`http://localhost:${PORT}/invoke`, { method: 'GET' })
  if (raw.status !== 200) {
    console.log(`  paid attempt           HTTP ${raw.status}`)
    const text = await raw.clone().text()
    console.log(`  body                   ${text.slice(0, 400)}`)
    for (const h of ['payment-required', 'payment-response', 'x-payment-response']) {
      const v = raw.headers.get(h)
      if (v) {
        console.log(`  ${h.padEnd(22)} ${v.slice(0, 200)}`)
        try {
          console.log(`    decoded              ${Buffer.from(v, 'base64').toString('utf8').slice(0, 300)}`)
        } catch { /* not base64 */ }
      }
    }
    server.close()
    process.exit(1)
  }

  const result = await spend.call(`http://localhost:${PORT}/invoke`)
  console.log(`  paid                   HTTP ${result.status} in ${(result.elapsedMs / 1000).toFixed(2)}s`)
  console.log(`  seller body            ${JSON.stringify(result.body).slice(0, 80)}`)
  console.log(`  settlement tx          ${result.settlementTransaction ?? '(not reported in header)'}`)

  // Assert on the transaction, never by diffing Mirror Node balances — those
  // are snapshots and can still show the pre-transfer figure.
  let verified = false
  if (result.settlementTransaction) {
    const ts = result.settlementTransaction.split('@')[1]
    if (ts) {
      const tx = await getTransactionAt(mirror, ts.replace('-', '.'))
      if (tx) {
        console.log(`  on-chain result        ${tx.result}`)
        verified = tx.result === 'SUCCESS'
      }
    }
  }

  const ok = result.status === 200 && unpaid.status === 402
  console.log(
    `\n  ${ok ? 'PASS' : 'FAIL'} — @tab/x402 ${ok ? 'drove a real settlement' : 'did not complete'}` +
      `${verified ? ' (confirmed on-chain)' : ''}\n`,
  )
  server.close()
  process.exit(ok ? 0 : 1)
} catch (err) {
  console.error('\n  FAILED:', err instanceof Error ? err.message : String(err))
  server.close()
  process.exit(1)
}
void hbarNetFor
