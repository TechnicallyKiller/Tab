import { format, usdc } from '@tab/money'
// Through the SDK, not `@tab/protocol` directly. The console's rule is that it
// reads through one client — the SDK re-exports the protocol vocabulary for
// exactly this, so the reason codes rendered here are the ones on the topic
// rather than a second copy that can drift.
import { type Tab, WEIGHT_REASON_DETAIL } from '@tab/sdk'

/**
 * Tab's verbs, as tools a language model can call.
 *
 * The same five the Agent Kit plugin and the MCP server expose, over a third
 * transport. Behaviour that matters — a refusal being a RESULT rather than an
 * error, guidance text coming from `@tab/protocol` — lives in `@tab/sdk` and
 * the protocol package, not here, so the three surfaces cannot drift into
 * disagreeing about what the rail does.
 *
 * ## The property worth noticing
 *
 * There is no tool here that signs anything, and there could not be: `apps/web`
 * may import `money`, `protocol`, `params` and `sdk` and nothing else, so this
 * route is structurally incapable of touching a key. A visitor can point a
 * language model at it and the worst outcome is a spend up to the ceiling —
 * which is the demo, not a risk.
 */

export interface ChatTool {
  name: string
  description: string
  parameters: Record<string, unknown>
  /** Returns text the model reads. Never throws for a refusal. */
  run: (args: Record<string, unknown>, tab: Tab, tabId: string) => Promise<string>
}

const AMOUNT = {
  type: 'string',
  pattern: '^\\d+\\.\\d{6}$',
  description: 'USDC amount, six decimal places, e.g. "0.040000"',
}

