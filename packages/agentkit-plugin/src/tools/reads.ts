import type { BaseTool } from '@hashgraph/hedera-agent-kit'
import { format, usdc } from '@tab/money'
import { WEIGHT_REASON_DETAIL } from '@tab/protocol'
import type { Tab } from '@tab/sdk'
import { z } from 'zod'
import { TabBaseTool } from '../base.ts'
import type { TabPluginConfig } from '../context.ts'

/**
 * The read tools.
 *
 * Grouped in one file because they share a shape exactly — no parameters, one
 * SDK call, formatted text out — and four near-identical files would be four
 * places to drift. `spend` is separate because it is the only one that moves
 * money and the only one with real branching.
 *
 * Every one reads what was PUBLISHED. This package cannot import `@tab/scoring`
 * or `@tab/graph`, so it is structurally incapable of offering a second opinion
 * about a ceiling or a weight — the agent sees what the topic says.
 */

export const TAB_QUOTE_TOOL = 'tab_quote_tool'
export const TAB_BALANCE_TOOL = 'tab_balance_tool'
export const TAB_CEILING_TOOL = 'tab_ceiling_tool'
export const TAB_COUNTERPARTIES_TOOL = 'tab_counterparties_tool'

const noParams = () => z.object({})
type NoParams = z.infer<ReturnType<typeof noParams>>

/* ── quote ───────────────────────────────────────────────────────────────── */

const quoteParams = () =>
  z.object({
    max: z
      .string()
      .regex(/^\d+\.\d{6}$/, 'six decimal places, e.g. "0.040000"')
      .describe('The spend to test, as a decimal string with exactly six decimal places'),
  })
type QuoteParams = z.infer<ReturnType<typeof quoteParams>>

export class TabQuoteTool extends TabBaseTool<QuoteParams> {
  method = TAB_QUOTE_TOOL
  name = 'Check affordability without reserving'
  description: string
  parameters: ReturnType<typeof quoteParams>

  constructor(tab: Tab, config: TabPluginConfig) {
    super(tab, config)
    this.parameters = quoteParams()
    this.description =
      `Ask whether a spend would be allowed on tab ${config.tab}, WITHOUT taking a hold.\n\n` +
      'Use this before planning a batch of work: a hold taken by a quote would be headroom the ' +
      'agent never uses, and the reconciler would later have to clean it up.\n\n' +
      'Parameters:\n- max (str, required): the spend to test, six decimals, e.g. "0.040000"'
  }

  async normalizeParams(params: QuoteParams) {
    return params
  }

  async coreAction(params: QuoteParams): Promise<string> {
    const q = await this.tab.quote({ tab: this.config.tab, max: usdc(params.max) })
    return [
      q.affordable
        ? `AFFORDABLE — ${format(usdc(params.max))} is within the tab.`
        : 'NOT AFFORDABLE',
      `available    ${format(q.available)}`,
      `ceiling      ${format(q.ceiling)}`,
      `per-call cap ${format(q.perCallCap)}`,
      ...(q.wouldRefuse ? ['', `would refuse: ${q.wouldRefuse}`, q.reason ?? ''] : []),
    ]
      .filter(Boolean)
      .join('\n')
  }
}

/* ── balance ─────────────────────────────────────────────────────────────── */

export class TabBalanceTool extends TabBaseTool<NoParams> {
  method = TAB_BALANCE_TOOL
  name = 'Tab position'
  description: string
  parameters = noParams()

  constructor(tab: Tab, config: TabPluginConfig) {
    super(tab, config)
    this.description =
      `The current position of tab ${config.tab}: balance (negative means the agent owes), ` +
      'outstanding, pending holds, available headroom and the ceiling in force.'
  }

  async normalizeParams(params: NoParams) {
    return params
  }

  async coreAction(): Promise<string> {
    const s = await this.tab.state(this.config.tab)
    return [
      `tab          ${s.tab}`,
      `balance      ${format(s.balance, { sign: 'always' })}   (negative means the agent owes)`,
      `outstanding  ${format(s.outstanding)}`,
      `holds        ${format(s.holds)}`,
      `available    ${format(s.available)}`,
      `ceiling      ${format(s.ceiling)}`,
      `per-call cap ${format(s.perCallCap)}`,
      `window       ${s.window} · ${s.entries} ledger entries`,
    ].join('\n')
  }
}

