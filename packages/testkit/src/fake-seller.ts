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

import { PrivateKey } from '@hiero-ledger/sdk'
import { configureGlobalHttp } from '@tab/mirror'
import {
  createBlocky402Facilitator,
  createEarnServer,
  createFacilitator,
  NETWORKS,
  tokenAsset,
} from '@tab/x402'
import { paymentMiddleware } from '@x402/express'
import express from 'express'

configureGlobalHttp({ connectTimeoutMs: 90_000 })

const env = (k: string) => {
  const v = process.env[k]
  if (!v) throw new Error(`${k} missing from .env`)
  return v
}

/*
 * `PORT` is what a managed host actually sets.
 *
 * Render and friends inject it and health-check that address; listening
 * elsewhere marks the deploy dead with nothing in the logs. `SELLER_PORT` still
 * wins when set, so the local demo is unchanged.
 */
const PORT = Number(process.env['SELLER_PORT'] ?? process.env['PORT'] ?? 4055)
const PRICE = 40_000n // 0.04 of a 6dp token — the flat routes below

/*
 * ── The METERED feed: price scales with the data returned ───────────────────
 *
 * The three flat routes below charge the same whatever they do, which is the
 * thing a metered rail is supposed to replace. This one prices per RECORD:
 * `/feed/25` costs 25 units, `/feed/1` costs one. Settled per request, no seat
 * and no subscription.
 *
 * ## Why it is a route per tier rather than a price function
 *
 * x402 declares `atomicPrice` per route when the resource server is built, so
 * the 402 challenge for a route is fixed before any request arrives — which is
 * correct, because a client must be able to learn a price BEFORE paying it. A
 * price computed from the request body could not be quoted in the challenge.
 *
 * So the tiers are generated from one unit price. That keeps the metering
 * honest — every price here is `units × UNIT_PRICE`, with nothing hand-set —
 * while still letting a buyer see the cost up front.
 *
 * ## The tiers are chosen to exercise the rail, not to look tidy
 *
 * At 0.002 per record and a 0.05 per-call cap: 25 records costs exactly the
 * cap, and 100 costs 0.20 and is REFUSED by `PER_CALL_CAP`. So an agent can
 * discover a limit by metering into it, which is a far better demonstration
 * than a flat price that either fits or does not.
 */
const UNIT_PRICE = 2_000n // 0.002 per record
const FEED_TIERS = [1, 10, 25, 100] as const
const asset = tokenAsset(env('USDC_TOKEN_ID'), 'TUSD')
const payTo = env('X402_SELLER_ID')

/*
 * Which facilitator settles THIS service's payments.
 *
 * `X402_FACILITATOR=blocky402` uses the hosted one; anything else keeps the
 * self-hosted default. A real seller picks whatever facilitator it likes and
 * Tab never sees the choice — which is the point being demonstrated, and why
 * this switch lives on the seller independently of the gateway's own.
 *
 * With Blocky402 the fee payer is THEIRS, so `FAUCET_ACCOUNT_*` goes unused
 * here and a deployment needs one less funded account. They are read lazily
 * for exactly that reason: requiring a key the run will never use would make a
 * hosted deployment fail for no reason.
 */
const useBlocky402 = (process.env['X402_FACILITATOR'] ?? '').toLowerCase() === 'blocky402'

const facilitator = useBlocky402
  ? createBlocky402Facilitator(NETWORKS.testnet, {
      ...(process.env['X402_FACILITATOR_URL']
        ? { baseUrl: process.env['X402_FACILITATOR_URL'] }
        : {}),
      ...(process.env['X402_FACILITATOR_API_KEY']
        ? { apiKey: process.env['X402_FACILITATOR_API_KEY'] }
        : {}),
    })
  : createFacilitator({
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
    // Metered: every price is `units × UNIT_PRICE`, never hand-set.
    ...FEED_TIERS.map((units) => ({
      route: `GET /feed/${units}`,
      payTo,
      asset,
      atomicPrice: UNIT_PRICE * BigInt(units),
      description: `Market feed · ${units} record${units === 1 ? '' : 's'}`,
    })),
  ],
})

const app = express()

/*
 * Behind Render's TLS terminator, Express sees a plain `http` request.
 *
 * @x402/express builds the challenge's `resource.url` from `req.protocol`,
 * which honours `X-Forwarded-Proto` only once the proxy is trusted — so
 * without this a buyer fetching `https://…` is quoted for `http://…`, and the
 * resource it agreed to pay for is not the one it requested.
 *
 * Harmless locally: with no proxy in front, `req.protocol` is unchanged.
 */
app.set('trust proxy', true)

/*
 * Unpaid, and mounted BEFORE the payment middleware so it is never gated —
 * a host health-checking a 402 would restart a healthy seller forever.
 *
 * It reports which facilitator is in force because that is the one piece of
 * this service's configuration that cannot be observed from the outside: a
 * 402 challenge looks identical either way, and the difference only shows up
 * on-chain, after a payment.
 */
app.get('/health', (_q, r) =>
  r.json({ ok: true, facilitator: useBlocky402 ? 'blocky402' : 'self-hosted', payTo }),
)

app.use(paymentMiddleware(earn.routes as never, earn.server as never))
app.get('/rank', (_q, r) => r.json({ ranked: ['alpha', 'beta', 'gamma'], at: Date.now() }))
app.get('/summarise', (_q, r) => r.json({ summary: 'three findings, one caveat', at: Date.now() }))
app.get('/classify', (_q, r) => r.json({ label: 'invoice', confidence: 0.91, at: Date.now() }))

/*
 * One handler per tier, returning exactly the records paid for.
 *
 * The count is read from the ROUTE, not from a query parameter, because the
 * route is what was priced and what the buyer agreed to in the 402. Taking a
 * count from the query would let a caller pay for one record and ask for a
 * hundred.
 */
for (const units of FEED_TIERS) {
  app.get(`/feed/${units}`, (_q, r) =>
    r.json({
      records: Array.from({ length: units }, (_, i) => ({
        symbol: ['HBAR', 'USDC', 'BTC', 'ETH'][i % 4],
        price: Number((10 + ((i * 37) % 900) / 100).toFixed(2)),
        seq: i,
      })),
      units,
      at: Date.now(),
    }),
  )
}

app.listen(PORT, () => {
  console.log(`\n  unmodified x402 seller on :${PORT}`)
  console.log(`  paying to   ${payTo}`)
  console.log(`  facilitator ${useBlocky402 ? 'Blocky402 (hosted)' : 'self-hosted'}`)
  console.log(`  flat        0.0400 TUSD · /rank /summarise /classify`)
  console.log(
    `  metered     0.0020 TUSD per record · ` +
      FEED_TIERS.map(
        (u) => `/feed/${u} (${(Number(UNIT_PRICE * BigInt(u)) / 1e6).toFixed(4)})`,
      ).join(' '),
  )
  console.log(
    `  note        /feed/100 costs 0.2000 and is refused by the 0.0500 per-call cap — ` +
      `metering into a limit is the demo\n`,
  )
})
