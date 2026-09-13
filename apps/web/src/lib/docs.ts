/**
 * The docs, derived from the code they describe.
 *
 * This replaces `lib/mock/docs.ts`, which documented an API that does not
 * exist: `Tab.register()` (there is no such method), `npm i @tab/sdk` (never
 * published), a $1.0000 starter ceiling (it is 0.2500), and a `0.0.4482091`
 * account that appears on no topic. A developer following it failed on line
 * one — which is worse than having no docs at all, because it costs them the
 * time to find out.
 *
 * So the numbers come from `@tab/params` and the refusal codes from
 * `@tab/protocol`, the same values the engine computes under and the gateway
 * refuses with. There is no second copy to drift.
 */

import { params } from '@tab/params'
import {
  BLOCKING_REASONS,
  isRetryable,
  REFUSAL_CODES,
  REFUSAL_GUIDANCE,
  WEIGHT_REASON_DETAIL,
} from '@tab/protocol'

/*
 * Straight from the frozen set, which stores them as decimal strings already.
 * Trimmed to the console's four places — truncated, never rounded, which is the
 * same convention every amount on screen follows.
 */
const four = (usdc: string) => usdc.slice(0, usdc.indexOf('.') + 5)

const PER_CALL = four(params.caps.perCallUsdc)
const STARTER = four(params.caps.starterCeilingUsdc)

export const QUICKSTART = [
  {
    n: '1',
    title: 'Read a tab — no install, no key, no account',
    body:
      'Every figure the console shows is served over plain HTTP from published data. ' +
      'Nothing here is privileged: try it against the live testnet gateway right now. ' +
      `A brand-new tab starts at a ${STARTER} floor.`,
    lang: 'bash',
    code: `curl https://tab-gateway.onrender.com/v1/tabs/0.0.10390398

# {"balance":"4.750000","available":"0.250000",
#  "ceiling":"0.250000","perCallCap":"0.050000", ... }`,
  },
  {
    n: '2',
    title: 'Spend from it',
    body:
      'One POST. The agent holds no key and signs nothing — the gateway pays the seller ' +
      'on its behalf, against a ceiling the agent earned. You do not name a price: the ' +
      'seller states it in its x402 challenge and the gateway reads it.',
    lang: 'bash',
    code: `curl -X POST https://tab-gateway.onrender.com/v1/spend \\
  -H 'content-type: application/json' \\
  -d '{"tab":"0.0.10390398",
       "url":"https://tab-seller.onrender.com/feed/25"}'

# {"paid":{"amount":"0.050000","seller":"0.0.10379572",
#          "receiptSeq":60,"elapsedMs":4012}, "body":{...}}`,
  },
  {
    n: '3',
    title: 'Handle the refusal',
    body:
      'A refusal is a 200 with a rule, not an error to catch. It is the product working. ' +
      `Ask for more than the ${PER_CALL} per-call cap and watch it fire.`,
    lang: 'bash',
    code: `curl -X POST https://tab-gateway.onrender.com/v1/spend \\
  -H 'content-type: application/json' \\
  -d '{"tab":"0.0.10390398",
       "url":"https://tab-seller.onrender.com/feed/100"}'

# {"refused":{"rule":"PER_CALL_CAP",
#   "reason":"Spend of 0.2000 refused. The request exceeds
#             the per-call cap of 0.0500 in force for this tab.",
#   "evidence":{"requested":"0.2000","cap":"0.0500"},
#   "retryable":false}}`,
  },
  {
    n: '4',
    title: 'Check the arithmetic yourself',
    body:
      'The ceiling carries the inputs it was computed from and a hash of them. Rerun the ' +
      'scoring code on those inputs and you get the same hash — without our database, and ' +
      'without trusting this page.',
    lang: 'bash',
    code: `curl https://tab-gateway.onrender.com/v1/tabs/0.0.10390398/ceiling

# {"ceiling":"0.250000","binding":"starter_floor",
#  "model":"tab-v${params.version}","seq":55,
#  "hash":"c4289169bd1e...",
#  "inputs":{"revenue":"0.000746","tier":"Unrated", ... }}`,
  },
] as const

