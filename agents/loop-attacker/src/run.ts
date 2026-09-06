/**
 * The loop attack, end to end, against a live gateway.
 *
 *   pnpm attack
 *
 * A second operator stands up a payer it CONTROLS, has it buy from the agent's
 * endpoint to manufacture attested revenue, and spends against the ceiling that
 * revenue inflates.
 *
 * ## The one rule that makes this worth running
 *
 * **Only public surfaces.** No test hook, no privileged endpoint, no seeded
 * database row, no flag that tells the gateway to refuse. Every payment is a
 * genuine signed x402 settlement, and the funding edge is an ordinary HTS
 * transfer anyone can see on Mirror Node. If the attack needed help from us to
 * be caught, being caught would prove nothing.
 *
 * That is also why the attack is hard: nothing here is forged. It is an
 * accounting lie told entirely with valid transactions, which is exactly why
 * per-payment verification cannot see it. Every x402 payment in this script
 * would pass any signature check ever written.
 *
 * ## What is being tested
 *
 * Whether `@tab/graph` notices that the "customer" is not an independent
 * economic actor, and whether the collapsed ceiling reaches the fast path in
 * time to refuse the NEXT spend rather than the next window's.
 *
 * ## Timing
 *
 * It waits on the gateway's own published ceiling changing, never on a fixed
 * sleep. A `sleep(10)` works in rehearsal and fails on stage exactly once.
 */
import { clientFromEnv, createAccount, transferToken } from '@tab/hedera'
import { MirrorClient, configureGlobalHttp, getUsdcBalance, waitForAccount } from '@tab/mirror'
import { format, usdc } from '@tab/money'
import { NETWORKS, createSpendClient, tokenAsset } from '@tab/x402'

configureGlobalHttp({ connectTimeoutMs: 90_000, headersTimeoutMs: 150_000, bodyTimeoutMs: 150_000 })

const env = (key: string): string => {
  const value = process.env[key]
  if (!value || value.includes('xxxxx')) throw new Error(`${key} missing from .env`)
  return value
}

const GATEWAY = process.env['TAB_GATEWAY_URL'] ?? 'http://localhost:8080'
const SELLER_URL = process.env['SELLER_URL'] ?? 'http://localhost:4055'
const tokenId = env('USDC_TOKEN_ID')
const tab = env('TAB_ACCOUNT_ID')
const honestSeller = env('X402_SELLER_ID')

/** How many manufactured purchases to make. */
const FAKE_PURCHASES = Number(process.env['ATTACK_PURCHASES'] ?? 3)
/** How long to wait for the engine to notice, in seconds. */
const CATCH_TIMEOUT = Number(process.env['ATTACK_CATCH_TIMEOUT'] ?? 900)

interface SpendResponse {
  paid?: { amount: string; seller: string; holdId: string; receiptSeq: number | null }
  refused?: { rule: string; reason: string; guidance: string; retryable: boolean }
  error?: string
}

async function tabState(): Promise<Record<string, string | number>> {
  const res = await fetch(`${GATEWAY}/v1/tabs/${tab}`)
  return (await res.json()) as Record<string, string | number>
}

async function spend(path: string, payTo: string): Promise<SpendResponse> {
  const res = await fetch(`${GATEWAY}/v1/spend`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tab, url: `${SELLER_URL}${path}?payTo=${payTo}`, max: '0.040000' }),
  })
  return (await res.json()) as SpendResponse
}

const attacker = clientFromEnv()
const mirror = new MirrorClient({ network: attacker.network, timeoutMs: 45_000, maxRetries: 4 })

console.log(`\nloop-attacker · the attack that breaks our own design — Hedera ${attacker.network}\n`)
console.log(`  attacker        ${attacker.operatorId.toString()}   (a second operator, with a real wallet)`)
console.log(`  target tab      ${tab}`)
console.log(`  gateway         ${GATEWAY}`)

const before = await tabState()
console.log(`  tab before      balance ${before['balance']} · ceiling ${before['ceiling']}\n`)

/* ── 1. the controlled payer ─────────────────────────────────────────────── */

console.log('  ── 1. stand up a payer the attacker controls ──\n')

const shill = await createAccount(attacker.client, {
  initialHbar: 3,
  maxAutomaticTokenAssociations: -1,
})
process.stdout.write('  waiting index   ')
await waitForAccount(mirror, shill.accountId)
console.log('indexed')
console.log(`  shill payer     ${shill.accountId}`)

/*
 * The funding transfer IS the attack surface, and it cannot be avoided.
 *
 * A payer with no balance cannot pay, so the attacker must fund it, and funding
 * leaves an ordinary public HTS transfer on Mirror Node. `@tab/graph` derives
 * funding ancestry from exactly that. The attacker's only ways out are to fund
 * from an unrelated root it has aged separately — which is the OPEN
 * non-reciprocal-ring gap the README lists honestly — or to not attack.
 */
const funding = usdc('2.000000')
const moved = await transferToken(attacker.client, {
  tokenId,
  from: attacker.operatorId.toString(),
  to: shill.accountId,
  amount: funding,
  idempotencyKey: `loop-attacker:fund:${shill.accountId}`,
})
console.log(`  funded          ${format(funding)} · ${moved.consensusStatus}`)
console.log(`                  edge now public: ${attacker.operatorId.toString()} ──funds──▶ ${shill.accountId}`)

process.stdout.write('  confirming      ')
for (let i = 0; i < 12; i++) {
  await new Promise((r) => setTimeout(r, 2500))
  process.stdout.write('.')
  if ((await getUsdcBalance(mirror, shill.accountId, tokenId)) > 0n) break
}
console.log(' funded\n')

/* ── 2. manufacture attested revenue ────────────────────────────────────── */

