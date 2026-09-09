/**
 * One-time environment setup. Idempotent: re-running must not create a second
 * set of topics, because someone will run it twice.
 *
 * Prints values for .env rather than writing them — silently editing a
 * developer's env file is worse than making them paste three lines.
 *
 *   pnpm bootstrap
 */
import { clientFromEnv, createTopic, submitMessage } from '@tab/hedera'
import {
  canReceiveToken,
  decodeUtf8,
  getAccount,
  MirrorClient,
  readTopic,
  reassembleChunks,
} from '@tab/mirror'
import { format } from '@tab/money'

const USDC = '0.0.429274'

const TOPICS = [
  { env: 'TOPIC_RECEIPTS', memo: 'tab:receipts:v1 — one message per leg, debit and credit' },
  { env: 'TOPIC_CEILINGS', memo: 'tab:ceilings:v1 — ceiling updates with every input and a hash' },
  { env: 'TOPIC_SETTLEMENTS', memo: 'tab:settlements:v1 — window net, transfer id, ramp change' },
] as const

function existing(name: string): string | null {
  const value = process.env[name]
  if (!value || value.includes('xxxxx')) return null
  return value
}

const tab = clientFromEnv()
const mirror = new MirrorClient({ network: tab.network })

console.log(`\nBootstrap — Hedera ${tab.network}\n`)

// ── preflight ────────────────────────────────────────────────────────────────
const account = await getAccount(mirror, tab.operatorId.toString())
console.log(`  operator            ${account.account}`)
console.log(`  auto-assoc slots    ${account.max_automatic_token_associations}`)

const recv = await canReceiveToken(mirror, tab.operatorId.toString(), USDC)
console.log(`  USDC associated     ${recv.associated}`)
console.log(`  can receive USDC    ${recv.canReceive}${recv.reason ? ` — ${recv.reason}` : ''}`)

// ── topics ───────────────────────────────────────────────────────────────────
console.log('\n  Topics')
const results: { env: string; topicId: string; created: boolean }[] = []

for (const spec of TOPICS) {
  const already = existing(spec.env)
  if (already) {
    console.log(`    ${spec.env.padEnd(20)} ${already}  (already set — not recreated)`)
    results.push({ env: spec.env, topicId: already, created: false })
    continue
  }
  // Submit key = the operator, so the topic is an append-only log Tab owns.
  // Without it anyone can write a message a naive replay would count.
  const topic = await createTopic(tab.client, {
    memo: spec.memo,
    submitKey: tab.operatorKey,
    adminKey: tab.operatorKey,
  })
  console.log(`    ${spec.env.padEnd(20)} ${topic.topicId}  created`)
  results.push({ env: spec.env, topicId: topic.topicId, created: true })
}

// ── prove the round trip ─────────────────────────────────────────────────────
//
// Only on first creation. The receipt topic IS the ledger, so writing a
// bootstrap.hello into it on every run leaves permanent non-receipt messages
// that verify-tab then has to skip. A topic is append-only: there is no undo.
const receipts = results.find((r) => r.env === 'TOPIC_RECEIPTS')!
const anyCreated = results.some((r) => r.created) || process.argv.includes('--probe')

if (!anyCreated) {
  console.log('\n  Round trip           skipped — topics already exist, and the receipt')
  console.log('                       topic is the ledger. Re-run with --probe to force.')
  console.log(`\n  HashScan: https://hashscan.io/${tab.network}/topic/${receipts.topicId}\n`)
  tab.close()
  process.exit(0)
}

console.log('\n  Round trip')
const probe = JSON.stringify({
  v: 1,
  type: 'bootstrap.hello',
  note: 'topic reachable, submit key accepted, message replayable',
  at: new Date().toISOString(),
})
const submitted = await submitMessage(tab.client, receipts.topicId, probe, tab.operatorKey)
console.log(
  `    submitted           seq ${submitted.sequenceNumber} · ${submitted.chunks} chunk(s)`,
)

// Mirror Node lags consensus by a few seconds. That is expected, not an error.
process.stdout.write('    waiting for mirror  ')
let assembled: { payload: Uint8Array; sequenceNumber: number }[] = []
for (let attempt = 0; attempt < 12; attempt++) {
  await new Promise((r) => setTimeout(r, 2000))
  process.stdout.write('.')
  const walk = await readTopic(mirror, { topicId: receipts.topicId })
  const out = reassembleChunks(walk.items)
  if (out.assembled.length > 0) {
    assembled = out.assembled
    break
  }
}
console.log()

if (assembled.length === 0) {
  console.error('    FAILED — message never appeared on Mirror Node')
  tab.close()
  process.exit(1)
}
const last = assembled[assembled.length - 1]!
const readBack = JSON.parse(decodeUtf8(last.payload)) as { type: string }
console.log(`    read back           seq ${last.sequenceNumber} · type "${readBack.type}"`)

// ── output ───────────────────────────────────────────────────────────────────
console.log('\n  Paste into .env:\n')
for (const r of results) console.log(`    ${r.env}=${r.topicId}`)
console.log(`\n  HashScan: https://hashscan.io/${tab.network}/topic/${receipts.topicId}\n`)

void format
tab.close()