export const CALLOUTS = [
  {
    label: 'Note',
    tone: 'ink' as const,
    body:
      'Amounts are USDC with 6 decimals, carried as integer strings. Tab displays four and ' +
      'truncates — the truncation is deliberate and never rounds up.',
  },
  {
    label: 'Important',
    tone: 'pen' as const,
    body:
      '`max` is optional and omitting it is the normal case. The seller sets the price in its ' +
      '402 challenge; supply `max` only to refuse anything above a figure of your own.',
  },
  {
    label: 'Refuses',
    tone: 'caution' as const,
    body:
      'Spending can be refused. A refusal is a successful HTTP response carrying the rule, a ' +
      'plain reason, the evidence, and whether retrying could ever help.',
  },
  {
    label: 'Testnet',
    tone: 'debit' as const,
    body:
      'Everything here is Hedera testnet with a test USDC token. The money is not real; the ' +
      'consensus, the receipts and the arithmetic are.',
  },
]

export const SPEND_PARAMS = [
  {
    name: 'tab',
    type: 'string',
    meaning: 'Which tab pays. A Hedera account id, e.g. 0.0.10390398.',
  },
  {
    name: 'url',
    type: 'string',
    meaning: 'The x402 endpoint to call. The seller needs no knowledge of Tab.',
  },
  {
    name: 'max',
    type: 'Usdc?',
    meaning:
      'Optional. The most to pay for this one call, as a decimal string — never a float. ' +
      "Omit it to accept the seller's quoted price.",
  },
  {
    name: 'idempotencyKey',
    type: 'string?',
    meaning: 'Replays return the original result rather than spending twice.',
  },
]

/** The one thing not derivable: when each rule fires is prose, not data. */
const WHEN: Record<(typeof REFUSAL_CODES)[number], string> = {
  PER_CALL_CAP: `The request exceeds the ${PER_CALL} per-call cap in force for this tab.`,
  WINDOW_CAP: 'Window spend plus this request would pass the per-window cap.',
  CEILING_EXCEEDED: 'Outstanding plus holds plus this request would pass the ceiling.',
  CONTROL_CLUSTER: "The seller is inside the agent's funding ancestry within the hop limit.",
  SELLER_NOT_ALLOWLISTED: 'A Starter Tab may only buy from allowlisted sellers.',
  TAB_FROZEN: 'The tab is frozen pending operator review.',
}

/**
 * Derived from `@tab/protocol`, not retyped.
 *
 * The codes, the guidance and the retryability are one published interface, and
 * this page used to hold a second hand-written copy of it. The guidance strings
 * here are now literally the ones the gateway sends in the refusal.
 */
export const REFUSAL_CODES_DOC = REFUSAL_CODES.map((code: (typeof REFUSAL_CODES)[number]) => ({
  id: `code-${code.toLowerCase().replace(/_/g, '-')}`,
  code,
  when: WHEN[code],
  next: REFUSAL_GUIDANCE[code],
  retryable: isRetryable(code),
}))

/**
 * A real message from the receipts topic, copied verbatim.
 *
 * The previous version invented a shape — `"v": 2`, `"leg": "DEBIT"` — that
 * appears nowhere on the topic. This is what a replay actually yields, so
 * anyone writing a decoder against it will succeed.
 */
export const RECEIPT_SCHEMA = `{
  "kind": "refusal",
  "at": "1789101793.110272959",
  "window": 5963672,
  "seq": 63,
  "token": "0.0.429274",
  "counterparty": "0.0.10379572",
  "requested": "0.200000",
  "rule": "PER_CALL_CAP"
}`

/**
 * Build on Tab.
 *
 * Four surfaces over one gateway. They are deliberately the SAME ten verbs —
 * `@tab/sdk` defines the interface and the MCP server, the Agent Kit plugin and
 * the CLI all bind to it, which is what stops them drifting apart.
 *
 * Published to npm under `@0xdivyanshh/tab-*` rather than `@tab/*`: the `tab`
 * org belongs to someone else, so the packages are renamed at publish time by
 * tools/deploy/publish-npm.mjs and the workspace keeps its own names. The HTTP
 * API still needs no install at all, which is why the quickstart leads with
 * curl.
 */
