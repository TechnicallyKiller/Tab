/**
 * Probe 2 — the x402 loop, end to end, on real Hedera testnet.
 *
 * Proves the primary track requirement: an unmodified x402 seller is paid over
 * the protocol, settled on-chain, with our own facilitator.
 *
 * Three roles in one process for the spike — they get split into real services
 * later. Settles NATIVE HBAR (asset "0.0.0", tinybars), which is the documented
 * default for @x402/hedera and needs no token association.
 *
 *   pnpm probe:x402
 */

import { PrivateKey } from '@hiero-ledger/sdk'
import { configureGlobalHttp, MirrorClient } from '@tab/mirror'
import { x402Facilitator } from '@x402/core/facilitator'
import { paymentMiddleware, x402ResourceServer } from '@x402/express'
import { wrapFetchWithPayment, x402Client, x402HTTPClient } from '@x402/fetch'
import {
  createClientHederaSigner,
  createHederaClient,
  createHederaPreflightTransfer,
  createHederaSignAndSubmitTransaction,
  createHederaVerifyPayerSignature,
  HBAR_ASSET_ID,
  HEDERA_TESTNET_CAIP2,
  toFacilitatorHederaSigner,
} from '@x402/hedera'
import { ExactHederaScheme as ClientScheme } from '@x402/hedera/exact/client'
import { ExactHederaScheme as FacilitatorScheme } from '@x402/hedera/exact/facilitator'
import { ExactHederaScheme as ServerScheme } from '@x402/hedera/exact/server'
import express from 'express'

// Node's fetch dies after a 10s CONNECT timeout that no AbortController can
// extend, and Mirror Node needs 5-15s from a high-latency link. Must run before
// any HTTP. See packages/mirror/src/http.ts.
configureGlobalHttp()

const NETWORK = HEDERA_TESTNET_CAIP2
const PORT = 4021
const TINYBAR_PER_HBAR = 100_000_000n

/**
 * `--hts` settles an HTS token instead of native HBAR.
 *
 * This is the path Tab actually uses: the product is denominated in a
 * 6-decimal dollar token, not HBAR. HBAR is @x402/hedera's documented default
 * and the easier first proof, but if the HTS path did not work the whole design
 * would need rethinking — so it gets its own run.
 */
const USE_HTS = process.argv.includes('--hts')

const env = (k: string) => {
  const v = process.env[k]
  if (!v || v.includes('xxxxx')) throw new Error(`${k} missing from .env`)
  return v
}

// ── the three parties ────────────────────────────────────────────────────────
// Buyer: the operator, standing in for Tab's hot float on the spend leg.
const BUYER_ID = env('HEDERA_OPERATOR_ID')
const BUYER_KEY = PrivateKey.fromStringDer(env('HEDERA_OPERATOR_KEY').replace(/^0x/, ''))

// Facilitator fee payer: must be a funded ECDSA account, separate from the
// seller. The relay we created for the faucet is exactly this shape.
const FEE_PAYER_ID = env('FAUCET_ACCOUNT_ID')
const FEE_PAYER_KEY = PrivateKey.fromStringDer(env('FAUCET_ACCOUNT_KEY').replace(/^0x/, ''))

// The asset under test.
const TOKEN_ID = process.env['USDC_TOKEN_ID'] ?? ''
if (USE_HTS && (!TOKEN_ID || TOKEN_ID.includes('xxxxx'))) {
  throw new Error('--hts needs USDC_TOKEN_ID in .env. Run `pnpm chain:status`.')
}
const ASSET = USE_HTS ? TOKEN_ID : HBAR_ASSET_ID
// HBAR has 8 decimals (tinybars); our dollar token has 6.
const ATOMIC_PRICE = USE_HTS ? 40_000n : TINYBAR_PER_HBAR / 2n
const UNIT = USE_HTS ? 1_000_000n : TINYBAR_PER_HBAR
const SYMBOL = USE_HTS ? 'tokens' : 'ℏ'

// Seller: any account can receive HBAR — no association needed. Must be
// SEPARATE from the fee payer, or the net movement reads as price-minus-fees
// and looks like the price was wrong. `pnpm seller:create` makes one.
const SELLER_ID = process.env['X402_SELLER_ID'] || FEE_PAYER_ID
if (SELLER_ID === FEE_PAYER_ID) {
  console.warn(
    '  NOTE: seller and fee payer are the same account, so the seller pays the\n' +
      '  network fee out of what it receives. Run `pnpm seller:create` and set\n' +
      '  X402_SELLER_ID for a clean reading.\n',
  )
}

