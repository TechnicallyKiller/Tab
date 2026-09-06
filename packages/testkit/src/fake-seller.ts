/**
 * An unmodified x402 seller.
 *
 * Built from stock `@x402/hedera/exact/server` with **zero Tab awareness**.
 * That is the point: the strongest property in the design is "works with any
 * unmodified x402 endpoint", and testing against a seller we wrote with Tab in
 * mind would prove nothing.
 *
 * This lives in testkit, NOT in agents/honest-agent, because a seller needs a
 * key and the agent must not have one — `boundaries.json` bans the Hedera SDK
 * from honest-agent so that "the agent holds no key and signs nothing" rests on
 * a check anyone can run rather than on our word.
 *
 *   pnpm seller
 */
import express from 'express'
import { paymentMiddleware } from '@x402/express'
import { PrivateKey } from '@hiero-ledger/sdk'
import { NETWORKS, createEarnServer, createFacilitator, tokenAsset } from '@tab/x402'
import { configureGlobalHttp } from '@tab/mirror'

configureGlobalHttp({ connectTimeoutMs: 90_000 })

const env = (k: string) => {
  const v = process.env[k]
  if (!v) throw new Error(`${k} missing from .env`)
  return v
}

const PORT = Number(process.env['SELLER_PORT'] ?? 4055)
const PRICE = 40_000n // 0.04 of a 6dp token
const asset = tokenAsset(env('USDC_TOKEN_ID'), 'TUSD')
const payTo = env('X402_SELLER_ID')

// The seller runs its own facilitator here only because this is a local demo.
// A real seller uses whatever facilitator it likes — Tab never sees it.
const facilitator = createFacilitator({
  network: NETWORKS.testnet,
  feePayerId: env('FAUCET_ACCOUNT_ID'),
  feePayerKey: PrivateKey.fromStringDer(env('FAUCET_ACCOUNT_KEY').replace(/^0x/, '')),
})

const earn = createEarnServer({
  network: NETWORKS.testnet,
  facilitator,
  routes: [
    { route: 'GET /rank', payTo, asset, atomicPrice: PRICE, description: 'Ranked results' },
    { route: 'GET /summarise', payTo, asset, atomicPrice: PRICE, description: 'Summary' },
    { route: 'GET /classify', payTo, asset, atomicPrice: PRICE, description: 'Classification' },
  ],
})

const app = express()
app.use(paymentMiddleware(earn.routes as never, earn.server as never))
app.get('/rank', (_q, r) => r.json({ ranked: ['alpha', 'beta', 'gamma'], at: Date.now() }))
app.get('/summarise', (_q, r) => r.json({ summary: 'three findings, one caveat', at: Date.now() }))
app.get('/classify', (_q, r) => r.json({ label: 'invoice', confidence: 0.91, at: Date.now() }))

app.listen(PORT, () => {
  console.log(`\n  unmodified x402 seller on :${PORT}`)
  console.log(`  paying to   ${payTo}`)
  console.log(`  price       0.0400 TUSD per call`)
  console.log(`  routes      /rank /summarise /classify\n`)
})