export const BUILD_ON_TAB = [
  {
    id: 'build-mcp',
    title: 'MCP — give your own LLM a tab',
    body:
      'The shortest path to "my agent can spend money". Add this to Claude Desktop and the ' +
      'model gets seven tools: tab_balance, tab_quote, tab_ceiling, tab_counterparties, ' +
      'tab_receipts, tab_health and tab_spend. It holds no key and cannot produce a ' +
      'transaction — every spend goes through the gateway, against the ceiling.',
    lang: 'json',
    code: `{
  "mcpServers": {
    "tab": {
      "command": "npx",
      "args": ["-y", "@0xdivyanshh/tab-mcp"],
      "env": {
        "TAB_GATEWAY_URL": "https://tab-gateway.onrender.com",
        "TAB_ACCOUNT_ID": "0.0.10390398"
      }
    }
  }
}`,
  },
  {
    id: 'build-sdk',
    title: 'SDK — ten verbs, two of which act',
    body:
      'Eight read and two spend. The read methods return what was PUBLISHED rather than ' +
      'recomputing it: the package cannot import the scoring or graph code, so it is ' +
      'structurally incapable of offering a second opinion about a ceiling.',
    lang: 'typescript',
    code: `// npm i @0xdivyanshh/tab-sdk
import { createTab } from '@0xdivyanshh/tab-sdk'

const tab = createTab({ baseUrl: 'https://tab-gateway.onrender.com' })

const result = await tab.spend({
  tab: '0.0.10390398',
  url: 'https://tab-seller.onrender.com/feed/25',
  // max is optional — the seller's 402 sets the price
})

if (result.outcome === 'refused') {
  result.rule      // 'PER_CALL_CAP'
  result.guidance  // what to do instead
  result.retryable // false
}`,
  },
  {
    id: 'build-cli',
    title: 'CLI — the same verbs from a terminal',
    body:
      'A refusal exits ZERO, on purpose: it is a normal outcome, and a non-zero exit would ' +
      'teach every shell script that refusing is a fault.',
    lang: 'bash',
    code: `export TAB_GATEWAY_URL=https://tab-gateway.onrender.com
export TAB_ACCOUNT_ID=0.0.10390398

tab status
tab ceiling
tab counterparties
tab spend https://tab-seller.onrender.com/feed/25`,
  },
  {
    id: 'build-verify',
    title: 'Verify — recompute a published ceiling',
    body:
      'The claim this whole project rests on. It reads the ceiling topic through a public ' +
      'mirror node, reruns the real scoring code on the published inputs, and compares both ' +
      'the number and the hash. It needs no database and no credential of ours — which is ' +
      'the point, and why the scoring package has no I/O.',
    lang: 'bash',
    code: `TOPIC_CEILINGS=0.0.10182697 pnpm verify-ceiling

# checks
#   seq 55  0.250000  recomputed 0.250000  hash matches
#   ...`,
  },
] as const

/**
 * Navigation, pointing only at content that exists.
 *
 * The previous sidebar listed twenty-four entries across six groups for a
 * single page with seven anchors, so most of them pointed somewhere that did
 * not describe them: "TypeScript SDK", "MCP server" and "CLI" were three
 * separate links all resolving to `#spend`, and an entire "Trust" group
 * resolved to the refusal-code table.
 *
 * A nav that lies about what it leads to is worse than a short one. This lists
 * what is actually on the page, and the agent surfaces now have real anchors of
 * their own to point at.
 */
export const SIDEBAR = [
  {
    group: 'Start here',
    items: [
      { label: 'Quickstart', href: '#quickstart', active: true },
      { label: 'Reading the callouts', href: '#callouts' },
    ],
  },
  {
    group: 'Build on Tab',
    items: [
      { label: 'MCP server', href: '#build-mcp', active: true },
      { label: 'TypeScript SDK', href: '#build-sdk' },
      { label: 'CLI', href: '#build-cli' },
      { label: 'Verify a ceiling', href: '#build-verify' },
    ],
  },
  {
    group: 'Protocol',
    items: [
      { label: 'The ten messages', href: '#messages', active: true },
      { label: 'The write-ahead order', href: '#write-ahead' },
      { label: 'How revenue is weighted', href: '#weights' },
      { label: 'HCS-14 identity', href: '#identity' },
    ],
  },
  {
    group: 'Reference',
    items: [
      { label: 'POST /v1/spend', href: '#spend', active: true },
      { label: 'Refusal codes', href: '#refusal-codes' },
      { label: 'HCS receipt message', href: '#schema' },
      { label: 'The ceiling formula', href: '#ceiling-formula' },
      { label: 'Spend, as a sequence', href: '#sequence' },
    ],
  },
]

export const OUTLINE = [
  { label: 'Quickstart', href: '#quickstart', indent: 0 },
  { label: 'Reading the callouts', href: '#callouts', indent: 0 },
  { label: 'POST /v1/spend', href: '#spend', indent: 0 },
  { label: 'Refusal codes', href: '#refusal-codes', indent: 1 },
  { label: 'The ceiling formula', href: '#ceiling-formula', indent: 0 },
  { label: 'HCS receipt message', href: '#schema', indent: 0 },
  { label: 'Spend, as a sequence', href: '#sequence', indent: 0 },
  { label: 'The ten messages', href: '#messages', indent: 0 },
  { label: 'The write-ahead order', href: '#write-ahead', indent: 0 },
  { label: 'How revenue is weighted', href: '#weights', indent: 0 },
  { label: 'HCS-14 identity', href: '#identity', indent: 0 },
  { label: 'Build on Tab', href: '#build', indent: 0 },
  { label: 'MCP server', href: '#build-mcp', indent: 1 },
  { label: 'TypeScript SDK', href: '#build-sdk', indent: 1 },
  { label: 'CLI', href: '#build-cli', indent: 1 },
  { label: 'Verify a ceiling', href: '#build-verify', indent: 1 },
]

