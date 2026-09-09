import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { format, toWire, usdc } from '@tab/money'
import { REFUSAL_GUIDANCE, WEIGHT_REASON_DETAIL } from '@tab/protocol'
import type { Tab } from '@tab/sdk'
import { z } from 'zod'
import type { McpConfig } from './config.ts'

/**
 * `@tab/mcp` — Tab's verbs as MCP tools.
 *
 * ## Why a standalone server, which the README left open
 *
 * The README offered two options: this, or documentation for loading
 * `@tab/agentkit-plugin` into `@hashgraph/hedera-agent-kit-mcp`. Option 2 is
 * the better ecosystem story and it is not the one to ship first, for reasons
 * that are about evidence rather than taste:
 *
 *  - It depends on TWO things that do not exist — the plugin is unwritten — and
 *    on an external server accepting third-party plugins in a shape nobody here
 *    has verified.
 *  - It cannot be demonstrated by a judge in one step. This can: three lines in
 *    a client config and Claude Desktop is spending on a Hedera tab.
 *  - It is additive later. A plugin can wrap the same `@tab/sdk` verbs whenever
 *    the Agent Kit path is confirmed, and nothing here has to be undone.
 *
 * So: option 1, and the reason is recorded here rather than in an ADR nobody
 * opens.
 *
 * ## The one invariant
 *
 * **A refusal is a structured result, not an error.** `isError: true` makes an
 * MCP client surface a failure and, worse, invites a model to retry it — and a
 * `CEILING_EXCEEDED` retried immediately is a spend that will be refused again
 * for the same reason. A refusal comes back as content the model can read,
 * carrying the rule, the evidence and what to do instead, because choosing
 * different work is the correct response and the agent can only choose it if it
 * is told why.
 *
 * Infrastructure failure IS an error, and the distinction is preserved from the
 * SDK: a refusal means the rail said no, `failed` means nobody said anything
 * and the caller does not know whether the seller was paid.
 */

/** Amounts cross MCP as decimal strings — `bigint` does not survive JSON. */
const AMOUNT = z
  .string()
  .regex(/^\d+\.\d{6}$/, 'six decimal places, e.g. "0.040000"')
  .describe('USDC amount as a decimal string with exactly six decimal places, e.g. "0.040000"')

/** Every tool returns text content; structured data goes in the same string. */
function text(body: string) {
  return { content: [{ type: 'text' as const, text: body }] }
}

function errorText(body: string) {
  return { content: [{ type: 'text' as const, text: body }], isError: true as const }
}

