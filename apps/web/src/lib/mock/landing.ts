/** Content for tab.xyz. Copy lives here so the sections stay presentational. */

export const PROBLEMS = [
  {
    idx: '01',
    title: 'Cold start',
    body: 'A freshly deployed agent cannot transact at all until a human funds it. Its first act is to fail.',
    diagram: 'cold' as const,
  },
  {
    idx: '02',
    title: 'Job rejection',
    body: 'The agent declines profitable work because it can’t fund the input cost right now.',
    diagram: 'reject' as const,
  },
  {
    idx: '03',
    title: 'Human bottleneck',
    body: 'An operator tops up the wallet by hand — which defeats the point of autonomy.',
    diagram: 'human' as const,
  },
  {
    idx: '04',
    title: 'Hot float',
    body: 'The operator over-funds "just in case," leaving a large balance in a key an agent controls.',
    diagram: 'hot' as const,
  },
]

export const FLOWS = [
  {
    kicker: 'State 1 · spend leg',
    label: 'Spend leg · agent → gateway → seller',
    title: 'The gateway pays the seller before the agent has any money.',
    body: 'A spend request arrives. The gateway checks six things against cache, writes a hold, pays the seller from house float, and debits the running balance.',
    caption:
      'The seller sees an ordinary x402 customer. It does not know Tab exists. Nothing on the seller side changes.',
  },
  {
    kicker: 'State 2 · earn leg',
    label: 'Earn leg · payer → gateway → agent',
    title: 'The gateway fronts the agent’s own endpoint and collects.',
    body: 'A payer hits the agent’s endpoint. The gateway serves the 402, collects the payment, and credits the balance with an attested receipt.',
    caption:
      'Because Tab served the request, it can prove the payment corresponds to real work. Chain history alone can’t.',
  },
  {
    kicker: 'State 3 · settlement',
    label: 'Settlement · window 0148 close',
    title: 'Once per window, everything nets to one movement.',
    body: 'At the tick, a scheduled transaction executes by consensus. Debits and credits net. One transfer touches the float account.',
    caption: 'Ten thousand calls become one transfer.',
  },
]

export const FAST_PATH_CHECKS = [
  'tab exists and is not frozen',
  'amount ≤ per-call cap',
  'window spend + amount ≤ window cap',
  'outstanding + holds + amount ≤ ceiling',
  'counterparty weight > 0',
  'write hold, then call',
]

export const SLOW_PATH_STAGES = ['Mirror Node', 'graph', 'score', 'ceiling']

/** Published including the gaps, because a catalogue of only solved attacks isn't one. */
export const OPEN_GAPS = [
  {
    title: 'Non-reciprocal collusion rings',
    status: 'OPEN',
    body: 'A ring where value never flows back and funding roots are genuinely separate defeats the graph.',
  },
  {
    title: 'Gateway operator misbehaviour',
    status: 'OPEN BY DESIGN',
    body: 'The float is custodial. Detectable via published receipts; not preventable in v1.',
  },
  {
    title: 'Seller takes payment, no delivery',
    status: 'OPEN',
    body: 'v1 records the dispute and does not arbitrate.',
  },
]

export const HEDERA_REASONS = [
  {
    figure: '$0.0001',
    title: 'HCS is a clearing ledger you don’t have to write',
    body: 'Append-only, consensus-ordered, per message. This is why Tab ships with zero smart contracts.',
  },
  {
    figure: '< $0.01',
    title: 'Sub-cent USD-denominated fees',
    body: 'Per-request payouts become a product rather than arithmetic that loses money.',
  },
  {
    figure: '3s',
    title: 'Finality matches the settlement tick',
    body: 'Window close to settled transfer inside one agent reasoning cycle.',
  },
  {
    figure: 'HIP-423',
    title: 'Scheduled Transactions execute the tick',
    body: 'By consensus, with no keeper process to run, fund or trust.',
  },
]

export const PRIMITIVES: [string, string][] = [
  ['Credit registry contract', 'HCS topic — ceiling messages, consensus-ordered'],
  ['Receipt storage contract', 'HCS topic — one message per leg'],
  ['Settlement executor contract', 'Scheduled Transaction (HIP-423)'],
  ['Treasury / vault contract', 'Plain Hedera account holding the float'],
  ['Access control contract', 'Account keys and topic submit keys'],
]

export const REMOVED_SURFACE = [
  'reentrancy',
  'delegatecall',
  'proxy storage collision',
  'upgrade key',
  'liquidation MEV',
]

export const VERBS = ['spend', 'quote', 'balance', 'ceiling', 'receipts']

export const NOT_BUILT = [
  'no smart contracts',
  'no seller-side credential',
  'no cross-chain messaging',
  'no price oracles',
  'no LP vaults',
  'no agent deployment platform',
]

import { bp, usdc, type BasisPoints, type MicroUsdc } from '../money'

/** Tier multiples as basis points: 30000 = 3.0x. Any default collapses to Unrated. */
export const TIER_MULTIPLE_BP: Record<string, BasisPoints> = {
  A: bp(30_000),
  B: bp(20_000),
  C: bp(10_000),
  Unrated: bp(0),
}

export const TIER_HARD_CAP: Record<string, MicroUsdc> = {
  A: usdc('20.0000'),
  B: usdc('6.0000'),
  C: usdc('2.0000'),
  Unrated: usdc('0.0000'),
}
