/**
 * @tab/sdk — the client every other surface is built on.
 *
 * Tier 3. Published, thin, browser-safe. `boundaries.json` forbids
 * `@hiero-ledger/sdk`, `ioredis` and `drizzle-orm` here, and that constraint
 * carries the product claim: the agent holds no key and signs nothing, so the
 * library it installs should not even be ABLE to sign.
 *
 * ```ts
 * const tab = createTab({ baseUrl: 'http://localhost:8080' })
 * const result = await tab.spend({ tab: '0.0.x', url: seller, max: usdc('0.040000') })
 * if (result.outcome === 'refused') console.log(result.rule, result.guidance)
 * ```
 *
 * **A refusal is a value, not an exception.** That is the one thing to know
 * before using this.
 */

import type { MicroUsdc } from '@tab/money'
import { TabClient, type TabClientConfig } from './client.ts'
import { ceiling, counterparties, health, holds, receipts, settlements, tabs } from './receipts.ts'
import { quote, spend, state } from './spend.ts'
import type {
  CeilingView,
  CounterpartyWeight,
  Hold,
  Quote,
  ReceiptRow,
  SettlementView,
  SpendRequest,
  SpendResult,
  TabList,
  TabState,
} from './types.ts'

export interface Tab {
  spend(request: SpendRequest): Promise<SpendResult>
  quote(params: { tab: string; max: MicroUsdc }): Promise<Quote>
  state(tab: string): Promise<TabState>
  holds(tab: string): Promise<Hold[]>
  receipts(tab: string): Promise<ReceiptRow[]>
  counterparties(tab: string): Promise<CounterpartyWeight[]>
  /** The ceiling in force, its arithmetic, and the series behind it. */
  ceiling(tab: string): Promise<CeilingView>
  /** Settled windows, ascending by window. */
  settlements(tab: string): Promise<SettlementView[]>
  /** The tabs this gateway knows about. NOT a registry — see `TabList`. */
  tabs(): Promise<TabList>
  health(): Promise<Awaited<ReturnType<typeof health>>>
}

/**
 * The ten verbs, bound to one client.
 *
 * Object-with-methods rather than loose functions because the same surface
 * appears in the Agent Kit plugin, the MCP server and the CLI — defining it
 * once, here, is what stops those three drifting apart.
 *
 * Two of the ten (`spend`, `quote`) act. The other eight only read, and every
 * one of them reads what was PUBLISHED rather than recomputing it: this package
 * cannot import `@tab/scoring` or `@tab/graph`, so it is structurally incapable
 * of offering a second opinion about a ceiling or a weight. That is the point.
 */
export function createTab(config: TabClientConfig): Tab {
  const client = new TabClient(config)
  return {
    spend: (request) => spend(client, request),
    quote: (params) => quote(client, params),
    state: (tab) => state(client, tab),
    holds: (tab) => holds(client, tab),
    receipts: (tab) => receipts(client, tab),
    counterparties: (tab) => counterparties(client, tab),
    ceiling: (tab) => ceiling(client, tab),
    settlements: (tab) => settlements(client, tab),
    tabs: () => tabs(client),
    health: () => health(client),
  }
}

// Re-exported so `apps/web` can type a reason without importing @tab/graph,
// which its allow list forbids.
export type { WeightReason } from '@tab/protocol'
export { TabClient, type TabClientConfig } from './client.ts'
export {
  isTabError,
  type TabError,
  TabInvalidError,
  TabProtocolError,
  TabUnavailableError,
} from './errors.ts'
export { ceiling, counterparties, health, holds, receipts, settlements, tabs } from './receipts.ts'
export { parseAmount, quote, spend, state } from './spend.ts'
export type {
  CeilingInputsView,
  CeilingView,
  CounterpartyWeight,
  Hold,
  PublishedCeilingView,
  Quote,
  ReceiptLeg,
  ReceiptRow,
  RefusalCode,
  SettlementView,
  SpendFailed,
  SpendPaid,
  SpendRefused,
  SpendRequest,
  SpendResult,
  TabList,
  TabState,
  TabSummary,
} from './types.ts'
export {
  BLOCKING_REASONS,
  isBlocking,
  isRetryable,
  REFUSAL_CODES,
  REFUSAL_GUIDANCE,
  WEIGHT_REASON_DETAIL,
  WEIGHT_REASONS,
} from './types.ts'