export function buildServer(tab: Tab, config: McpConfig): McpServer {
  const server = new McpServer(
    { name: 'tab', version: '0.1.0' },
    {
      instructions:
        `Tab is a credit rail on Hedera for this agent's tab ${config.tab}. The agent holds no ` +
        'key and signs nothing; the gateway pays sellers on its behalf against an earned ceiling. ' +
        'Call quote before a batch to learn what is affordable. A refused spend is a normal, ' +
        'expected answer that names the rule and what to do instead — read the guidance and choose ' +
        'different work rather than retrying the same call.',
    },
  )

  /* ── spend: the only verb that moves money ───────────────────────────────── */

  server.registerTool(
    'tab_spend',
    {
      title: 'Spend from the tab',
      description:
        'Pay a seller through the tab, up to `max`. The gateway reserves a hold, pays, then ' +
        'commits — so a crash cannot leave the tab overdrawn. Returns paid, refused or failed. ' +
        'A REFUSED result is not an error: it names the rule that fired and what to do instead.',
      inputSchema: {
        url: z
          .string()
          .url()
          .describe('The seller URL, including whatever the seller needs to be paid'),
        max: AMOUNT.describe(
          'The most this call may cost. The tab is debited what was actually settled, not this cap.',
        ),
        idempotencyKey: z
          .string()
          .min(8)
          .max(64)
          .optional()
          .describe(
            'Reuse the SAME key when retrying a failed call, or the retry may double-spend. ' +
              'Generated automatically when omitted.',
          ),
      },
      annotations: {
        title: 'Spend from the tab',
        // MOVES MONEY. The one tool here that is not safe to call speculatively,
        // and the one an MCP client should confirm with a human.
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ url, max, idempotencyKey }) => {
      const result = await tab.spend({
        tab: config.tab,
        url,
        max: usdc(max),
        ...(idempotencyKey ? { idempotencyKey } : {}),
      })

      if (result.outcome === 'paid') {
        return text(
          [
            `PAID ${format(result.amount)} USDC to ${result.seller}.`,
            `hold ${result.holdId}` +
              (result.receiptSeq !== null ? ` · receipt seq ${result.receiptSeq} on HCS` : ''),
            `took ${Math.round(result.elapsedMs / 1000)}s`,
            '',
            'The seller responded:',
            typeof result.body === 'string' ? result.body : JSON.stringify(result.body, null, 2),
          ].join('\n'),
        )
      }

      if (result.outcome === 'refused') {
        /*
         * NOT `isError`. See the header.
         *
         * The guidance comes from `@tab/protocol`, not from a string invented
         * here — the same text the HTTP API and the console show, so an agent
         * that learns the rail through MCP learns the same rail.
         */
        const evidence = result.evidence
          ? Object.entries(result.evidence)
              .map(([k, v]) => `  ${k} ${v}`)
              .join('\n')
          : '  (none published)'
        return text(
          [
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
              : 'Retrying this exact call will be refused again for the same reason. Choose different work.',
          ].join('\n'),
        )
      }

      /*
       * `failed` IS an error, and says the one thing that matters.
       *
       * Infrastructure broke AFTER the decision to spend, so nobody knows
       * whether the seller was paid. A caller that retries MUST reuse the hold
       * id as its idempotency key, or the retry is a second payment.
       */
      return errorText(
        [
          `FAILED — ${result.reason}`,
          '',
          'This is NOT a refusal. The rail did not say no; nobody said anything, and it is ' +
            'unknown whether the seller was paid.',
          `To retry safely, call tab_spend again with idempotencyKey "${result.holdId}" — the ` +
            'gateway treats it as the same attempt. A new key would be a second payment.',
          'The hold expires on its own, so the headroom is not lost permanently.',
        ].join('\n'),
      )
    },
  )

  /* ── quote: what can I afford, reserving nothing ─────────────────────────── */

  server.registerTool(
    'tab_quote',
    {
      title: 'Check affordability without reserving',
      description:
        'Ask whether a spend of `max` would be allowed, WITHOUT taking a hold. Use this before ' +
        'planning a batch: a hold taken by a quote would be headroom the agent never uses.',
      inputSchema: { max: AMOUNT },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ max }) => {
      const q = await tab.quote({ tab: config.tab, max: usdc(max) })
      return text(
        [
          q.affordable ? `AFFORDABLE — ${format(usdc(max))} is within the tab.` : 'NOT AFFORDABLE',
          `available    ${format(q.available)}`,
          `ceiling      ${format(q.ceiling)}`,
          `per-call cap ${format(q.perCallCap)}`,
          ...(q.wouldRefuse
            ? [
                '',
                `would refuse: ${q.wouldRefuse}`,
                `${q.reason ?? ''}`,
                REFUSAL_GUIDANCE[q.wouldRefuse],
              ]
            : []),
        ]
          .filter(Boolean)
          .join('\n'),
      )
    },
  )

  /* ── the read verbs ──────────────────────────────────────────────────────── */

  server.registerTool(
    'tab_balance',
    {
      title: 'Tab position',
      description:
        'The tab’s current position: balance (negative means the agent owes), outstanding, ' +
        'holds, available headroom and the ceiling in force.',
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      const s = await tab.state(config.tab)
      return text(
        [
          `tab          ${s.tab}`,
          `balance      ${format(s.balance, { sign: 'always' })}   (negative means the agent owes)`,
          `outstanding  ${format(s.outstanding)}`,
          `holds        ${format(s.holds)}`,
          `available    ${format(s.available)}`,
          `ceiling      ${format(s.ceiling)}`,
          `per-call cap ${format(s.perCallCap)}`,
          `window       ${s.window} · ${s.entries} ledger entries`,
        ].join('\n'),
      )
    },
  )

  server.registerTool(
    'tab_ceiling',
    {
      title: 'The ceiling, and the arithmetic behind it',
      description:
        'The credit ceiling in force, what bound it, and the published inputs it was computed ' +
        'from. Use this to explain to a user WHY the tab can or cannot afford something.',
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      const c = await tab.ceiling(config.tab)
      if (!c.published || !c.current) {
        return text(
          [
            `No ceiling published yet for ${c.tab} — normal for a tab's first minutes.`,
            `The gateway is enforcing ${format(c.enforced)} meanwhile (the starter floor).`,
            c.note ?? '',
          ]
            .filter(Boolean)
            .join('\n'),
        )
      }
      const i = c.current.inputs
      return text(
        [
          `ceiling      ${format(c.current.ceiling)}   bound by ${c.current.binding}`,
          `enforced now ${format(c.enforced)}` +
            (c.enforced !== c.current.ceiling
              ? '   (the gateway polls the topic every 15s, so this is what a spend is checked against)'
              : ''),
          `cause        ${c.current.cause}`,
          '',
          'Published inputs:',
          `  trailing revenue  ${format(i.revenue)}  (attested ${format(i.revenueAttested)} · unattested ${format(i.revenueUnattested)})`,
          `  tier              ${i.tier}  ×${i.multBp / 10_000}`,
          `  earned ramp       ${i.rampBp / 100}%`,
          `  hard cap          ${format(i.cap)}`,
          `  starter floor     ${format(i.floor)}`,
          ...(i.defaulted
            ? ['  DEFAULTED         this tab has missed a settlement, so the ceiling is zero']
            : []),
          '',
          `model ${c.current.model} · HCS seq ${c.current.seq ?? '?'} · input hash ${c.current.hash}`,
          'Anyone can recompute this from the public topic: pnpm verify-ceiling.',
        ].join('\n'),
      )
    },
  )

  server.registerTool(
    'tab_receipts',
    {
      title: 'Recent receipts',
      description:
        'The tab’s recent ledger entries from the HCS receipt topic — holds, debits, ' +
        'credits, refusals and settlements, newest first.',
      inputSchema: {
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .default(10)
          .describe('How many entries, newest first'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ limit }) => {
      const rows = await tab.receipts(config.tab)
      const recent = rows.slice(-limit).reverse()
      if (recent.length === 0) return text('No receipts yet for this tab.')
      return text(
        recent
          .map((r) => {
            const amount = r.amount !== undefined ? format(r.amount, { sign: 'always' }) : '—'
            return [
              r.leg.toUpperCase().padEnd(11),
              amount.padStart(10),
              (r.counterparty ?? '—').padEnd(14),
              r.rule ?? '',
              r.seq !== undefined ? `seq ${r.seq}` : 'unpublished',
            ]
              .filter(Boolean)
              .join('  ')
          })
          .join('\n'),
      )
    },
  )

  server.registerTool(
    'tab_counterparties',
    {
      title: 'Who counts as independent revenue',
      description:
        'Published independence weights for the tab’s counterparties, with the reason each ' +
        'was discounted or blocked. This is why revenue does or does not raise the ceiling.',
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      const rows = await tab.counterparties(config.tab)
      if (rows.length === 0) return text('No weights published yet. Run the engine.')
      return text(
        rows
          .map((w) =>
            [
              `${w.counterparty}  ${w.bp / 100}%${w.blocking ? '  BLOCKED' : ''}`,
              `  revenue ${format(w.revenue)} · share ${w.shareBp / 100}%`,
              ...w.reasons.map((r) => `  ${r}: ${WEIGHT_REASON_DETAIL[r]}`),
              ...(w.funder && w.tabFunder
                ? [
                    `  funded by ${w.funder} · tab funded by ${w.tabFunder}` +
                      (w.funder === w.tabFunder
                        ? '  ← SAME, which is what COMMON_FUNDER tests'
                        : ''),
                  ]
                : []),
            ].join('\n'),
          )
          .join('\n\n'),
      )
    },
  )

  server.registerTool(
    'tab_health',
    {
      title: 'Is the rail up',
      description: 'Gateway reachability, network, token and current window.',
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      const h = await tab.health()
      return text(
        [
          h.ok ? 'Gateway is up.' : 'Gateway responded but did not report OK.',
          `network ${h.network} · token ${h.token} · window ${h.window}`,
          h.demoMode ? 'DEMO MODE is on — window length is overridden for demonstration.' : '',
          `gateway ${config.gatewayUrl} · tab ${config.tab}`,
        ]
          .filter(Boolean)
          .join('\n'),
      )
    },
  )

  return server
}

/** Re-exported so a consumer can serialise an amount the way the tools expect. */
export { toWire }
