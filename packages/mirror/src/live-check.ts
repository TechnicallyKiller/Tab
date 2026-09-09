/**
 * Live check against real Hedera testnet. No credentials required — Mirror Node
 * is a public read-only API.
 *
 * This is Probe 4 from docs/probes.md, run for real, plus the read-only halves
 * of Probes 1 and 3. Run it with:
 *
 *   pnpm --filter @tab/mirror test:live
 */
import { format } from '@tab/money'
import {
  accountAgeDays,
  canReceiveToken,
  getAccount,
  getToken,
  getUsdcBalance,
} from './accounts.ts'
import { MirrorClient } from './client.ts'
import { readTopic, reassembleChunks } from './topics.ts'
import { getTransactions, toTransferEdges } from './transfers.ts'
import type { TransactionsPage } from './types.ts'

const USDC = '0.0.429274'
const USDC_TREASURY = '0.0.5176'

const client = new MirrorClient({ network: 'testnet' })
let failures = 0

async function check(name: string, fn: () => Promise<string>) {
  try {
    console.log(`  PASS  ${name}\n        ${await fn()}`)
  } catch (err) {
    failures++
    console.error(`  FAIL  ${name}\n        ${err instanceof Error ? err.message : String(err)}`)
  }
}

console.log('\nMirror Node live check — Hedera testnet, no credentials\n')

await check('testnet USDC exists and is 6 decimals', async () => {
  const token = await getToken(client, USDC)
  const decimals = Number(token.decimals)
  if (token.symbol !== 'USDC') throw new Error(`symbol is ${token.symbol}, expected USDC`)
  if (decimals !== 6) throw new Error(`decimals is ${decimals}, expected 6 — MicroUsdc assumes 6`)
  return `${token.symbol} "${token.name}" · ${decimals} dp · treasury ${token.treasury_account_id}`
})

await check('account age is readable for Sybil scoring', async () => {
  const account = await getAccount(client, USDC_TREASURY)
  const days = accountAgeDays(account)
  if (!account.created_timestamp) throw new Error('no created_timestamp')
  return `${account.account} created ${account.created_timestamp} · ${days}d old`
})

await check('association check answers before we send', async () => {
  const yes = await canReceiveToken(client, USDC_TREASURY, USDC)
  if (!yes.associated) throw new Error('treasury should be associated with its own token')
  // A brand-new account with no slots must come back as cannot-receive.
  const no = await canReceiveToken(client, '0.0.98', USDC)
  return (
    `treasury: associated=${yes.associated} canReceive=${yes.canReceive} · ` +
    `0.0.98: associated=${no.associated} canReceive=${no.canReceive} slots=${no.autoAssociationSlots}`
  )
})

await check('USDC balance reads as MicroUsdc', async () => {
  const balance = await getUsdcBalance(client, USDC_TREASURY, USDC)
  return `treasury holds ${format(balance)} USDC`
})

await check('pagination does not stop on an empty page', async () => {
  // The behaviour that would silently truncate history: pages can be empty in
  // the MIDDLE of a real result set. Walking must stop only on links.next=null.
  let pages = 0
  let empties = 0
  let rows = 0
  let path: string | null =
    `/api/v1/transactions?account.id=${USDC_TREASURY}&transactiontype=CRYPTOTRANSFER&limit=25&order=desc`
  while (path && pages < 8) {
    const body: TransactionsPage = await client.get(path)
    pages++
    const n = body.transactions?.length ?? 0
    rows += n
    if (n === 0) empties++
    path = body.links?.next ?? null
  }
  if (empties === 0) {
    return `${pages} pages, ${rows} rows, no empty pages this run (the hazard is real but intermittent)`
  }
  if (rows === 0) throw new Error('all pages empty — cannot demonstrate the mid-set case')
  return `${pages} pages · ${empties} EMPTY · ${rows} rows — stopping on the first empty page would have truncated`
})

await check('transfer history becomes graph edges', async () => {
  const walk = await getTransactions(client, { accountId: USDC_TREASURY, pageSize: 100 })
  const edges = toTransferEdges(walk.items, USDC)
  const sample = edges[0]
  return (
    `${walk.pagesFetched} pages · ${walk.items.length} successful txs · ${edges.length} USDC edges` +
    (sample ? ` · e.g. ${sample.from} → ${sample.to} ${format(sample.amount)}` : '') +
    (walk.truncated ? ' · TRUNCATED at maxPages' : '')
  )
})

await check('HCS topic replays in consensus order with chunks reassembled', async () => {
  const recent: TransactionsPage = await client.get(
    '/api/v1/transactions?transactiontype=CONSENSUSSUBMITMESSAGE&limit=10&order=desc',
  )
  const topicId = recent.transactions?.find((t) => t.entity_id)?.entity_id
  if (!topicId) throw new Error('no active topic found on testnet right now')

  const walk = await readTopic(client, { topicId, pageSize: 25 })
  const capped = walk.items.slice(0, 25)
  const { assembled, incomplete } = reassembleChunks(capped)
  const chunked = assembled.filter((a) => a.chunks > 1).length
  return (
    `topic ${topicId} · ${capped.length} messages → ${assembled.length} assembled ` +
    `(${chunked} multi-chunk, ${incomplete.length} incomplete)`
  )
})

console.log(
  failures === 0
    ? '\nAll live checks passed against real Hedera testnet.\n'
    : `\n${failures} live check(s) failed.\n`,
)
process.exit(failures === 0 ? 0 : 1)