const mirror = new MirrorClient({ network: 'testnet', timeoutMs: 30_000, maxRetries: 4 })
/** Balance of whichever asset is under test, in that asset's atomic units. */
const balanceOf = async (id: string): Promise<bigint> => {
  if (!USE_HTS) {
    const a = await mirror.get<{ balance?: { balance?: number } }>(`/api/v1/accounts/${id}?limit=1`)
    return BigInt(a.balance?.balance ?? 0)
  }
  try {
    const page = await mirror.get<{ tokens?: { balance: number }[] }>(
      `/api/v1/accounts/${id}/tokens?token.id=${TOKEN_ID}&limit=2`,
    )
    return BigInt(page.tokens?.[0]?.balance ?? 0)
  } catch {
    return 0n // not indexed or not associated — both read as zero here
  }
}
const fmt = (atomic: bigint) => {
  const negative = atomic < 0n
  const m = negative ? -atomic : atomic
  const whole = m / UNIT
  const frac = ((m % UNIT) * 10_000n) / UNIT
  return `${negative ? '−' : ''}${whole}.${frac.toString().padStart(4, '0')} ${SYMBOL}`
}

console.log('\nProbe 2 — x402 loop on Hedera testnet\n')
console.log(`  buyer      ${BUYER_ID}   (Tab hot float)`)
console.log(`  seller     ${SELLER_ID}`)
console.log(`  fee payer  ${FEE_PAYER_ID}   (facilitator, ECDSA)`)
console.log(
  `  asset      ${ASSET} ${USE_HTS ? 'HTS token' : 'native HBAR'} · price ` +
    `${(Number(ATOMIC_PRICE) / Number(UNIT)).toFixed(4)} ${SYMBOL}`,
)
console.log(`  network    ${NETWORK}\n`)

// ── 1. facilitator, in process ───────────────────────────────────────────────
const facilitatorSigner = toFacilitatorHederaSigner({
  getAddresses: () => [FEE_PAYER_ID],
  signAndSubmitTransaction: createHederaSignAndSubmitTransaction(
    (network: string) => createHederaClient(network),
    FEE_PAYER_KEY,
  ),
  verifyPayerSignature: createHederaVerifyPayerSignature(),
  preflightTransfer: createHederaPreflightTransfer(),
})

const facilitator = new x402Facilitator().register(
  NETWORK,
  new FacilitatorScheme(facilitatorSigner),
)
console.log('  [1] facilitator registered')

// ── 2. the seller — stock x402, knows nothing about Tab ──────────────────────
// The in-process facilitator, presented as the FacilitatorClient the resource
// server expects. The cast is needed because @x402/core's own getSupported()
// widens `network` to string where its FacilitatorClient interface requires
// `${string}:${string}` — a mismatch inside the library's own types, not ours.
const facilitatorClient = {
  verify: facilitator.verify.bind(facilitator),
  settle: facilitator.settle.bind(facilitator),
  getSupported: async () => facilitator.getSupported(),
} as unknown as ConstructorParameters<typeof x402ResourceServer>[0]

const resourceServer = new x402ResourceServer(facilitatorClient).register(
  NETWORK,
  new ServerScheme(),
)

const app = express()
app.use(
  paymentMiddleware(
    {
      'GET /rank': {
        accepts: [
          {
            scheme: 'exact',
            price: { amount: ATOMIC_PRICE.toString(), asset: ASSET },
            network: NETWORK,
            payTo: SELLER_ID,
          },
        ],
        description: 'Ranked results',
        mimeType: 'application/json',
      },
    },
    resourceServer,
  ),
)
app.get('/rank', (_req, res) => {
  res.json({ ranked: ['alpha', 'beta', 'gamma'], servedAt: new Date().toISOString() })
})

const server = app.listen(PORT)
await new Promise((r) => server.once('listening', r))
console.log(`  [2] seller listening on :${PORT}`)

// ── 3. the buyer ─────────────────────────────────────────────────────────────
const clientSigner = createClientHederaSigner(BUYER_ID, BUYER_KEY, { network: NETWORK })
const client = new x402Client().register(NETWORK, new ClientScheme(clientSigner))