console.log('  ── 2. manufacture revenue: the shill buys from the agent ──\n')
console.log('  Each of these is a genuine x402 payment. Real signature, real')
console.log('  settlement, real service delivered. Nothing here is forged.\n')

const client = createSpendClient({
  network: NETWORKS.testnet,
  payerId: shill.accountId,
  // Already a PrivateKey — `createAccount` generates and returns the object,
  // so there is no DER string to re-parse. The key never leaves this process
  // and is never printed: a private key in terminal scrollback is a private key
  // in the screen recording.
  payerKey: shill.privateKey,
  asset: tokenAsset(tokenId, 'TUSD'),
  /*
   * The shill's own per-payment cap, configurable.
   *
   * Hardcoded at 0.1000 this silently rejected every call the moment the demo
   * raised the endpoint price, and x402 reported it as "All payment
   * requirements were rejected by spendControls" — which reads like a protocol
   * fault rather than the payer's own limit working. Second time this exact
   * shape bit a demo run; `packages/testkit/src/fake-payer.ts` had it too.
   */
  maxAtomicPerPayment: usdc(process.env['ATTACK_MAX_PER_CALL_USDC'] ?? '0.600000'),
})

let purchased = 0
for (let i = 1; i <= FAKE_PURCHASES; i++) {
  const result = await client.call(`${GATEWAY}/v1/earn?payer=${shill.accountId}`)
  const ok = result.status >= 200 && result.status < 300
  if (ok) purchased++
  console.log(
    `  ${i}. ${ok ? 'PAID' : `FAILED (${result.status})`}` +
      `${result.settlementTransaction ? ` · tx ${result.settlementTransaction}` : ''}` +
      ` · ${(result.elapsedMs / 1000).toFixed(1)}s`,
  )
}

const inflated = await tabState()
console.log(`\n  tab now         balance ${inflated['balance']} · ceiling ${inflated['ceiling']}`)
console.log(`                  ${purchased} manufactured purchase(s) look exactly like revenue\n`)

/* ── 3. spend against the inflated ceiling ──────────────────────────────── */

console.log('  ── 3. spend against it — the first calls clear ──\n')

const firstSpend = await spend('/rank', honestSeller)
if (firstSpend.paid) {
  console.log(`  CLEARED         ${firstSpend.paid.amount} to ${firstSpend.paid.seller} · receipt ${firstSpend.paid.receiptSeq}`)
  console.log('                  nothing is visibly wrong yet, and that is the point\n')
} else {
  console.log(`  REFUSED already [${firstSpend.refused?.rule}] ${firstSpend.refused?.reason}\n`)
}

/* ── 4. wait for the engine to notice ───────────────────────────────────── */

console.log('  ── 4. wait for the graph to find the edge ──\n')
console.log('  Waiting on the gateway\'s OWN published ceiling to change — not on a')
console.log('  fixed sleep. A sleep works in rehearsal and fails on stage once.\n')

const startCeiling = String(inflated['ceiling'])
const deadline = Date.now() + CATCH_TIMEOUT * 1000
let caughtCeiling: string | undefined

while (Date.now() < deadline) {
  const now = await tabState()
  const ceiling = String(now['ceiling'])
  if (ceiling !== startCeiling) {
    caughtCeiling = ceiling
    console.log(`  ceiling moved   ${startCeiling} → ${ceiling}`)
    break
  }
  await new Promise((r) => setTimeout(r, 10_000))
  process.stdout.write('.')
}

if (!caughtCeiling) {
  console.log(`
  NOT CAUGHT within ${CATCH_TIMEOUT}s.

  This is a real result, not a script failure, and it means one of three things:

    1. \`pnpm engine\` is not running, so nothing recomputed. Check that first.
    2. The window has not closed yet, so the manufactured revenue is not in a
       CLOSED window and the engine correctly ignores it.
    3. The graph did not classify this payer as controlled. That is the
       interesting case and it is a finding about the RULES, not the demo —
       report what the engine printed rather than adjusting the attack until it
       gets caught.

  Nothing was lost either way: the float is untouched and every payment above
  settled honestly.
`)
  attacker.close()
  process.exit(1)
}

/* ── 5. the next spend ──────────────────────────────────────────────────── */

console.log('\n  ── 5. spend again ──\n')

const afterSpend = await spend('/summarise', honestSeller)
const state = await tabState()

if (afterSpend.refused) {
  console.log(`  REFUSED         [${afterSpend.refused.rule}]`)
  console.log(`                  ${afterSpend.refused.reason}`)
  console.log(`  guidance        ${afterSpend.refused.guidance}`)
  console.log(`  retryable       ${afterSpend.refused.retryable}`)
  console.log(`
  The refusal came from the real fast path, reading a ceiling the real engine
  published to HCS. No test hook, no privileged call, no seeded row. The float
  is untouched: balance ${state['balance']}, ceiling ${state['ceiling']}.

  Every payment in this script was genuine and would pass any signature check.
  What failed was the ACCOUNTING claim built on top of them — which is the only
  thing that could have failed, and the reason the graph exists.
`)
} else if (afterSpend.paid) {
  console.log(`  STILL CLEARED   ${afterSpend.paid.amount} to ${afterSpend.paid.seller}`)
  console.log(`
  The ceiling moved but the spend was still allowed. Report this as-is: the
  ceiling shrank without shrinking far enough to bind, which is a finding about
  the parameters rather than a failure of the mechanism. Do not tune the attack
  until it produces a refusal — tune nothing, and say what happened.
`)
} else {
  console.log(`  ERROR           ${afterSpend.error ?? JSON.stringify(afterSpend)}`)
}

attacker.close()
process.exit(0)