/** Search results that resolve. Each `href` is an anchor on this page. */
export const SEARCH_INDEX = [
  { section: 'Start here', title: 'Quickstart — read a tab with curl', href: '#quickstart' },
  { section: 'Build on Tab', title: 'MCP server — give your own LLM a tab', href: '#build-mcp' },
  { section: 'Build on Tab', title: 'TypeScript SDK — createTab and spend', href: '#build-sdk' },
  { section: 'Build on Tab', title: 'CLI — a refusal exits zero', href: '#build-cli' },
  { section: 'Build on Tab', title: 'Verify a published ceiling', href: '#build-verify' },
  { section: 'Protocol', title: 'The ten HCS message types', href: '#messages' },
  { section: 'Protocol', title: 'Write-ahead order · reserve, pay, commit', href: '#write-ahead' },
  { section: 'Protocol', title: 'Counterparty weighting and blocking reasons', href: '#weights' },
  { section: 'Protocol', title: 'HCS-14 identity · UAID derivation', href: '#identity' },
  { section: 'Reference', title: 'POST /v1/spend', href: '#spend' },
  { section: 'Reference', title: 'Refusal codes', href: '#refusal-codes' },
  { section: 'Reference', title: 'Refusal code · PER_CALL_CAP', href: '#code-per-call-cap' },
  { section: 'Reference', title: 'Refusal code · CONTROL_CLUSTER', href: '#code-control-cluster' },
  { section: 'Reference', title: 'HCS receipt message schema', href: '#schema' },
  { section: 'Reference', title: 'The ceiling formula, term by term', href: '#ceiling-formula' },
]

/**
 * The ten messages, and which process writes each.
 *
 * The whole protocol is these. Everything the console shows, everything
 * `verify-tab` checks and everything a stranger can replay is one of them —
 * there is no private side-channel and no database row that is not derived
 * from a message on one of the three topics.
 *
 * Field names are the wire names, kept short because HCS charges by the byte
 * and a receipt that needs chunking is a receipt that can arrive in pieces.
 */
export const PROTOCOL_MESSAGES = [
  {
    t: 'hold',
    by: 'gateway',
    topic: 'receipts',
    fields: 'hold · cp · amt · exp · req',
    when: 'Credit is reserved, BEFORE the seller is called. Awaited to consensus.',
  },
  {
    t: 'debit',
    by: 'gateway',
    topic: 'receipts',
    fields: 'cp · amt · hold · req · tx',
    when: 'The seller was paid. Carries the hold it commits and the settlement tx.',
  },
  {
    t: 'credit',
    by: 'gateway',
    topic: 'receipts',
    fields: 'cp · amt · att · req · tx',
    when: 'The agent earned. `att` records whether the gateway served what was paid for.',
  },
  {
    t: 'refused',
    by: 'gateway',
    topic: 'receipts',
    fields: 'cp · amt · rule · ev',
    when: 'A spend was refused. Published, not logged — the rule and its evidence.',
  },
  {
    t: 'repair',
    by: 'settlement',
    topic: 'receipts',
    fields: 'cp · amt · tx · why',
    when: 'A correcting entry. Append-only means a mistake is fixed forward, never erased.',
  },
  {
    t: 'weight',
    by: 'engine',
    topic: 'ceilings',
    fields: 'cp · bp · why · block · rev · share · model',
    when: 'What one counterparty’s revenue is worth, and every reason applied.',
  },
  {
    t: 'fact',
    by: 'engine',
    topic: 'ceilings',
    fields: 'acct · born · by',
    when: 'Who created an account and when. Observed once, remembered permanently.',
  },
  {
    t: 'ceiling',
    by: 'engine',
    topic: 'ceilings',
    fields: 'ceil · computed · bind · inputs · model · hash · cause',
    when: 'The limit, its inputs, and a hash of them. `computed` differs from `ceil` when growth is held.',
  },
  {
    t: 'settlement',
    by: 'settlement',
    topic: 'settlements',
    fields:
      'credits · debits · interest · net · n · tx · outcome · rampFrom · rampTo · outstanding',
    when: 'A window closed. One transfer for the net of everything in it.',
  },
  {
    t: 'register',
    by: 'engine',
    topic: 'ceilings',
    fields: 'root · ceil · perCall · allowlist · uaid',
    when: 'A funding root claimed, once, permanently. First claim wins.',
  },
] as const

