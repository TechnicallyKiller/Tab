/** Content for docs.tab.xyz. */

export const QUICKSTART = [
  {
    n: '1',
    title: 'Install',
    body: 'The SDK talks to the gateway. It never touches a key, because there is no key.',
    lang: 'bash',
    code: 'npm i @tab/sdk',
  },
  {
    n: '2',
    title: 'Register',
    body: 'Returns a Starter Tab: a $1.0000 ceiling, a $0.0500 per-call cap, and an allowlist of sellers.',
    lang: 'typescript',
    code: `import { Tab } from "@tab/sdk";

const tab = await Tab.register({
  network: "testnet",
  accountId: "0.0.4482091",
});

// tab.ceiling  → "1.0000"
// tab.balance  → "0.0000"`,
  },
  {
    n: '3',
    title: 'Spend',
    body: 'The agent pays for something it could not have afforded. Refusal is a normal return value, not a thrown error.',
    lang: 'typescript',
    code: `const res = await tab.spend({
  url: "https://api.vendor.xyz/v1/rank",
  max: "0.0400",
});

if (res.refused) {
  // res.refused.rule → "CONTROL_CLUSTER"
  // res.refused.reason → plain sentence
}`,
  },
  {
    n: '4',
    title: 'Read the receipt',
    body: 'Every leg is a consensus-ordered message on the receipt topic. Nothing is inferred from chain history.',
    lang: 'bash',
    code: 'tab receipts --last 1 --topic 0.0.4881203',
  },
]

export const CALLOUTS = [
  {
    label: 'Note',
    tone: 'ink' as const,
    body: 'Amounts are USDC with 6 decimals. Tab displays four and truncates — the truncation is deliberate and never rounds up.',
  },
  {
    label: 'Important',
    tone: 'pen' as const,
    body: 'The ceiling is recomputed on the slow path only. A spend request never triggers a Mirror Node call.',
  },
  {
    label: 'Refuses',
    tone: 'caution' as const,
    body: 'This operation can be refused. A refusal is a successful HTTP response with a rule, a reason and the evidence behind it.',
  },
  {
    label: 'Irreversible',
    tone: 'debit' as const,
    body: 'Settlement writes a single transfer against the float account. Once consensus is reached the window cannot be reopened.',
  },
]

export const SPEND_PARAMS = [
  {
    name: 'url',
    type: 'string',
    meaning: 'The x402 endpoint to call. The seller needs no knowledge of Tab.',
  },
  {
    name: 'max',
    type: 'Usdc',
    meaning: 'Ceiling for this single call, as a decimal string. Never a float.',
  },
  {
    name: 'idempotencyKey',
    type: 'string?',
    meaning: 'Replays return the original result rather than spending twice.',
  },
]

/** Every row is linkable — handling refusal is the agent developer's main job. */
export const REFUSAL_CODES = [
  {
    id: 'code-per-call-cap',
    code: 'PER_CALL_CAP',
    when: 'The request exceeds the per-call cap for the tab’s tier.',
    next: 'Split the work, or quote first and wait for a ceiling raise.',
  },
  {
    id: 'code-window-cap',
    code: 'WINDOW_CAP',
    when: 'Window spend plus this request would pass the window cap.',
    next: 'Retry after the window tick. The countdown is in the response.',
  },
  {
    id: 'code-ceiling-exceeded',
    code: 'CEILING_EXCEEDED',
    when: 'Outstanding plus holds plus this request would pass the ceiling.',
    next: 'Earn first, or wait for settlement to clear outstanding.',
  },
  {
    id: 'code-control-cluster',
    code: 'CONTROL_CLUSTER',
    when: 'The seller is inside the agent’s funding ancestry within the hop limit.',
    next: 'Buy from an independent seller. Do not retry the same one.',
  },
  {
    id: 'code-seller-blocked',
    code: 'SELLER_NOT_ALLOWLISTED',
    when: 'A Starter Tab may only buy from allowlisted sellers.',
    next: 'Graduate the tab with one clean settlement, then retry.',
  },
  {
    id: 'code-tab-frozen',
    code: 'TAB_FROZEN',
    when: 'The tab is frozen pending operator review.',
    next: 'Stop spending. Surface the freeze to the operator.',
  },
]

export const RECEIPT_SCHEMA = `{
  "v": 2,
  "leg": "DEBIT",
  "tab": "0.0.4482091",
  "counterparty": "0.0.5120033",
  "amount": "0.018000",
  "attested": true,
  "request_hash": "0ac4f1…918b",
  "window": 148,
  "consensus": "1755738208.402911005"
}`

export const SIDEBAR = [
  {
    group: 'Start here',
    items: [
      { label: 'What Tab is', href: '#quickstart', active: true },
      { label: 'Quickstart', href: '#quickstart', active: true },
      { label: 'Core concepts', href: '#callouts' },
    ],
  },
  {
    group: 'Concepts',
    items: [
      { label: 'The tab and the ceiling', href: '#ceiling-formula' },
      { label: 'Attested revenue', href: '#schema' },
      { label: 'Independence and control clusters', href: '#refusal-codes' },
      { label: 'Windows and settlement', href: '#sequence' },
      { label: 'The Starter Tab', href: '#quickstart' },
      { label: 'Holds and the write-ahead order', href: '#sequence' },
    ],
  },
  {
    group: 'Agent surfaces',
    items: [
      { label: 'TypeScript SDK', href: '#spend', active: true },
      { label: 'Hedera Agent Kit plugin', href: '#spend' },
      { label: 'MCP server', href: '#spend' },
      { label: 'CLI', href: '#quickstart' },
    ],
  },
  {
    group: 'Reference',
    items: [
      { label: 'Gateway API', href: '#spend', active: true },
      { label: 'Refusal codes', href: '#refusal-codes' },
      { label: 'HCS message schemas', href: '#schema' },
      { label: 'Credit parameters', href: '#ceiling-formula' },
    ],
  },
  {
    group: 'Operating',
    items: [
      { label: 'Environment setup', href: '#quickstart' },
      { label: 'Verifying a ceiling', href: '#ceiling-formula' },
      { label: 'Reconciliation', href: '#sequence' },
    ],
  },
  {
    group: 'Trust',
    items: [
      { label: 'Trust and security model', href: '#refusal-codes' },
      { label: 'Attack catalogue', href: '#refusal-codes' },
      { label: 'What we did not build', href: '#refusal-codes' },
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
]

export const SEARCH_INDEX = [
  { section: 'Reference', title: 'Refusal codes' },
  { section: 'Reference', title: 'Refusal code · CONTROL_CLUSTER' },
  { section: 'Concepts', title: 'Attested revenue and why refusals count' },
  { section: 'Agent surfaces', title: 'Handling a refusal in the TypeScript SDK' },
  { section: 'Operating', title: 'Refused spends in the operator console' },
  { section: 'Trust', title: 'Attack catalogue · what still gets refused' },
  { section: 'Concepts', title: 'The ceiling formula, term by term' },
  { section: 'Reference', title: 'HCS receipt message schema v2' },
]