export const CHAT_TOOLS: readonly ChatTool[] = [
  {
    name: 'tab_balance',
    description:
      'The tab’s current position: balance (negative means the agent owes), outstanding, ' +
      'pending holds, available headroom and the credit ceiling in force.',
    parameters: { type: 'object', properties: {}, required: [] },
    run: async (_args, tab, tabId) => {
      const s = await tab.state(tabId)
      return [
        `tab ${s.tab}`,
        `balance ${format(s.balance, { sign: 'always' })} (negative = the agent owes)`,
        `outstanding ${format(s.outstanding)} · holds ${format(s.holds)}`,
        `available ${format(s.available)} · ceiling ${format(s.ceiling)}`,
        `per-call cap ${format(s.perCallCap)} · ${s.entries} ledger entries`,
      ].join('\n')
    },
  },
  {
    name: 'tab_quote',
    description:
      'Check whether a spend would be allowed, WITHOUT reserving anything. Use before planning ' +
      'several purchases, or to explain what the agent can afford.',
    parameters: { type: 'object', properties: { max: AMOUNT }, required: ['max'] },
    run: async (args, tab, tabId) => {
      const q = await tab.quote({ tab: tabId, max: usdc(String(args['max'])) })
      return [
        q.affordable ? 'AFFORDABLE' : 'NOT AFFORDABLE',
        `available ${format(q.available)} · ceiling ${format(q.ceiling)} · per-call cap ${format(q.perCallCap)}`,
        ...(q.wouldRefuse ? [`would refuse: ${q.wouldRefuse} — ${q.reason ?? ''}`] : []),
      ].join('\n')
    },
  },
  {
    name: 'tab_ceiling',
    description:
      'The credit ceiling in force and the published arithmetic behind it — trailing revenue, ' +
      'the attested/unattested split, tier, ramp, and what bound it. Use to explain WHY the ' +
      'agent can or cannot afford something.',
    parameters: { type: 'object', properties: {}, required: [] },
    run: async (_args, tab, tabId) => {
      const c = await tab.ceiling(tabId)
      if (!c.published || !c.current) {
        return `No ceiling published yet. The gateway is enforcing ${format(c.enforced)} — the starter floor.`
      }
      const i = c.current.inputs
      return [
        `ceiling ${format(c.current.ceiling)} bound by ${c.current.binding} (cause ${c.current.cause})`,
        `revenue ${format(i.revenue)} — attested ${format(i.revenueAttested)}, unattested ${format(i.revenueUnattested)}`,
        `tier ${i.tier} x${i.multBp / 10_000} · ramp ${i.rampBp / 100}% · floor ${format(i.floor)}`,
        `published to HCS seq ${c.current.seq ?? '?'} under model ${c.current.model}`,
        `input hash ${c.current.hash}`,
      ].join('\n')
    },
  },
  {
    name: 'tab_counterparties',
    description:
      'Published independence weights for the tab’s counterparties, and the reason each was ' +
      'discounted or blocked. This is why revenue does or does not raise the ceiling — use it ' +
      'when asked about fraud, Sybil resistance, or why earnings did not count.',
    parameters: { type: 'object', properties: {}, required: [] },
    run: async (_args, tab, tabId) => {
      const rows = await tab.counterparties(tabId)
      if (rows.length === 0) return 'No weights published yet.'
      return rows
        .map((w) =>
          [
            `${w.counterparty}: ${w.bp / 100}%${w.blocking ? ' BLOCKED' : ''} · revenue ${format(w.revenue)} · share ${w.shareBp / 100}%`,
            ...w.reasons.map((r) => `  ${r} — ${WEIGHT_REASON_DETAIL[r]}`),
            ...(w.funder && w.tabFunder
              ? [
                  `  funded by ${w.funder}; the tab was funded by ${w.tabFunder}` +
                    (w.funder === w.tabFunder
                      ? ' — THE SAME ACCOUNT, which is exactly what COMMON_FUNDER tests'
                      : ''),
                ]
              : []),
          ].join('\n'),
        )
        .join('\n\n')
    },
  },
  {
    name: 'tab_spend',
    description:
      'Pay a seller from the tab, up to a cap. The agent holds no key — the gateway pays on its ' +
      'behalf against the earned ceiling. A REFUSED result is a normal answer, not an error: it ' +
      'names the rule that fired and what to do instead.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The seller URL to pay' },
        max: {
          type: 'string',
          description:
            'The MOST the gateway may pay for this ONE call, as USDC with six decimals ' +
            '(e.g. "0.050000"). This is a spending limit in DOLLARS, never a quantity of ' +
            'goods. Numbers inside the URL — the 25 in /feed/25 — are item counts and must ' +
            'NEVER be copied here. Omit this entirely when the user gave no budget.',
        },
      },
      required: ['url'],
    },
    run: async (args, tab, tabId) => {
      /*
       * `max` is omitted entirely when the user named no budget.
       *
       * It briefly defaulted to the tab's per-call cap here, which looked
       * sensible and quietly disarmed the cap: every spend then arrived exactly
       * AT the limit, passed the check, and failed at payment time against a
       * seller charging more. The refusal that is the whole point of the
       * product never fired, and an underwriting decision surfaced as a 502.
       *
       * The gateway reads the seller's quoted price from the x402 challenge and
       * underwrites THAT. A budget is the caller's to state or not.
       */
      const raw = args['max']
      const stated = raw === undefined || raw === null || String(raw).trim() === ''

      const result = await tab.spend({
        tab: tabId,
        url: String(args['url']),
        ...(stated ? {} : { max: usdc(String(raw)) }),
      })

      if (result.outcome === 'paid') {
        return [
          `PAID ${format(result.amount)} to ${result.seller}.`,
          `hold ${result.holdId}${result.receiptSeq !== null ? ` · receipt published to HCS at seq ${result.receiptSeq}` : ''}`,
          `The seller responded: ${typeof result.body === 'string' ? result.body : JSON.stringify(result.body)}`,
        ].join('\n')
      }

      if (result.outcome === 'refused') {
        /*
         * Returned, never thrown.
         *
         * A refusal is the rail working, and it is the single most interesting
         * thing a visitor can trigger. Surfacing it as an error would make the
         * model apologise for a bug instead of explaining a credit decision.
         */
        return [
          `REFUSED — the rule ${result.rule} fired.`,
          result.reason,
          ...(result.evidence
            ? [
                `Evidence: ${Object.entries(result.evidence)
                  .map(([k, v]) => `${k} ${v}`)
                  .join(', ')}`,
              ]
            : []),
          `Guidance: ${result.guidance}`,
          result.retryable
            ? 'This can clear on its own.'
            : 'Retrying the same call will be refused again for the same reason.',
        ].join('\n')
      }

      return (
        `FAILED after the decision to spend: ${result.reason}. This is NOT a refusal — it is ` +
        `unknown whether the seller was paid. A safe retry reuses idempotency key ${result.holdId}.`
      )
    },
  },
]

/** The tool list in the shape an OpenAI-compatible API expects. */
export function toolSchemas() {
  return CHAT_TOOLS.map((t) => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }))
}

export const TOOLS_BY_NAME = new Map(CHAT_TOOLS.map((t) => [t.name, t]))
