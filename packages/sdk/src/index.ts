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
import { TabClient, type TabClientConfig } from './client.ts'
import { quote, spend, state } from './spend.ts'
import { counterparties, health, holds, receipts } from './receipts.ts'
import type { MicroUsdc } from '@tab/money'
import type {
  CounterpartyWeight, Hold, Quote, ReceiptRow, SpendRequest, SpendResult, TabState,
} from './types.ts'

export interface Tab {
  spend(request: SpendRequest): Promise<SpendResult>
  quote(params: { tab: string; max: MicroUsdc }): Promise<Quote>
  state(tab: string): Promise<TabState>
  holds(tab: string): Promise<Hold[]>
  receipts(tab: string): Promise<ReceiptRow[]>
  counterparties(tab: string): Promise<CounterpartyWeight[]>
  health(): Promise<Awaited<ReturnType<typeof health>>>
}

/**
 * The six verbs, bound to one client.
 *
 * Object-with-methods rather than loose functions because the same six appear
 * in the Agent Kit plugin, the MCP server and the CLI — defining the surface
 * once, here, is what stops those three drifting apart.
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
    health: () => health(client),
  }
}

export { TabClient, type TabClientConfig } from './client.ts'
export { spend, quote, state, parseAmount } from './spend.ts'
export { holds, receipts, counterparties, health } from './receipts.ts'
export {
  TabInvalidError,
  TabProtocolError,
  TabUnavailableError,
  isTabError,
  type TabError,
} from './errors.ts'
export type {
  CounterpartyWeight,
  Hold,
  Quote,
  ReceiptLeg,
  ReceiptRow,
  RefusalCode,
  SpendFailed,
  SpendPaid,
  SpendRefused,
  SpendRequest,
  SpendResult,
  TabState,
} from './types.ts'
export {
  BLOCKING_REASONS,
  REFUSAL_CODES,
  REFUSAL_GUIDANCE,
  WEIGHT_REASONS,
  WEIGHT_REASON_DETAIL,
  isBlocking,
  isRetryable,
} from './types.ts'

// Re-exported so `apps/web` can type a reason without importing @tab/graph,
// which its allow list forbids.
export type { WeightReason } from '@tab/protocol'
