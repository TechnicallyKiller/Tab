import Fastify, { type FastifyInstance } from 'fastify'
import { format, usdc } from '@tab/money'
import { REFUSAL_GUIDANCE, isRetryable } from '@tab/protocol'
import { nowConsensus } from './receipts.ts'
import { spend, type SpendDeps } from './spend.ts'

/**
 * The gateway's HTTP surface.
 *
 * A refusal is a 200 with a discriminated body, NOT an error status. Handling
 * refusal is the agent developer's main job, and forcing every consumer into a
 * try/catch to read the rule would make the Refusals view harder to build —
 * refusal is the product working, not a fault.
 */
export function buildServer(deps: SpendDeps): FastifyInstance {
  const app = Fastify({ logger: false })

  app.get('/health', async () => ({
    ok: true,
    network: deps.env.network,
    token: deps.env.tokenId,
    window: deps.window(),
    demoMode: deps.env.demoMode,
  }))

  /** The spend leg. The agent asks; the gateway decides, pays and records. */
  app.post('/v1/spend', async (request, reply) => {
    const body = request.body as { tab?: string; url?: string; max?: string; idempotencyKey?: string }

    if (!body?.url || !body?.max || !body?.tab) {
      return reply.status(400).send({
        error: 'tab, url and max are required',
        example: { tab: '0.0.8812188', url: 'https://seller/x?payTo=0.0.1', max: '0.040000' },
      })
    }

    let max
    try {
      max = usdc(body.max)
    } catch {
      return reply.status(400).send({
        error: `max must be a decimal amount like "0.040000", received ${JSON.stringify(body.max)}`,
      })
    }

    const outcome = await spend(deps, {
      tab: body.tab,
      url: body.url,
      max,
      ...(body.idempotencyKey ? { idempotencyKey: body.idempotencyKey } : {}),
    })

    if (outcome.outcome === 'refused') {
      // 200, deliberately. The agent got a real answer: no, and why.
      return reply.status(200).send({
        refused: {
          rule: outcome.rule,
          reason: outcome.reason,
          evidence: outcome.evidence,
          guidance: REFUSAL_GUIDANCE[outcome.rule],
          retryable: isRetryable(outcome.rule),
        },
        available: format(outcome.available),
      })
    }

    if (outcome.outcome === 'failed') {
      // 502, deliberately. Infrastructure failed — this is NOT a refusal and
      // must not pollute the Refusals view.
      return reply.status(502).send({
        error: outcome.reason,
        holdId: outcome.holdId,
        note: 'The hold expires on its own. This is a transport failure, not a refusal.',
      })
    }

    return reply.status(200).send({
      paid: {
        amount: format(outcome.amount),
        seller: outcome.seller,
        holdId: outcome.holdId,
        receiptSeq: outcome.receiptSeq,
        elapsedMs: outcome.elapsedMs,
      },
      body: outcome.body,
    })
  })

  /** What the SDK and dashboard read. */
  app.get('/v1/tabs/:tab', async (request) => {
    const { tab } = request.params as { tab: string }
    const at = nowConsensus()
    const p = deps.state.position(tab, at)
    return {
      tab,
      window: deps.window(),
      balance: format(p.balance),
      outstanding: format(p.outstanding),
      holds: format(p.holds),
      available: format(p.available),
      ceiling: format(p.ceiling),
      perCallCap: format(deps.env.perCallCap),
      entries: deps.state.entriesFor(tab).length,
    }
  })

  app.get('/v1/tabs/:tab/holds', async (request) => {
    const { tab } = request.params as { tab: string }
    return deps.state.holds(tab, nowConsensus()).map((h) => ({
      ...h,
      amount: format(h.amount),
    }))
  })

  app.get('/v1/tabs/:tab/entries', async (request) => {
    const { tab } = request.params as { tab: string }
    return deps.state.entriesFor(tab).map((e) => ({
      ...e,
      amount: 'amount' in e ? format(e.amount) : undefined,
      requested: 'requested' in e ? format(e.requested) : undefined,
    }))
  })

  return app
}
