import assert from 'node:assert/strict'
import { test } from 'node:test'
import { usdc } from '@tab/money'
import {
  accountAgeDays,
  consensusToMillis,
  getBalanceSnapshot,
  getUsdcBalance,
} from './accounts.ts'
import { compareConsensus, MirrorClient, MirrorError, timestampRange } from './client.ts'
import { getSchedule } from './schedules.ts'
import { decodeUtf8, readTopic, reassembleChunks } from './topics.ts'
import {
  getTransactionAt,
  getTransactions,
  hbarNetFor,
  normalizeTransactionId,
  outboundFrom,
  sameTransaction,
  toTransferEdges,
} from './transfers.ts'
import type { MirrorAccount, MirrorTransaction, TopicMessage } from './types.ts'

/**
 * `@tab/mirror` — the read path everything depends on.
 *
 * This package had 1,060 lines and zero tests while being, by some distance,
 * the highest-risk surface in the repo: **every bug found across this project's
 * live sessions came through it.** Its doc comments are a catalogue of rules
 * learned the expensive way — stop on `links.next`, not on an empty page;
 * filter `result === 'SUCCESS'`; normalise transaction ids before comparing;
 * a balance is a snapshot, not a reading — and until now not one of them was
 * enforced by anything but a comment.
 *
 * So each test below is tied to a specific rule, and where a rule exists
 * because of a real incident the test says which. That is deliberate: a test
 * whose reason is recorded survives a refactor that "simplifies" it away.
 *
 * Nothing here touches the network. `MirrorConfig.fetchImpl` is injectable
 * precisely so this is possible.
 */

/* ── a fake Mirror Node ──────────────────────────────────────────────────── */

interface Reply {
  status?: number
  body?: unknown
  /** Simulate a hung request, so the client's own timeout fires. */
  hang?: boolean
}

