import { createTab } from '@tab/sdk'
import OpenAI from 'openai'
import { TOOLS_BY_NAME, toolSchemas } from '@/lib/chat/tools'

/**
 * The chat agent — a language model holding Tab's verbs.
 *
 * ## Why this route exists
 *
 * Everything else in this project asks a reader to take a demo's word for it.
 * Here a visitor types a sentence, watches a model decide to spend, and sees
 * the receipt land on Hedera. No clone, no install, no wallet.
 *
 * ## Why letting strangers spend is safe
 *
 * It is bounded by the product being demonstrated. The per-call cap is
 * `0.050000`, the ceiling `0.250000`, the window cap `1.000000` — a visitor
 * cannot take more than the rail allows, and when they hit the wall they get a
 * refusal, which is the thing worth showing anyway. It is faucet testnet USDC.
 *
 * The credential never reaches the browser: this is a server route, the key is
 * read from the environment here, and the client only ever sees messages and a
 * trace of what was called.
 *
 * ## Provider-agnostic on purpose
 *
 * Pointed at any OpenAI-compatible endpoint — Groq, Gemini's compatibility
 * layer, Cerebras, OpenRouter — through `LLM_BASE_URL`. Free tiers rate-limit,
 * and being able to move providers by changing one environment variable is the
 * difference between a demo that survives judging and one that does not.
 */

export const runtime = 'nodejs'
/*
 * A spend waits on the seller's x402 settlement, measured at 25-39s for an HTS
 * token, and the model may call a tool or two around it. The platform default
 * is often 10s, which would cut a payment off mid-flight and leave the caller
 * unable to tell a slow seller from a failed one.
 */
export const maxDuration = 60

const SYSTEM = `You are an autonomous AI agent with a "tab" on Hedera.

You hold no private key and sign nothing. When you buy something, a gateway pays
the seller on your behalf, against a credit ceiling you EARNED from revenue that
was independently verified — not a limit somebody granted you.

Use your tools to answer. Prefer doing over describing: if asked what you can
afford, call tab_quote; if asked why your limit is what it is, call tab_ceiling
and read out the actual arithmetic.

A REFUSED spend is a normal, expected answer and NOT an error. It names the rule
that fired and what to do instead. Explain the rule plainly and suggest
different work — never apologise for it as though something broke, and never
retry the identical call when the refusal says it is not retryable.

When buying, the price is set by the SELLER and discovered from its 402
challenge — you do not choose it, and you must NEVER ask the user what to pay.
A number in a URL path (the 25 in /feed/25) is how many items to buy, never how
many dollars to spend.

If the user names no dollar budget, call tab_spend with "url" alone and omit
"max" entirely: the tab's per-call cap applies automatically. Asking "how much
would you like to spend?" is always the wrong move — the whole point is that
spending is bounded by a ceiling the agent earned, so just attempt the purchase
and report what came back, whether that is a payment or a refusal.

Be concise. Quote real figures from tool results rather than paraphrasing them.`

/** Bounded so one visitor cannot spin the loop, and so a reply always arrives. */
const MAX_STEPS = 6

interface Step {
  tool: string
  args: Record<string, unknown>
  result: string
}

