import type { BaseTool } from '@hashgraph/hedera-agent-kit'
import { format, usdc } from '@tab/money'
import type { Tab } from '@tab/sdk'
import { z } from 'zod'
import { TabBaseTool } from '../base.ts'
import type { TabPluginConfig } from '../context.ts'

export const TAB_SPEND_TOOL = 'tab_spend_tool'

const parameters = () =>
  z.object({
    url: z
      .string()
      .url()
      .describe('The seller URL to pay, including whatever the seller needs in order to be paid'),
    max: z
      .string()
      .regex(/^\d+\.\d{6}$/, 'six decimal places, e.g. "0.040000"')
      .describe(
        'The most this call may cost, as a decimal string with exactly six decimal places. ' +
          'The tab is debited what the seller actually charged, not this cap.',
      ),
    idempotencyKey: z
      .string()
      .min(8)
      .max(64)
      .optional()
      .describe(
        'Reuse the SAME key when retrying a call that failed with an unknown outcome, or the ' +
          'retry may pay twice. Generated automatically when omitted.',
      ),
  })

type Params = z.infer<ReturnType<typeof parameters>>

const prompt = (config: TabPluginConfig) =>
  `Spend from the agent's tab (${config.tab}) to pay a seller.

The agent holds no key and signs nothing: the gateway pays the seller against a
credit ceiling the agent EARNED from independently verified revenue.

A REFUSED result is not an error. It names the rule that fired and what to do
instead — read the guidance and choose different work rather than retrying the
same call, unless the refusal says it is retryable.

Parameters:
- url (str, required): the seller's URL
- max (str, required): spending cap, six decimals, e.g. "0.040000"
- idempotencyKey (str, optional): reuse when retrying an unknown-outcome call`

/**
 * The one tool here that moves money.
 *
 * ## Why this is not a transaction tool
 *
 * The Agent Kit's mutation pattern is `coreAction` builds a `Transaction` and
 * `secondaryAction` signs and submits it. **Tab cannot use that shape, and the
 * reason is the entire product.** The agent has no key, so it cannot build a
 * transaction anyone would accept; the gateway holds the float and signs on its
 * behalf against a ceiling.
 *
 * So every tool in this plugin — including this one — stops after `coreAction`.
 * `shouldSecondaryAction` returns false throughout, which means **an LLM driving
 * this plugin cannot produce a Hedera transaction to sign, even if it tries.**
 * That is the claim made structural rather than promised.
 */
export class TabSpendTool extends TabBaseTool<Params> {
  method = TAB_SPEND_TOOL
  name = 'Spend from the tab'
  description: string
  parameters: ReturnType<typeof parameters>

  constructor(tab: Tab, config: TabPluginConfig) {
    super(tab, config)
    this.description = prompt(config)
    this.parameters = parameters()
  }

  async normalizeParams(params: Params): Promise<Params> {
    return params
  }

  async coreAction(params: Params): Promise<string> {
    const result = await this.tab.spend({
      tab: this.config.tab,
      url: params.url,
      max: usdc(params.max),
      ...(params.idempotencyKey ? { idempotencyKey: params.idempotencyKey } : {}),
    })

    if (result.outcome === 'paid') {
      return [
        `PAID ${format(result.amount)} USDC to ${result.seller}.`,
        `hold ${result.holdId}` +
          (result.receiptSeq !== null ? ` · receipt seq ${result.receiptSeq} on HCS` : ''),
        '',
        'The seller responded:',
        typeof result.body === 'string' ? result.body : JSON.stringify(result.body, null, 2),
      ].join('\n')
    }

    if (result.outcome === 'refused') {
      /*
       * A refusal is returned as a RESULT, never thrown.
       *
       * Throwing would surface it to the agent as a tool failure and invite a
       * retry — and a CEILING_EXCEEDED retried immediately is refused again for
       * the same reason. The guidance comes from `@tab/protocol`, the same text
       * the HTTP API and the console show, so an agent that learns the rail
       * through the Agent Kit learns the same rail.
       */
      const evidence = result.evidence
        ? Object.entries(result.evidence)
            .map(([k, v]) => `  ${k} ${v}`)
            .join('\n')
        : '  (none published)'
      return [
        `REFUSED — ${result.rule}`,
        '',
        result.reason,
        '',
        'Evidence:',
        evidence,
        '',
        `What to do: ${result.guidance}`,
        result.retryable
          ? 'This rule can clear on its own — the same call may succeed later.'
          : 'Retrying this exact call will be refused again. Choose different work.',
      ].join('\n')
    }

    /*
     * `failed` DOES throw, and the distinction is deliberate.
     *
     * A refusal means the rail said no. This means nobody said anything and it
     * is unknown whether the seller was paid — so a retry with a NEW key would
     * be a second payment, and the hold id has to reach the agent.
     */
    throw new Error(
      `Tab spend failed after the decision to spend: ${result.reason}. ` +
        'This is NOT a refusal — it is unknown whether the seller was paid. ' +
        `To retry safely, call again with idempotencyKey "${result.holdId}". ` +
        'A new key would be a second payment. The hold expires on its own.',
    )
  }
}

export default (tab: Tab, config: TabPluginConfig): BaseTool =>
  new TabSpendTool(tab, config) as unknown as BaseTool
