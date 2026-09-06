/**
 * An agent that has existed for thirty seconds and pays for something.
 *
 * It holds no key, holds no token, and signs nothing. `boundaries.json` bans
 * the Hedera SDK and @x402/hedera from this package outright, so that claim
 * rests on a check anyone can run rather than on our word — and this file has
 * no dependencies at all beyond the standard library.
 *
 * It reaches Tab over plain HTTP. When `@tab/sdk` exists this becomes
 * `tab.spend({ url, max })`.
 *
 *   pnpm demo:honest
 */

const GATEWAY = process.env['TAB_GATEWAY_URL'] ?? 'http://localhost:8080'
const SELLER = process.env['SELLER_URL'] ?? 'http://localhost:4055'
const TAB = process.env['HEDERA_OPERATOR_ID'] ?? ''
const PAY_TO = process.env['X402_SELLER_ID'] ?? ''
const CALLS = Number(process.env['DEMO_CALLS'] ?? 3)
const PRICE = '0.040000'

interface SpendResponse {
  paid?: { amount: string; seller: string; holdId: string; receiptSeq: number | null; elapsedMs: number }
  refused?: { rule: string; reason: string; guidance: string; retryable: boolean }
  body?: unknown
  error?: string
}

async function state() {
  const res = await fetch(`${GATEWAY}/v1/tabs/${TAB}`)
  return (await res.json()) as Record<string, string | number>
}

async function spend(path: string): Promise<SpendResponse> {
  const res = await fetch(`${GATEWAY}/v1/spend`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tab: TAB, url: `${SELLER}${path}?payTo=${PAY_TO}`, max: PRICE }),
  })
  return (await res.json()) as SpendResponse
}

console.log(`\nhonest-agent · no key, no token, signs nothing\n`)
console.log(`  gateway   ${GATEWAY}`)
console.log(`  seller    ${SELLER}   (unmodified x402, unaware Tab exists)`)
console.log(`  tab       ${TAB}\n`)

const before = await state()
console.log(`  before    available ${before['available']} · outstanding ${before['outstanding']}\n`)

const paths = ['/rank', '/summarise', '/classify']
let paid = 0
let refused = 0

for (let i = 0; i < CALLS; i++) {
  const path = paths[i % paths.length]!
  const result = await spend(path)

  if (result.paid) {
    paid++
    console.log(
      `  ${String(i + 1).padStart(2)}. ${path.padEnd(12)} PAID ${result.paid.amount} · ` +
        `seq ${result.paid.receiptSeq} · ${(result.paid.elapsedMs / 1000).toFixed(1)}s`,
    )
    console.log(`      got: ${JSON.stringify(result.body).slice(0, 72)}`)
  } else if (result.refused) {
    refused++
    // A refusal is a normal outcome — pick different work, do not crash. An
    // agent that dies on refusal would undercut the argument that refusing is
    // the safe behaviour.
    console.log(`  ${String(i + 1).padStart(2)}. ${path.padEnd(12)} REFUSED ${result.refused.rule}`)
    console.log(`      ${result.refused.reason}`)
    console.log(`      next: ${result.refused.guidance}`)
  } else {
    console.log(`  ${String(i + 1).padStart(2)}. ${path.padEnd(12)} FAILED  ${result.error ?? 'unknown'}`)
  }
}

const after = await state()
console.log(`\n  after     available ${after['available']} · outstanding ${after['outstanding']}`)
console.log(`  result    ${paid} paid · ${refused} refused\n`)
console.log(`  The agent never held a key and never signed a payment.`)
console.log(`  The seller never learned Tab exists.\n`)
