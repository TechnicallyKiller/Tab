import type { Context, Plugin } from '@hashgraph/hedera-agent-kit'
import { clientFor, configFromEnv, type TabPluginConfig } from './context.ts'
import {
  balanceTool,
  ceilingTool,
  counterpartiesTool,
  quoteTool,
  TAB_BALANCE_TOOL,
  TAB_CEILING_TOOL,
  TAB_COUNTERPARTIES_TOOL,
  TAB_QUOTE_TOOL,
} from './tools/reads.ts'
import spendTool, { TAB_SPEND_TOOL } from './tools/spend.ts'

/**
 * `@tab/agentkit-plugin` — Tab's verbs as Hedera Agent Kit tools.
 *
 * Tier 3. Depends on `@tab/sdk` and nothing lower — `boundaries.json` allows
 * only `money`, `protocol` and `sdk`, so this package cannot sign, cannot read a
 * database, and cannot recompute a ceiling. It does not even depend on the
 * Hedera SDK, which it is permitted to: a package that CANNOT import a signer is
 * a stronger claim than one that imports it and promises not to use it.
 *
 * ## What an agent can and cannot do with this
 *
 * Five tools. One spends; four read. **None of them can produce a Hedera
 * transaction**, because every tool stops after `coreAction` — see `base.ts`.
 * The gateway holds the float and signs against a ceiling the agent earned, so
 * there is nothing for an LLM to sign even if it decides to try.
 *
 * ## Relationship to `@tab/mcp`
 *
 * The same verbs over a different transport, deliberately, and both are thin
 * wrappers over the same `@tab/sdk` calls. Divergence between them would be a
 * support burden and a demo risk, so behaviour that matters — a refusal being a
 * result rather than an error, the guidance text coming from `@tab/protocol` —
 * lives in the SDK or the protocol package, not in either wrapper.
 */
export function tabPlugin(config: TabPluginConfig = configFromEnv()): Plugin {
  /*
   * ONE client for the plugin, not one per tool call.
   *
   * `tools(context)` is a factory the toolkit may call more than once, and a
   * fresh client per call would drop the connection reuse that keeps a spend
   * inside its timeout budget.
   */
  const tab = clientFor(config)

  return {
    name: 'tab',
    version: '0.1.0',
    description:
      'Spend and inspect an agent tab on Hedera. The agent holds no key and signs nothing: ' +
      'the gateway pays sellers against a credit ceiling the agent earned from independently ' +
      'verified revenue.',
    tools: (_context: Context) => [
      spendTool(tab, config),
      quoteTool(tab, config),
      balanceTool(tab, config),
      ceilingTool(tab, config),
      counterpartiesTool(tab, config),
    ],
  }
}

export const tabPluginToolNames = {
  TAB_SPEND_TOOL,
  TAB_QUOTE_TOOL,
  TAB_BALANCE_TOOL,
  TAB_CEILING_TOOL,
  TAB_COUNTERPARTIES_TOOL,
} as const

export { TabBaseTool } from './base.ts'
export { clientFor, configFromEnv, type TabPluginConfig } from './context.ts'
export { TabSpendCapPolicy } from './policy.ts'
export {
  TAB_BALANCE_TOOL,
  TAB_CEILING_TOOL,
  TAB_COUNTERPARTIES_TOOL,
  TAB_QUOTE_TOOL,
  TAB_SPEND_TOOL,
}

export default { tabPlugin, tabPluginToolNames }
