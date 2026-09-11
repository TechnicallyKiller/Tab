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
/*
 * The tab to drive traffic on.
 *
 * `TAB_ACCOUNT_ID` first, because that is the agent the console and the demo
 * are about. It used to read HEDERA_OPERATOR_ID only, so every scripted run
 * filed receipts against the OPERATOR's tab — activity that existed on the
 * topic but never appeared on the agent anybody was looking at.
 */
const TAB = process.env['TAB_ACCOUNT_ID'] ?? process.env['HEDERA_OPERATOR_ID'] ?? ''
const CALLS = Number(process.env['DEMO_CALLS'] ?? 3)

interface SpendResponse {
  paid?: {
    amount: string
    seller: string
    holdId: string
    receiptSeq: number | null
    elapsedMs: number
  }
  refused?: { rule: string; reason: string; guidance: string; retryable: boolean }
  body?: unknown
  error?: string
}

async function state() {
  const res = await fetch(`${GATEWAY}/v1/tabs/${TAB}`)
  return (await res.json()) as Record<string, string | number>
}

/*
 * A PLAIN seller url, and no `max`.
 *
 * Both used to be supplied: `?payTo=` named the counterparty and `max` named
 * the price. Neither is the buyer's to state — the seller publishes both in its
 * 402 challenge — and passing them here meant this script exercised a path no
 * real caller would take. The first person to paste a plain URL hit a 502 that
 * no demo run could ever have reproduced.
 *
 * So it now buys the way the chat agent and the CLI do, and this script is a
 * test of the real path rather than a rehearsal of a private one.
 */
async function spend(path: string): Promise<SpendResponse> {
  const res = await fetch(`${GATEWAY}/v1/spend`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tab: TAB, url: `${SELLER}${path}` }),
  })

  /*
   * Read the body as TEXT first, and only then try to parse it.
   *
   * `res.json()` on a non-JSON body throws a SyntaxError whose message is the
   * first line of whatever arrived — which, when a host's edge serves an error
   * page while the instance is restarting, is `<!DOCTYPE html>`. That crashed
   * the whole run on the first call, with a stack trace that says nothing about
   * the gateway being briefly unavailable.
   *
   * A transient 502 is not a reason to abandon the remaining work, so it is
   * reported as a failed call and the loop carries on. The status and the first
   * line of the body are enough to tell "the gateway is down" from "the gateway
   * said no".
   */
  const body = await res.text()
  try {
    return JSON.parse(body) as SpendResponse
  } catch {
    const first = body.trim().split('\n')[0]?.slice(0, 80) ?? ''
    return { error: `HTTP ${res.status} — not JSON: ${first}` }
  }
}

console.log(`\nhonest-agent · no key, no token, signs nothing\n`)
console.log(`  gateway   ${GATEWAY}`)
console.log(`  seller    ${SELLER}   (unmodified x402, unaware Tab exists)`)
console.log(`  tab       ${TAB}\n`)

const before = await state()
console.log(`  before    available ${before['available']} · outstanding ${before['outstanding']}\n`)

/*
 * Deliberately mixed, and deliberately including one that CANNOT be afforded.
 *
 * `/feed/100` costs 0.200000 against a 0.050000 per-call cap, so it is refused
 * every time — on purpose. A topic showing only successful payments says
 * nothing about underwriting; the refusal is the evidence that a limit is
 * actually enforced, and the Refusals view needs something in it when somebody
 * looks.
 *
 * The rest vary the amount so the receipt stream shows real metering rather
 * than the same figure repeating: 0.002000, 0.050000, 0.040000.
 */
const paths = ['/feed/1', '/feed/25', '/rank', '/feed/100']
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
    console.log(
      `  ${String(i + 1).padStart(2)}. ${path.padEnd(12)} FAILED  ${result.error ?? 'unknown'}`,
    )
  }
}

const after = await state()
console.log(`\n  after     available ${after['available']} · outstanding ${after['outstanding']}`)
console.log(`  result    ${paid} paid · ${refused} refused\n`)
console.log(`  The agent never held a key and never signed a payment.`)
console.log(`  The seller never learned Tab exists.\n`)