export async function POST(request: Request) {
  const apiKey = process.env['LLM_API_KEY']
  const baseURL = process.env['LLM_BASE_URL'] ?? 'https://api.groq.com/openai/v1'
  /*
   * The default WILL go stale. Groq retires models on its own schedule and
   * `llama-3.3-70b-versatile` was already withdrawn once, which took the chat
   * page down with a bare 404 that named no alternative.
   *
   * So the default is a current tool-calling model, and the 404 below is
   * turned into the list of models the key can actually reach. A deprecation
   * should cost one environment variable, not an afternoon of guessing names.
   */
  const model = process.env['LLM_MODEL'] ?? 'openai/gpt-oss-120b'
  const gatewayUrl = process.env['TAB_GATEWAY_URL'] ?? process.env['NEXT_PUBLIC_TAB_GATEWAY_URL']
  const tabId = process.env['TAB_ACCOUNT_ID'] ?? process.env['NEXT_PUBLIC_TAB_ACCOUNT_ID']

  if (!apiKey || !gatewayUrl || !tabId) {
    /*
     * 503 with the reason, rather than a generic 500.
     *
     * An unconfigured demo is a deployment state, not a bug, and saying which
     * variable is missing is the difference between a five-minute fix and an
     * afternoon.
     */
    return Response.json(
      {
        error: 'The chat agent is not configured.',
        missing: [
          !apiKey ? 'LLM_API_KEY' : null,
          !gatewayUrl ? 'TAB_GATEWAY_URL' : null,
          !tabId ? 'TAB_ACCOUNT_ID' : null,
        ].filter(Boolean),
      },
      { status: 503 },
    )
  }

  const body = (await request.json()) as { messages?: { role: string; content: string }[] }
  const incoming = (body.messages ?? []).slice(-12) // bounded history

  const llm = new OpenAI({ apiKey, baseURL })
  const tab = createTab({ baseUrl: gatewayUrl, timeoutMs: 45_000, maxRetries: 0 })

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM },
    ...incoming.map((m) => ({
      role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
      content: String(m.content),
    })),
  ]

  const steps: Step[] = []

  try {
    for (let i = 0; i < MAX_STEPS; i++) {
      const completion = await llm.chat.completions.create({
        model,
        messages,
        tools: toolSchemas(),
        tool_choice: 'auto',
      })

      const choice = completion.choices[0]?.message
      if (!choice) break

      const calls = choice.tool_calls ?? []
      if (calls.length === 0) {
        return Response.json({ reply: choice.content ?? '', steps })
      }

      messages.push(choice)

      for (const call of calls) {
        if (call.type !== 'function') continue
        const tool = TOOLS_BY_NAME.get(call.function.name)

        let result: string
        let args: Record<string, unknown> = {}
        if (!tool) {
          result = `No such tool: ${call.function.name}`
        } else {
          try {
            args = JSON.parse(call.function.arguments || '{}') as Record<string, unknown>
            result = await tool.run(args, tab, tabId)
          } catch (error) {
            /*
             * A tool failure goes back to the MODEL, not to the user as a 500.
             *
             * The gateway being briefly unreachable is something the agent can
             * report in its own words; turning it into a blank error page loses
             * both the explanation and the rest of the conversation.
             */
            result = `The tool failed: ${error instanceof Error ? error.message : String(error)}`
          }
        }

        steps.push({ tool: call.function.name, args, result })
        messages.push({ role: 'tool', tool_call_id: call.id, content: result })
      }
    }

    // Ran out of steps with the model still calling tools.
    return Response.json({
      reply:
        'I ran out of steps before finishing. Here is what I did along the way — ask me to ' +
        'continue if you want the rest.',
      steps,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    /*
     * A retired model is the one failure worth spending a round trip on.
     *
     * The provider answers "does not exist or you do not have access to it",
     * which is indistinguishable from a typo and names no replacement. Asking
     * /models turns a dead end into the exact value to put in LLM_MODEL.
     *
     * Best-effort: if the listing also fails, the original error still goes
     * back. Reporting a diagnostic failure INSTEAD of the fault it was
     * diagnosing would be strictly worse than not trying.
     */
    if (/does not exist|model_not_found|404/i.test(message)) {
      const available = await llm.models
        .list()
        .then((r) => r.data.map((m) => m.id).sort())
        .catch(() => [])

      return Response.json(
        {
          error: `The model "${model}" is not available on this provider.`,
          hint: available.length
            ? 'Set LLM_MODEL to one of the models below and redeploy.'
            : 'Could not read the provider model list either — check LLM_API_KEY.',
          available,
          steps,
        },
        { status: 502 },
      )
    }

    return Response.json(
      {
        error: /rate|429|quota/i.test(message)
          ? 'The free LLM tier is rate-limited right now. Give it a moment and try again.'
          : message,
        steps,
      },
      { status: 502 },
    )
  }
}