// x402's own client-side spend controls default to USD-pegged assets only —
// `findDefaultAsset` recognises USDC, not native HBAR — with a $1 per-payment
// cap. Paying in HBAR therefore needs an explicit allowedAssets entry.
//
// Worth noting for Tab: this is x402's built-in equivalent of our per-call cap.
// It is a useful outer layer, but it is client-side and advisory — the agent
// configures it — which is exactly why Tab's cap lives in the gateway where the
// agent cannot reach it.
client.setSpendControls({
  maxAmountPerPayment: '$1',
  allowedAssets: [
    {
      network: NETWORK,
      asset: ASSET,
      // Atomic units — tinybars for HBAR, micro-units for a 6dp token. Never "$1".
      maxAmountPerPayment: (ATOMIC_PRICE * 4n).toString(),
    },
  ],
})
const httpClient = new x402HTTPClient(client)
const payingFetch = wrapFetchWithPayment(fetch, client)
console.log('  [3] buyer ready\n')

const url = `http://localhost:${PORT}/rank`

try {
  // Unpaid request must be refused with a 402 challenge.
  const unpaid = await fetch(url)
  console.log(
    `  unpaid request      HTTP ${unpaid.status}  ${unpaid.status === 402 ? '(402 challenge)' : 'UNEXPECTED'}`,
  )
  const ch = unpaid.headers.get('payment-required')
  if (ch) {
    const decoded = JSON.parse(Buffer.from(ch, 'base64').toString('utf8'))
    console.log(`  challenge accepts   ${JSON.stringify(decoded.accepts?.[0])}`)
  }

  const buyerBefore = await balanceOf(BUYER_ID)
  const sellerBefore = await balanceOf(SELLER_ID)
  console.log(`  buyer before        ${fmt(buyerBefore)}`)
  console.log(`  seller before       ${fmt(sellerBefore)}`)

  console.log('\n  paying…')
  // Attribute the time: a 30s payment needs to be traceable to a leg, not
  // reported as "slow". Phase timings come from the client hooks.
  const marks: [string, number][] = []
  const mark = (label: string) => marks.push([label, performance.now()])
  const t0 = performance.now()
  mark('start')
  const paid = await payingFetch(url, { method: 'GET' })
  mark('http complete')
  // Clone before processResponse, which consumes the stream.
  const body = await paid
    .clone()
    .json()
    .catch(() => null)
  const result = await httpClient.processResponse(paid)
  const elapsed = ((performance.now() - t0) / 1000).toFixed(2)

  console.log(`  paid request        HTTP ${paid.status}  in ${elapsed}s`)
  let previous = t0
  for (const [label, at] of marks.slice(1)) {
    console.log(`    ${label.padEnd(18)} +${((at - previous) / 1000).toFixed(2)}s`)
    previous = at
  }
  // processResponse consumes the body, so read the settlement receipt from it
  // and the resource itself from a clone taken before it was read.
  const settled = result as { kind?: string; settlement?: { transaction?: string } }
  console.log(`  result kind         ${settled.kind ?? '(not reported)'}`)
  if (settled.settlement?.transaction) {
    console.log(`  settle tx           ${settled.settlement.transaction}`)
  }
  console.log(`  seller returned     ${JSON.stringify(body).slice(0, 110)}`)

  // Confirm on-chain, as a stranger would.
  process.stdout.write('\n  confirming on-chain ')
  let buyerAfter = buyerBefore
  let sellerAfter = sellerBefore
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 2500))
    process.stdout.write('.')
    buyerAfter = await balanceOf(BUYER_ID)
    sellerAfter = await balanceOf(SELLER_ID)
    if (sellerAfter !== sellerBefore) break
  }
  console.log()
  console.log(`  buyer after         ${fmt(buyerAfter)}   (${fmt(buyerAfter - buyerBefore)})`)
  console.log(`  seller after        ${fmt(sellerAfter)}   (${fmt(sellerAfter - sellerBefore)})`)

  const moved = sellerAfter > sellerBefore
  console.log(
    `\n  ${moved ? 'PASS' : 'FAIL'} — x402 ${USE_HTS ? 'HTS token' : 'HBAR'} payment ` +
      `${moved ? 'settled on Hedera' : 'did NOT settle'}\n`,
  )
  server.close()
  process.exit(moved ? 0 : 1)
} catch (err) {
  console.error('\n  FAILED:', err instanceof Error ? err.message : String(err))
  if (err instanceof Error && err.stack) console.error(err.stack.split('\n').slice(1, 6).join('\n'))
  server.close()
  process.exit(1)
}