/* ── ceiling ─────────────────────────────────────────────────────────────── */

export class TabCeilingTool extends TabBaseTool<NoParams> {
  method = TAB_CEILING_TOOL
  name = 'The ceiling, and the arithmetic behind it'
  description: string
  parameters = noParams()

  constructor(tab: Tab, config: TabPluginConfig) {
    super(tab, config)
    this.description =
      `The credit ceiling in force for tab ${config.tab}, what bound it, and the published ` +
      'inputs it was computed from. Use this to explain WHY the tab can or cannot afford ' +
      'something, rather than reporting a bare number.'
  }

  async normalizeParams(params: NoParams) {
    return params
  }

  async coreAction(): Promise<string> {
    const c = await this.tab.ceiling(this.config.tab)
    if (!c.published || !c.current) {
      return [
        `No ceiling published yet for ${c.tab} — normal for a tab's first minutes.`,
        `The gateway is enforcing ${format(c.enforced)} meanwhile (the starter floor).`,
      ].join('\n')
    }
    const i = c.current.inputs
    return [
      `ceiling      ${format(c.current.ceiling)}   bound by ${c.current.binding}`,
      `enforced now ${format(c.enforced)}`,
      `cause        ${c.current.cause}`,
      '',
      'Published inputs:',
      `  trailing revenue  ${format(i.revenue)}  (attested ${format(i.revenueAttested)} · unattested ${format(i.revenueUnattested)})`,
      `  tier              ${i.tier}  x${i.multBp / 10_000}`,
      `  earned ramp       ${i.rampBp / 100}%`,
      `  starter floor     ${format(i.floor)}`,
      ...(i.defaulted
        ? ['  DEFAULTED         a missed settlement means zero, whatever the revenue']
        : []),
      '',
      `model ${c.current.model} · HCS seq ${c.current.seq ?? '?'} · input hash ${c.current.hash}`,
      'Anyone can recompute this from the public topic: pnpm verify-ceiling.',
    ].join('\n')
  }
}

/* ── counterparties ──────────────────────────────────────────────────────── */

export class TabCounterpartiesTool extends TabBaseTool<NoParams> {
  method = TAB_COUNTERPARTIES_TOOL
  name = 'Who counts as independent revenue'
  description: string
  parameters = noParams()

  constructor(tab: Tab, config: TabPluginConfig) {
    super(tab, config)
    this.description =
      'Published independence weights for the tab’s counterparties, with the reason each was ' +
      'discounted or blocked. This is why revenue does or does not raise the ceiling.'
  }

  async normalizeParams(params: NoParams) {
    return params
  }

  async coreAction(): Promise<string> {
    const rows = await this.tab.counterparties(this.config.tab)
    if (rows.length === 0) return 'No weights published yet. Run the engine.'
    return rows
      .map((w) =>
        [
          `${w.counterparty}  ${w.bp / 100}%${w.blocking ? '  BLOCKED' : ''}`,
          `  revenue ${format(w.revenue)} · share ${w.shareBp / 100}%`,
          ...w.reasons.map((r) => `  ${r}: ${WEIGHT_REASON_DETAIL[r]}`),
          ...(w.funder && w.tabFunder
            ? [
                `  funded by ${w.funder} · tab funded by ${w.tabFunder}` +
                  (w.funder === w.tabFunder ? '  <- SAME, which is what COMMON_FUNDER tests' : ''),
              ]
            : []),
        ].join('\n'),
      )
      .join('\n\n')
  }
}

export const quoteTool = (tab: Tab, c: TabPluginConfig): BaseTool =>
  new TabQuoteTool(tab, c) as unknown as BaseTool
export const balanceTool = (tab: Tab, c: TabPluginConfig): BaseTool =>
  new TabBalanceTool(tab, c) as unknown as BaseTool
export const ceilingTool = (tab: Tab, c: TabPluginConfig): BaseTool =>
  new TabCeilingTool(tab, c) as unknown as BaseTool
export const counterpartiesTool = (tab: Tab, c: TabPluginConfig): BaseTool =>
  new TabCounterpartiesTool(tab, c) as unknown as BaseTool