/**
 * How a counterparty's revenue is discounted.
 *
 * The reasons MULTIPLY and truncate down at each step, in a fixed order, so
 * the result does not depend on evaluation order and never rounds in the
 * agent's favour. Three of them do not discount at all — they zero the
 * counterparty, because the revenue is not independent demand in any amount.
 */
export const WEIGHT_ALGEBRA = {
  blocking: BLOCKING_REASONS.map((r) => ({ reason: r, detail: WEIGHT_REASON_DETAIL[r] })),
  discounts: (
    [
      ['SHARED_FUNDING_ROOT', params.weights?.sharedRootBp],
      ['YOUNG_ACCOUNT', params.weights?.youngBp],
      ['CONCENTRATED', params.weights?.concentratedBp],
      ['RECIPROCAL_FLOW', params.weights?.reciprocalBp],
      ['UNVERIFIED_FUNDING', params.weights?.unverifiedBp],
      ['UNATTESTED', params.unattestedDiscountBp],
    ] as [string, number | undefined][]
  ).flatMap(([reason, bp]) =>
    // `weights` is the schema's one optional field, so a set that predates it
    // simply has fewer rows here rather than rendering a multiplier of NaN.
    bp === undefined
      ? []
      : [
          {
            reason,
            // allow-float — display only; input is an integer bp, nothing reads this back.
            multiplier: `×${(bp / 10_000).toFixed(2)}`,
            detail: WEIGHT_REASON_DETAIL[reason as keyof typeof WEIGHT_REASON_DETAIL] ?? '',
          },
        ],
  ),
}

/**
 * The write-ahead order, and what each step guarantees.
 *
 * `reserve -> pay -> commit` is the safety property the whole rail rests on.
 * The hold is published and AWAITED to consensus before the seller is called,
 * which costs 2–4 seconds and buys the one thing a stranger cannot otherwise
 * check: that every debit was authorised before the money moved. Publishing it
 * after the payment, or not awaiting it, puts the two messages on the topic in
 * an order that proves nothing.
 */
export const SPEND_ORDER = [
  {
    step: 'check',
    what: 'Cheapest rule first, against cached state',
    guarantee:
      'A refusal costs no chain write on the decision path and never calls the seller. Published ' +
      'afterwards so the refusal is auditable too.',
  },
  {
    step: 'reserve',
    what: 'hold published to the receipts topic, awaited to consensus',
    guarantee:
      'Headroom is committed before anything is spent. A failed hold FAILS CLOSED — the seller is ' +
      'never called.',
  },
  {
    step: 'pay',
    what: 'x402 settlement to the seller, hold id as the idempotency key',
    guarantee:
      'A retry with the same hold cannot pay twice. The seller sees an ordinary x402 customer and ' +
      'never learns Tab exists.',
  },
  {
    step: 'commit',
    what: 'debit published, carrying the hold it closes and the settlement tx',
    guarantee:
      'The debit names its hold, so `verify-tab` can assert `debit_within_hold` — every debit ' +
      'traces to an authorisation that preceded it.',
  },
  {
    step: 'expire',
    what: 'An uncommitted hold lapses on its own at `exp`',
    guarantee:
      'A crash between pay and commit strands nothing permanently. Releasing early instead would ' +
      'let the agent spend the same headroom twice.',
  },
] as const

/**
 * HCS-14 identity, derived rather than assigned.
 *
 * The agent is addressable as a UAID instead of only an account number, and
 * the identifier is a function of what the agent IS — so two parties deriving
 * it from the same facts get the same string, and nobody has to be trusted to
 * issue it.
 */
export const HCS14_DERIVATION = {
  fields: ['name', 'nativeId', 'protocol', 'registry', 'skills', 'version'],
  steps: [
    'Six fields, canonicalised — keys sorted, skills sorted numerically.',
    'SHA-384 over the canonical bytes.',
    'Base58 of the digest. That is the AID.',
    'uaid:aid:{base58};uid=…,registry=…,proto=…,nativeId=…',
  ],
  note:
    'Parameters are emitted in the documented order and an absent one is omitted rather than ' +
    'left empty — a trailing `nativeId=` would be a claim about an identifier nobody has.',
  live: 'uaid:aid:4ArPMKdhwEoLXJo7UaxCMD3H4PKKKrDRc4CTAQba4uZqzVDBM6Z4MqDhp1DqrEBwnV',
} as const
