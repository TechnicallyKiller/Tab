/**
 * A payer buying from the agent's endpoint.
 *
 * Stands in for the agent's customer. It holds a key and signs, because a payer
 * genuinely is a wallet — that asymmetry is the point: the AGENT holds nothing,
 * its customers hold their own funds.
 *
 * Lives in testkit rather than agents/ for the same reason the seller does:
 * boundaries.json bans the Hedera SDK from honest-agent.
 *
 *   pnpm demo:earn
 */
import { PrivateKey } from '@hiero-ledger/sdk'
import { configureGlobalHttp } from '@tab/mirror'
import { format, usdc } from '@tab/money'
import { NETWORKS, createSpendClient, tokenAsset } from '@tab/x402'

configureGlobalHttp({ connectTimeoutMs: 90_000, headersTimeoutMs: 150_000, bodyTimeoutMs: 150_000 })

const env = (k: string) => {
  const v = process.env[k]
  if (!v) throw new Error(`${k} missing from .env`)
  return v
}

const GATEWAY = process.env['TAB_GATEWAY_URL'] ?? 'http://localhost:8080'
const CALLS = Number(process.env['EARN_CALLS'] ?? 2)
const asset = tokenAsset(env('USDC_TOKEN_ID'), 'TUSD')

// A genuinely separate account. It must NOT be the facilitator's fee payer:
// x402 rejects a transfer the fee payer is a party to with
// `invalid_exact_hedera_payload_fee_payer_transferring_funds`. Independence also
// matters for the product — revenue from a payer Tab controls is exactly what
// @tab/graph exists to discount.
const payerId = env('PAYER_ACCOUNT_ID')
const payerKey = PrivateKey.fromStringDer(env('PAYER_ACCOUNT_KEY').replace(/^0x/, ''))

const client = createSpendClient({
  network: NETWORKS.testnet,
  payerId,
  payerKey,
  asset,
  /*
   * The PAYER's own cap, configurable — a customer decides what it will pay.
   *
   * Hardcoded at 0.2000 it silently rejected every call the moment the demo
   * raised the endpoint price to 0.5000, and x402 reported it as
   * "All payment requirements were rejected by spendControls" — which reads
   * like a protocol fault rather than the payer's own limit doing its job.
   */
  maxAtomicPerPayment: usdc(process.env['PAYER_MAX_PER_CALL_USDC'] ?? '0.200000'),
})

console.log(`\npayer · buying from the agent's endpoint\n`)
console.log(`  payer     ${payerId}`)
console.log(`  gateway   ${GATEWAY}/v1/earn`)

/*
 * The AGENT's tab, not the operator.
 *
 * This read the operator id, which is the hot float — so the before/after lines
 * reported a completely different tab's balance while the credits landed on the
 * agent's. It printed `−0.0200 → −0.0200` through three successful payments,
 * which reads as "earning changed nothing" when in fact the agent had gone
 * from −0.0400 to +0.1100.
 */
const tab = env('TAB_ACCOUNT_ID')
const state = async () => {
  const r = await fetch(`${GATEWAY}/v1/tabs/${tab}`)
  return (await r.json()) as Record<string, string>
}

const before = await state()
console.log(`\n  before    balance ${before['balance']} · outstanding ${before['outstanding']}\n`)

let paid = 0
for (let i = 0; i < CALLS; i++) {
  const started = Date.now()
  try {
    // Use the wrapped fetch directly so the PAID response is inspectable —
    // client.call() consumes it and reports only a status.
    const raw = await client.fetch(`${GATEWAY}/v1/earn?payer=${payerId}`, { method: 'GET' })
    if (raw.status !== 200) {
      const header = raw.headers.get('payment-required')
      console.log(`  ${i + 1}. paid attempt -> HTTP ${raw.status}`)
      console.log(`     body:  ${(await raw.clone().text()).slice(0, 200)}`)
      if (header) {
        const decoded = JSON.parse(Buffer.from(header, 'base64').toString('utf8'))
        console.log(`     error: ${decoded.error}`)
      }
      continue
    }
    const result = { status: raw.status, body: await raw.json() }
    if (result.status === 200) {
      paid++
      const body = result.body as { served?: unknown; credited?: Record<string, unknown> }
      console.log(
        `  ${i + 1}. PAID · credited ${body.credited?.['amount']} · attested ` +
          `${body.credited?.['attested']} · seq ${body.credited?.['receiptSeq']} · ` +
          `${((Date.now() - started) / 1000).toFixed(1)}s`,
      )
      console.log(`     agent served: ${JSON.stringify(body.served).slice(0, 78)}`)
    } else {
      console.log(`  ${i + 1}. HTTP ${result.status}`)
      // An empty 402 body tells you nothing; the header carries the reason.
      const probe = await fetch(`${GATEWAY}/v1/earn?payer=${payerId}`)
      const header = probe.headers.get('payment-required')
      if (header) {
        const decoded = JSON.parse(Buffer.from(header, 'base64').toString('utf8'))
        console.log(`     error:   ${decoded.error ?? '(none reported)'}`)
        console.log(`     accepts: ${JSON.stringify(decoded.accepts?.[0])?.slice(0, 180)}`)
      }
    }
  } catch (error) {
    console.log(`  ${i + 1}. FAILED ${error instanceof Error ? error.message : String(error)}`)
  }
}

const after = await state()
console.log(`\n  after     balance ${after['balance']} · outstanding ${after['outstanding']}`)
console.log(`  result    ${paid} of ${CALLS} paid`)
console.log(`\n  The agent earned without holding a key. The tab moved toward positive.`)
console.log(`  Payment landed in house float, not in the agent's hands.\n`)
void format