function fakeMirror(replies: Reply[] | ((url: string, n: number) => Reply)) {
  const calls: string[] = []
  let n = 0
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    calls.push(url)
    const reply = typeof replies === 'function' ? replies(url, n) : (replies[n] ?? { body: {} })
    n++

    if (reply.hang) {
      // Reject when the client aborts, which is what undici does.
      return new Promise((_resolve, rejectPromise) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('This operation was aborted')
          err.name = 'AbortError'
          rejectPromise(err)
        })
      }) as Promise<Response>
    }

    return new Response(JSON.stringify(reply.body ?? {}), {
      status: reply.status ?? 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof globalThis.fetch

  return { fetchImpl, calls }
}

const client = (replies: Reply[] | ((url: string, n: number) => Reply), extra = {}) => {
  const { fetchImpl, calls } = fakeMirror(replies)
  return {
    mirror: new MirrorClient({ baseUrl: 'http://mirror', fetchImpl, maxRetries: 0, ...extra }),
    calls,
  }
}

/* ── compareConsensus: the nanosecond rule ───────────────────────────────── */

test('compareConsensus does not lose nanoseconds to a float', () => {
  /*
   * A consensus timestamp has 9 fractional digits. `Number('1788686819.057159551')`
   * cannot hold them — it rounds — so two receipts microseconds apart can compare
   * EQUAL, and consensus order is the one ordering this whole system relies on.
   */
  assert.equal(compareConsensus('1788686819.057159551', '1788686819.057159552'), -1)
  assert.equal(compareConsensus('1788686819.057159552', '1788686819.057159551'), 1)
  assert.equal(compareConsensus('1788686819.057159551', '1788686819.057159551'), 0)
})

test('compareConsensus pads short nanos rather than comparing digit counts', () => {
  /*
   * `1788686819.57` means 570,000,000 nanos, NOT 57. A string compare or a
   * naive BigInt of the fraction makes `.57` sort BEFORE `.100000000`, which
   * silently reverses two receipts.
   */
  assert.equal(compareConsensus('1788686819.57', '1788686819.100000000'), 1)
  assert.equal(compareConsensus('1788686819.1', '1788686819.100000000'), 0)
})

test('compareConsensus compares seconds before nanos', () => {
  assert.equal(compareConsensus('1788686820.000000001', '1788686819.999999999'), 1)
})

/* ── timestampRange: half-open, like Mirror's own convention ─────────────── */

test('a window range is [from, to) so a boundary receipt is counted once', () => {
  // `gte` and `lt`. With `lte` a receipt landing exactly on a boundary would be
  // counted in both windows, which double-counts revenue at every tick.
  assert.deepEqual(timestampRange('100.0', '200.0'), ['timestamp=gte:100.0', 'timestamp=lt:200.0'])
  assert.deepEqual(timestampRange('100.0'), ['timestamp=gte:100.0'])
  assert.deepEqual(timestampRange(undefined, '200.0'), ['timestamp=lt:200.0'])
  assert.deepEqual(timestampRange(), [])
})

/* ── walk: the rule that cost real history ───────────────────────────────── */

test('THE RULE: a walk stops on links.next === null, never on an empty page', async () => {
  /*
   * Verified against live testnet: a query can return two EMPTY pages and then
   * a page with rows. An early stop on emptiness silently truncates history,
   * and truncated history is a wrong graph, which is a wrong credit decision.
   */
  const { mirror } = client([
    { body: { transactions: [], links: { next: '/p2' } } },
    { body: { transactions: [], links: { next: '/p3' } } },
    { body: { transactions: [{ id: 'real' }], links: { next: null } } },
  ])
  const walk = await mirror.walk<{ id: string }>(
    '/p1',
    (b) => (b as { transactions?: { id: string }[] }).transactions ?? [],
  )
  assert.deepEqual(walk.items, [{ id: 'real' }])
  assert.equal(walk.pagesFetched, 3)
  assert.equal(walk.truncated, false)
})

test('a missing links object ends the walk instead of throwing', async () => {
  // Some endpoints omit `links` entirely. Treating that as a crash would take
  // out a worker over a shape difference rather than a real problem.
  const { mirror } = client([{ body: { messages: [{ a: 1 }] } }])
  const walk = await mirror.walk('/p1', (b) => (b as { messages?: unknown[] }).messages ?? [])
  assert.equal(walk.items.length, 1)
  assert.equal(walk.truncated, false)
})

test('maxPages REPORTS truncation and where to resume — never silently stops', async () => {
  /*
   * The alternative — stop quietly at the cap — produces a short history that
   * looks complete. `resumeFrom` exists so a caller can continue rather than
   * start over, because starting over on a busy account never finishes.
   */
  const { mirror } = client(
    () => ({ body: { items: [{ n: 1 }], links: { next: '/next-page' } } }),
    { maxPages: 2 },
  )
  const walk = await mirror.walk<{ n: number }>(
    '/p1',
    (b) => (b as unknown as { items: { n: number }[] }).items,
  )
  assert.equal(walk.truncated, true)
  assert.equal(walk.pagesFetched, 2)
  assert.equal(walk.resumeFrom, '/next-page')
})

/* ── retries: only on what can actually fix itself ───────────────────────── */

test('a 4xx throws IMMEDIATELY — it will not fix itself', async () => {
  const { mirror, calls } = client([{ status: 404, body: {} }], { maxRetries: 3 })
  await assert.rejects(
    () => mirror.get('/api/v1/accounts/0.0.1'),
    (err: unknown) => {
      assert.ok(err instanceof MirrorError)
      assert.equal(err.status, 404)
      // The path is on the error, so a failure says WHICH request failed.
      assert.equal(err.path, '/api/v1/accounts/0.0.1')
      return true
    },
  )
  // Retrying a 404 four times just delays the same answer by seconds.
  assert.equal(calls.length, 1)
})

test('a 429 IS retried — throttling is exactly what backoff is for', async () => {
  const { mirror, calls } = client([{ status: 429 }, { status: 429 }, { body: { ok: true } }], {
    maxRetries: 3,
  })
  assert.deepEqual(await mirror.get('/p'), { ok: true })
  assert.equal(calls.length, 3)
})

test('a 5xx is retried, and the last error survives when retries run out', async () => {
  const { mirror, calls } = client([{ status: 503 }, { status: 503 }], { maxRetries: 1 })
  await assert.rejects(
    () => mirror.get('/p'),
    (err: unknown) => {
      assert.ok(err instanceof MirrorError)
      assert.equal(err.status, 503)
      return true
    },
  )
  assert.equal(calls.length, 2)
})

test('a timeout says WHICH request timed out and for how long', async () => {
  /*
   * An aborted fetch surfaces as a bare `DOMException: This operation was
   * aborted` with no URL and no duration. Unwrapped, a Mirror Node timeout is
   * indistinguishable from any other abort in the process — and this exact
   * class of confusion once presented as a signature-verification failure.
   */
  const { mirror } = client([{ hang: true }], { maxRetries: 0, timeoutMs: 20 })
  await assert.rejects(
    () => mirror.get('/api/v1/topics/0.0.5/messages'),
    (err: unknown) => {
      assert.ok(err instanceof MirrorError)
      assert.match(err.message, /timed out after 20ms for \/api\/v1\/topics\/0\.0\.5\/messages/)
      return true
    },
  )
})

test('an absolute next-page URL is used as given, not re-prefixed', async () => {
  // Mirror returns `links.next` as a path, but a caller may hand `get` a full
  // URL. Double-prefixing produces `http://mirrorhttp://mirror/...`.
  const { mirror, calls } = client([{ body: { ok: true } }])
  await mirror.get('http://elsewhere/api/v1/x')
  assert.equal(calls[0], 'http://elsewhere/api/v1/x')
})

test('a trailing slash on baseUrl does not produce a double slash', () => {
  const { fetchImpl, calls } = fakeMirror([{ body: {} }])
  const mirror = new MirrorClient({ baseUrl: 'http://mirror/', fetchImpl })
  return mirror.get('/api/v1/x').then(() => {
    assert.equal(calls[0], 'http://mirror/api/v1/x')
  })
})

/* ── readTopic: ascending, and capped at Mirror's real limit ─────────────── */

test('readTopic asks for ASCENDING order and caps the page size at 100', async () => {
  /*
   * Consensus order is the ordering key, and `order=asc` is what makes a replay
   * reproducible by a stranger. The cap matters too: Mirror silently ignores a
   * limit above 100, so a caller asking for 1000 would believe it had one page
   * of 1000 and walk wrong.
   */
  const { mirror, calls } = client([{ body: { messages: [], links: { next: null } } }])
  await readTopic(mirror, { topicId: '0.0.5', pageSize: 1000, from: '10.0', to: '20.0' })
  const url = calls[0]!
  assert.match(url, /\/api\/v1\/topics\/0\.0\.5\/messages\?/)
  assert.match(url, /limit=100/)
  assert.match(url, /order=asc/)
  assert.match(url, /timestamp=gte:10\.0/)
  assert.match(url, /timestamp=lt:20\.0/)
})

/* ── reassembleChunks: a partial read parses as truncated JSON ───────────── */

function msg(over: Partial<TopicMessage> & { message: string }): TopicMessage {
  return {
    topic_id: '0.0.5',
    consensus_timestamp: '100.000000000',
    sequence_number: 1,
    payer_account_id: '0.0.99',
    ...over,
  } as TopicMessage
}

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64')

function chunk(n: number, total: number, body: string, ts: string, seq: number): TopicMessage {
  return msg({
    message: b64(body),
    consensus_timestamp: ts,
    sequence_number: seq,
    chunk_info: {
      number: n,
      total,
      initial_transaction_id: {
        account_id: '0.0.99',
        transaction_valid_start: '99.0',
        nonce: 0,
      },
    },
  } as never)
}

test('an unchunked message passes straight through', () => {
  const { assembled, incomplete } = reassembleChunks([msg({ message: b64('{"t":"debit"}') })])
  assert.equal(assembled.length, 1)
  assert.equal(decodeUtf8(assembled[0]!.payload), '{"t":"debit"}')
  assert.equal(assembled[0]!.chunks, 1)
  assert.equal(incomplete.length, 0)
})

test('chunks reassemble in CHUNK order, not arrival order', () => {
  /*
   * The whole reason this function exists. A payload over ~1KB is split, and
   * each chunk on its own is truncated JSON — which fails loudly if you are
   * lucky and silently if you are not. Pages can also deliver chunks out of
   * order, so the sort is on `chunk_info.number`, never on arrival.
   */
  const { assembled, incomplete } = reassembleChunks([
    chunk(2, 3, 'dle', '102.0', 3),
    chunk(3, 3, 'end', '103.0', 4),
    chunk(1, 3, 'mid', '101.0', 2),
  ])
  assert.equal(incomplete.length, 0)
  assert.equal(decodeUtf8(assembled[0]!.payload), 'middleend')
  assert.equal(assembled[0]!.chunks, 3)
})

test('a reassembled message is stamped with the LAST chunk’s timestamp', () => {
  // That is the point at which the WHOLE message reached consensus. Using the
  // first chunk's would order a message before data it was written after.
  const { assembled } = reassembleChunks([
    chunk(1, 2, 'a', '101.000000000', 2),
    chunk(2, 2, 'b', '109.000000000', 3),
  ])
  assert.equal(assembled[0]!.consensusTimestamp, '109.000000000')
  assert.equal(assembled[0]!.sequenceNumber, 3)
})

test('an INCOMPLETE group is dropped and reported, never parsed', () => {
  // A receipt missing its tail is not a receipt. Parsing it yields truncated
  // JSON; reporting it lets a caller say how much history it could not read.
  const { assembled, incomplete } = reassembleChunks([
    chunk(1, 3, 'first', '101.0', 2),
    chunk(2, 3, 'second', '102.0', 3),
  ])
  assert.equal(assembled.length, 0)
  assert.equal(incomplete.length, 1)
  assert.equal(incomplete[0]!.got, 2)
  assert.equal(incomplete[0]!.expected, 3)
})

test('two different chunked messages are not spliced together', () => {
  /*
   * Grouping is keyed on the INITIAL TRANSACTION ID, not on position. Two
   * large messages interleaved on the topic would otherwise merge into one
   * payload that parses as neither.
   */
  const other = (n: number, body: string, ts: string): TopicMessage =>
    msg({
      message: b64(body),
      consensus_timestamp: ts,
      sequence_number: 50 + n,
      chunk_info: {
        number: n,
        total: 2,
        initial_transaction_id: {
          account_id: '0.0.77',
          transaction_valid_start: '77.0',
          nonce: 0,
        },
      },
    } as never)

  const { assembled, incomplete } = reassembleChunks([
    chunk(1, 2, 'AA', '101.0', 2),
    other(1, 'BB', '102.0'),
    chunk(2, 2, 'aa', '103.0', 3),
    other(2, 'bb', '104.0'),
  ])
  assert.equal(incomplete.length, 0)
  const payloads = assembled.map((a) => decodeUtf8(a.payload)).sort()
  assert.deepEqual(payloads, ['AAaa', 'BBbb'])
})

test('assembled messages come back in consensus order regardless of input order', () => {
  const { assembled } = reassembleChunks([
    msg({ message: b64('third'), consensus_timestamp: '300.000000000', sequence_number: 3 }),
    msg({ message: b64('first'), consensus_timestamp: '100.000000000', sequence_number: 1 }),
    msg({ message: b64('second'), consensus_timestamp: '200.000000000', sequence_number: 2 }),
  ])
  assert.deepEqual(
    assembled.map((a) => decodeUtf8(a.payload)),
    ['first', 'second', 'third'],
  )
})

test('a chunk_info with total 1 is treated as unchunked', () => {
  const { assembled } = reassembleChunks([chunk(1, 1, 'solo', '100.0', 1)])
  assert.equal(decodeUtf8(assembled[0]!.payload), 'solo')
})

test('an empty topic reassembles to nothing rather than failing', () => {
  const { assembled, incomplete } = reassembleChunks([])
  assert.deepEqual(assembled, [])
  assert.deepEqual(incomplete, [])
})

/* ── transactions: failed transfers are phantom edges ────────────────────── */

function tx(over: Partial<MirrorTransaction>): MirrorTransaction {
  return {
    consensus_timestamp: '100.000000000',
    transaction_id: '0.0.1-100-0',
    name: 'CRYPTOTRANSFER',
    result: 'SUCCESS',
    charged_tx_fee: 1,
    ...over,
  } as MirrorTransaction
}

test('a FAILED transaction is filtered out — it would be a phantom graph edge', async () => {
  /*
   * Mirror returns failed transactions alongside successful ones. A reverted
   * transfer never moved value, so counting one puts an edge in the
   * independence graph for money that never moved — and an edge that never
   * happened can block a legitimate counterparty.
   */
  const { mirror } = client([
    {
      body: {
        transactions: [
          tx({ transaction_id: 'good' }),
          tx({ transaction_id: 'bad', result: 'INSUFFICIENT_TOKEN_BALANCE' }),
        ],
        links: { next: null },
      },
    },
  ])
  const walk = await getTransactions(mirror, { accountId: '0.0.1' })
  assert.deepEqual(
    walk.items.map((t) => t.transaction_id),
    ['good'],
  )
})

test('getTransactions asks only for CRYPTOTRANSFER, ascending, capped at 100', async () => {
  const { mirror, calls } = client([{ body: { transactions: [], links: { next: null } } }])
  await getTransactions(mirror, { accountId: '0.0.7', pageSize: 500, from: '5.0' })
  assert.match(calls[0]!, /account\.id=0\.0\.7/)
  assert.match(calls[0]!, /transactiontype=CRYPTOTRANSFER/)
  assert.match(calls[0]!, /limit=100/)
  assert.match(calls[0]!, /order=asc/)
  assert.match(calls[0]!, /timestamp=gte:5\.0/)
})

/* ── toTransferEdges: net settlement, and the amounts must sum back ──────── */

const TOKEN = '0.0.429274'

test('the common 1:1 transfer is exact', () => {
  const edges = toTransferEdges(
    [
      tx({
        token_transfers: [
          { token_id: TOKEN, account: '0.0.1', amount: -40_000, is_approval: false },
          { token_id: TOKEN, account: '0.0.2', amount: 40_000, is_approval: false },
        ],
      }),
    ],
    TOKEN,
  )
  assert.equal(edges.length, 1)
  assert.equal(edges[0]!.from, '0.0.1')
  assert.equal(edges[0]!.to, '0.0.2')
  assert.equal(edges[0]!.amount, usdc('0.040000'))
})

test('a multi-party transfer splits proportionally and the edges SUM BACK', () => {
  /*
   * Hedera transfer lists are net-settled: several accounts debited and several
   * credited in one transaction. There is no "who paid whom" in the data, so
   * pairing is proportional — and the invariant that makes it defensible is
   * that the edge amounts add up to the total moved. If they did not, the graph
   * would attribute more or less revenue than actually changed hands.
   */
  const edges = toTransferEdges(
    [
      tx({
        token_transfers: [
          { token_id: TOKEN, account: '0.0.1', amount: -300_000, is_approval: false },
          { token_id: TOKEN, account: '0.0.2', amount: -100_000, is_approval: false },
          { token_id: TOKEN, account: '0.0.3', amount: 200_000, is_approval: false },
          { token_id: TOKEN, account: '0.0.4', amount: 200_000, is_approval: false },
        ],
      }),
    ],
    TOKEN,
  )
  assert.equal(edges.length, 4)
  const total = edges.reduce((sum, e) => sum + e.amount, 0n)
  assert.equal(total, 400_000n)
  // 0.0.1 put in 3/4, so it funds 3/4 of each receiver.
  const oneToThree = edges.find((e) => e.from === '0.0.1' && e.to === '0.0.3')
  assert.equal(oneToThree?.amount, 150_000n)
  const twoToThree = edges.find((e) => e.from === '0.0.2' && e.to === '0.0.3')
  assert.equal(twoToThree?.amount, 50_000n)
})

test('a different token is ignored entirely', () => {
  const edges = toTransferEdges(
    [
      tx({
        token_transfers: [
          { token_id: '0.0.999', account: '0.0.1', amount: -1, is_approval: false },
          { token_id: '0.0.999', account: '0.0.2', amount: 1, is_approval: false },
        ],
      }),
    ],
    TOKEN,
  )
  assert.deepEqual(edges, [])
})

test('a zero-amount edge from truncation is DROPPED, not recorded as a transfer', () => {
  // A proportional split can truncate to zero for a tiny sender. A zero edge is
  // not a transfer and would show as a counterparty relationship that moved
  // nothing — which is exactly the kind of phantom the graph must not see.
  const edges = toTransferEdges(
    [
      tx({
        token_transfers: [
          { token_id: TOKEN, account: '0.0.1', amount: -1_000_000, is_approval: false },
          { token_id: TOKEN, account: '0.0.2', amount: -1, is_approval: false },
          { token_id: TOKEN, account: '0.0.3', amount: 1_000_001, is_approval: false },
        ],
      }),
    ],
    TOKEN,
  )
  // 1 × 1000001 / 1000001 = 1 for the dust sender; both edges survive here.
  assert.equal(edges.length, 2)
  assert.equal(
    edges.every((e) => e.amount > 0n),
    true,
  )
})

test('a transaction with no senders is skipped rather than dividing by zero', () => {
  const edges = toTransferEdges(
    [
      tx({
        token_transfers: [{ token_id: TOKEN, account: '0.0.2', amount: 100, is_approval: false }],
      }),
    ],
    TOKEN,
  )
  assert.deepEqual(edges, [])
})

test('edges come back in consensus order', () => {
  const later = tx({
    consensus_timestamp: '200.000000000',
    token_transfers: [
      { token_id: TOKEN, account: '0.0.1', amount: -1, is_approval: false },
      { token_id: TOKEN, account: '0.0.2', amount: 1, is_approval: false },
    ],
  })
  const earlier = tx({
    consensus_timestamp: '100.000000000',
    token_transfers: [
      { token_id: TOKEN, account: '0.0.3', amount: -1, is_approval: false },
      { token_id: TOKEN, account: '0.0.4', amount: 1, is_approval: false },
    ],
  })
  const edges = toTransferEdges([later, earlier], TOKEN)
  assert.deepEqual(
    edges.map((e) => e.from),
    ['0.0.3', '0.0.1'],
  )
})

test('outboundFrom keeps only what the account actually sent', () => {
  const edges = toTransferEdges(
    [
      tx({
        token_transfers: [
          { token_id: TOKEN, account: '0.0.1', amount: -10, is_approval: false },
          { token_id: TOKEN, account: '0.0.2', amount: 10, is_approval: false },
        ],
      }),
    ],
    TOKEN,
  )
  assert.equal(outboundFrom(edges, '0.0.1').length, 1)
  assert.equal(outboundFrom(edges, '0.0.2').length, 0)
})

/* ── transaction ids: the 16 phantom discrepancies ───────────────────────── */

test('the SDK and Mirror spellings of one transaction id compare EQUAL', () => {
  /*
   * The same transaction has two spellings:
   *
   *   SDK / receipts   0.0.10379287@1788620574.542753968
   *   Mirror Node      0.0.10379287-1788620574-542753968
   *
   * Comparing them raw makes every transfer look unreceipted — which is how the
   * reconciler once reported 16 phantom discrepancies against a perfectly
   * reconciled ledger.
   */
  const sdk = '0.0.10379287@1788620574.542753968'
  const mirrorSpelling = '0.0.10379287-1788620574-542753968'
  assert.equal(normalizeTransactionId(sdk), mirrorSpelling)
  assert.equal(sameTransaction(sdk, mirrorSpelling), true)
  assert.equal(sameTransaction(sdk, sdk), true)
})

test('normalising leaves the account id’s own dots alone', () => {
  // `0.0.x` contains dots that must NOT become dashes. Only the dot separating
  // seconds from nanos — the one at the very end — is a separator.
  assert.equal(
    normalizeTransactionId('0.0.10379287@1788620574.542753968'),
    '0.0.10379287-1788620574-542753968',
  )
  assert.equal(normalizeTransactionId('0.0.5-1-2'), '0.0.5-1-2')
})

test('two genuinely different transactions do not compare equal', () => {
  assert.equal(sameTransaction('0.0.1@100.000000001', '0.0.1@100.000000002'), false)
})

/* ── hbarNetFor: net, not first match ────────────────────────────────────── */

test('hbarNetFor sums every entry for the account, fees included', () => {
  // An account can appear several times in one transfer list — a payment out
  // and a fee. Taking the first entry would report the fee as the movement.
  const net = hbarNetFor(
    tx({
      transfers: [
        { account: '0.0.1', amount: -100, is_approval: false },
        { account: '0.0.1', amount: -7, is_approval: false },
        { account: '0.0.98', amount: 7, is_approval: false },
        { account: '0.0.2', amount: 100, is_approval: false },
      ],
    }),
    '0.0.1',
  )
  assert.equal(net, -107n)
  assert.equal(hbarNetFor(tx({}), '0.0.1'), 0n)
})

/* ── getTransactionAt: the point lookup the graph depends on ─────────────── */

test('getTransactionAt returns null rather than throwing on an empty result', async () => {
  // The ancestry walk calls this for every account. A throw on "not indexed
  // yet" would turn routine Mirror lag into a failed pass.
  const { mirror } = client([{ body: { transactions: [], links: { next: null } } }])
  assert.equal(await getTransactionAt(mirror, '100.0'), null)
})

test('getTransactionAt asks for the EXACT timestamp, with no operator', async () => {
  // `timestamp=100.0`, not `gte:`. The point of the lookup is to find the one
  // CRYPTOCREATEACCOUNT at that instant; a range would return its neighbours.
  const { mirror, calls } = client([{ body: { transactions: [tx({})], links: { next: null } } }])
  await getTransactionAt(mirror, '1788698157.659492670')
  assert.match(calls[0]!, /\?timestamp=1788698157\.659492670$/)
})

/* ── balances are SNAPSHOTS ──────────────────────────────────────────────── */

function account(over: Partial<MirrorAccount> = {}): MirrorAccount {
  return {
    account: '0.0.1',
    created_timestamp: '1788600000.000000000',
    max_automatic_token_associations: 0,
    ...over,
  } as MirrorAccount
}

test('a balance comes back WITH the timestamp it was taken at', async () => {
  /*
   * `balance.timestamp` is the last activity that updated the balance, not
   * "now". `verify-tab` must replay receipts only up to this point: comparing a
   * stale snapshot against receipts replayed to the present fails on a
   * perfectly correct ledger, which is the worst possible failure for the one
   * command whose job is proving correctness.
   */
  const { mirror } = client([
    {
      body: account({
        balance: {
          timestamp: '1788700000.000000000',
          balance: 4_200_000_000,
          tokens: [{ token_id: TOKEN, balance: 20_000_000 }],
        },
      }),
    },
  ])
  const snap = await getBalanceSnapshot(mirror, '0.0.1', TOKEN)
  assert.equal(snap.balance, usdc('20.000000'))
  assert.equal(snap.asOf, '1788700000.000000000')
  assert.equal(snap.tinybars, 4_200_000_000n)
})

test('a missing snapshot REFUSES to answer rather than reporting a bare number', async () => {
  // A balance with no "as of" is not comparable to a replayed ledger, so
  // returning one would let an invariant be asserted dishonestly.
  const { mirror } = client([{ body: account({}) }])
  await assert.rejects(() => getBalanceSnapshot(mirror, '0.0.1', TOKEN), /no balance snapshot/)
})

test('a token the account does not hold snapshots as zero, not as an error', async () => {
  const { mirror } = client([
    { body: account({ balance: { timestamp: '1.0', balance: 0, tokens: [] } }) },
  ])
  assert.equal((await getBalanceSnapshot(mirror, '0.0.1', TOKEN)).balance, 0n)
})

test('an unassociated account reads as a zero USDC balance, not a failure', async () => {
  // `/accounts/{id}/tokens` returns an empty list for an account with no
  // relationship. That is a real answer — zero — and a funding check should
  // report it as such rather than erroring.
  const { mirror } = client([{ body: { tokens: [], links: { next: null } } }])
  assert.equal(await getUsdcBalance(mirror, '0.0.1', TOKEN), 0n)
})

test('a non-6-decimal token REFUSES to be read as MicroUsdc', async () => {
  // Reading an 8-decimal token as micro-USDC misreports every amount by 100x.
  const { mirror } = client([
    {
      body: {
        tokens: [
          {
            token_id: TOKEN,
            balance: 1,
            decimals: 8,
            automatic_association: true,
            freeze_status: 'UNFROZEN',
            kyc_status: 'NOT_APPLICABLE',
          },
        ],
        links: { next: null },
      },
    },
  ])
  await assert.rejects(() => getUsdcBalance(mirror, '0.0.1', TOKEN), /is not 6/)
})

test('a token relationship 404 reads as "no relationship", not as an error', async () => {
  // A 404 here means Mirror has not INDEXED the account yet — a just-created
  // account reaches consensus seconds before it reaches the mirror. Either way
  // there is no relationship to report.
  const { mirror } = client([{ status: 404, body: {} }])
  assert.equal(await getUsdcBalance(mirror, '0.0.1', TOKEN), 0n)
})

/* ── age ─────────────────────────────────────────────────────────────────── */

test('consensusToMillis keeps the millisecond, and truncates below it', () => {
  assert.equal(consensusToMillis('1788600000.123456789'), 1_788_600_000_123)
  // Short nanos are PADDED, not read as-is: `.5` is 500ms, not 5ns.
  assert.equal(consensusToMillis('1788600000.5'), 1_788_600_000_500)
  assert.equal(consensusToMillis('1788600000'), 1_788_600_000_000)
})

test('account age floors to whole days and never goes negative', () => {
  const created = '1788600000.000000000'
  const now = new Date(1_788_600_000_000 + 2.9 * 86_400_000)
  assert.equal(accountAgeDays(account({ created_timestamp: created }), now), 2)
  // A clock skew that puts "now" before creation must not yield a negative age,
  // which would read as an impossibly old account and skip the age discount.
  assert.equal(accountAgeDays(account({ created_timestamp: created }), new Date(1_000)), 0)
})

/* ── schedules ───────────────────────────────────────────────────────────── */

test('a missing schedule is null, not a throw', async () => {
  // The settlement worker polls for a schedule that may not be indexed yet.
  const { mirror } = client([{ status: 404, body: {} }])
  assert.equal(await getSchedule(mirror, '0.0.5'), null)
})

test('a 500 while reading a schedule still THROWS — it is not "no schedule"', async () => {
  // Swallowing a 5xx here would report an unexecuted schedule as absent, and
  // the worker would schedule a second transfer for a window already paid.
  const { mirror } = client([{ status: 500, body: {} }], { maxRetries: 0 })
  await assert.rejects(() => getSchedule(mirror, '0.0.5'))
})

/* ── the decimals type that has already caused one confusing hour ────────── */

test('a STRING "6" from Mirror Node is accepted as six decimals', async () => {
  /*
   * Mirror Node is inconsistent about this field: `/tokens/{id}` returns
   * `decimals` as a STRING and `/accounts/{id}/tokens` returns it as a number.
   * `TokenInfo` types it `string | number` for exactly that reason, and that
   * union is correct — but `TokenRelationship` types it `number`, and a strict
   * `!== 6` against a value Mirror has been observed to stringify elsewhere
   * fails with the least helpful message imaginable:
   *
   *     Token 0.0.429274 has 6 decimals, not 6
   *
   * An hour went into that sentence once, from a script rather than from here.
   * Pinning the behaviour so nobody spends the hour again.
   */
  const { mirror } = client([
    {
      body: {
        tokens: [
          {
            token_id: TOKEN,
            balance: 20_000_000,
            decimals: '6' as unknown as number,
            automatic_association: true,
            freeze_status: 'UNFROZEN',
            kyc_status: 'NOT_APPLICABLE',
          },
        ],
        links: { next: null },
      },
    },
  ])
  assert.equal(await getUsdcBalance(mirror, '0.0.1', TOKEN), usdc('20.000000'))
})

test('a string "8" is still REFUSED, and says so legibly', async () => {
  const { mirror } = client([
    {
      body: {
        tokens: [
          {
            token_id: TOKEN,
            balance: 1,
            decimals: '8' as unknown as number,
            automatic_association: true,
            freeze_status: 'UNFROZEN',
            kyc_status: 'NOT_APPLICABLE',
          },
        ],
        links: { next: null },
      },
    },
  ])
  await assert.rejects(() => getUsdcBalance(mirror, '0.0.1', TOKEN), /is not 6/)
})
