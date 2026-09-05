/**
 * Probe 8 — a typed receipt survives a real HCS round trip.
 *
 * The receipt topic has only ever held `bootstrap.hello`. This writes a real
 * @tab/protocol receipt, reads it back through Mirror Node, and replays the
 * whole topic to confirm a replay survives the stray message already on it.
 *
 *   pnpm probe:protocol
 */
import { clientFromEnv, submitMessage } from '@tab/hedera'
import {
  MirrorClient, configureGlobalHttp, decodeUtf8, readTopic, reassembleChunks,
} from '@tab/mirror'
import { decode, encode, type DebitReceipt } from '@tab/protocol'

configureGlobalHttp({ connectTimeoutMs: 60_000 })

const topic = process.env['TOPIC_RECEIPTS']
if (!topic) throw new Error('TOPIC_RECEIPTS missing')

const tab = clientFromEnv()
const mirror = new MirrorClient({ network: tab.network, timeoutMs: 45_000, maxRetries: 4 })

const receipt: DebitReceipt = {
  v: 1, t: 'debit', tab: tab.operatorId.toString(), w: 148,
  cp: process.env['X402_SELLER_ID'] ?? '0.0.10379572',
  amt: '-0.040000',
  hold: `h_${Date.now().toString(36)}`,
  req: 'a1b2c3d4e5f6',
  tx: `${tab.operatorId.toString()}@${Math.floor(Date.now() / 1000)}.000000000`,
}

const bytes = encode(receipt)
console.log(`\nProbe 8 — typed receipt on HCS\n`)
console.log(`  topic               ${topic}`)
console.log(`  encoded size        ${bytes.length} bytes (single-chunk limit 1024)`)

const sent = await submitMessage(tab.client, topic, bytes, tab.operatorKey)
console.log(`  submitted           seq ${sent.sequenceNumber} · ${sent.chunks} chunk(s)`)

process.stdout.write('  waiting for mirror  ')
let found: ReturnType<typeof decode> | null = null
for (let i = 0; i < 15; i++) {
  await new Promise((r) => setTimeout(r, 2500))
  process.stdout.write('.')
  const walk = await readTopic(mirror, { topicId: topic })
  const { assembled } = reassembleChunks(walk.items)
  const last = assembled[assembled.length - 1]
  if (last && last.sequenceNumber === sent.sequenceNumber) {
    found = decode(decodeUtf8(last.payload))
    break
  }
}
console.log()

if (!found) {
  console.error('\n  FAIL — the receipt never appeared on Mirror Node.\n')
  tab.close()
  process.exit(1)
}
if (!found.ok) {
  console.error(`\n  FAIL — read back but did not parse: ${found.reason}\n`)
  tab.close()
  process.exit(1)
}
console.log(`  read back           t=${found.message.t} amt=${'amt' in found.message ? found.message.amt : '-'}`)

// A replay must survive the bootstrap.hello already on this topic.
const walk = await readTopic(mirror, { topicId: topic })
const { assembled } = reassembleChunks(walk.items)
let typed = 0
let skipped = 0
for (const m of assembled) {
  if (decode(decodeUtf8(m.payload)).ok) typed++
  else skipped++
}
console.log(`\n  full replay         ${assembled.length} messages · ${typed} typed · ${skipped} skipped`)
console.log(`  ${skipped > 0 ? 'Replay survived the pre-schema bootstrap.hello messages.' : ''}`)

const ok = typed >= 1
console.log(`\n  ${ok ? 'PASS' : 'FAIL'} — HCS carries typed receipts.`)
console.log(`  HashScan: https://hashscan.io/${tab.network}/topic/${topic}\n`)
tab.close()
process.exit(ok ? 0 : 1)
