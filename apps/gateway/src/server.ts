import type { PublishedCeiling } from '@tab/ledger'
import { type MicroUsdc, toWire, usdc } from '@tab/money'
import { isRetryable, REFUSAL_GUIDANCE } from '@tab/protocol'
import { type Asset, createEarnServer, type TabFacilitator } from '@tab/x402'
import { paymentMiddleware } from '@x402/fastify'
import Fastify, { type FastifyInstance } from 'fastify'
import { type AgentEndpoint, serveAndCredit } from './earn.ts'
import { nowConsensus } from './receipts.ts'
import { type SpendDeps, spend } from './spend.ts'

/**
 * The gateway's HTTP surface.
 *
 * A refusal is a 200 with a discriminated body, NOT an error status. Handling
 * refusal is the agent developer's main job, and forcing every consumer into a
 * try/catch to read the rule would make the Refusals view harder to build —
 * refusal is the product working, not a fault.
 */
export interface EarnConfig {
  facilitator: TabFacilitator
  asset: Asset
  network: string
  endpoint: AgentEndpoint
}

/**
 * One published ceiling, on the wire.
 *
 * Amounts through `toWire`; basis points stay integers. `inputs` is renamed
 * from the terse on-topic keys (`revAtt`, `mult`) to readable ones, which is
 * safe ONLY because nothing rehashes this: `hash` is over the canonical
 * on-topic object, and `tools/verify` reads the topic directly rather than
 * this endpoint. Renaming keys in a payload someone might rehash would make
 * every ceiling look forged.
 */
function wireCeiling(c: PublishedCeiling) {
  return {
    ceiling: toWire(c.ceiling),
    ...(c.computed ? { computed: toWire(c.computed) } : {}),
    window: c.window,
    binding: c.binding,
    cause: c.cause,
    at: c.at,
    model: c.model,
    hash: c.hash,
    ...(c.seq !== undefined ? { seq: c.seq } : {}),
    inputs: {
      revenue: toWire(c.inputs.rev),
      revenueAttested: toWire(c.inputs.revAttested),
      revenueUnattested: toWire(c.inputs.revUnattested),
      tier: c.inputs.tier,
      multBp: c.inputs.multBp,
      rampBp: c.inputs.rampBp,
      cap: toWire(c.inputs.cap),
      floor: toWire(c.inputs.floor),
      defaulted: c.inputs.defaulted,
    },
  }
}

export function buildServer(deps: SpendDeps, earn?: EarnConfig): FastifyInstance {
  /*
   * `trustProxy` because the earn leg runs behind Render's TLS terminator.
   *
   * @x402/fastify builds the 402 challenge's `resource.url` from
   * `request.protocol`, and Fastify reports `http` unless it is told to honour
   * `X-Forwarded-Proto`. So a payer that fetched `https://…` was handed a
   * challenge naming `http://…` — a different resource than the one it asked
   * for, in the document it then signs over.
   *
   * It is only a hosting detail, and locally there is no proxy and nothing
   * changes. It surfaced by curling the deployed service, not from any test,
   * because no test runs behind a proxy.
   */
  const app = Fastify({ logger: false, trustProxy: true })

  /*
   * CORS, split by method on purpose.
   *
   * The console runs in a browser on a different origin (Vercel, or :3000 in
   * development) and every request it makes is cross-origin. Without these
   * headers the browser blocks the response and the console shows
   * "GATEWAY UNREACHABLE" — while curl succeeds, because CORS is a browser
   * rule and nothing else honours it. That is exactly how this was missed.
   *
   * READS are `*`. Every one of them serves what is already published on a
   * public HCS topic; anyone can replay the same data from a mirror node, so
   * there is nothing for an allow-list to protect.
   *
   * /v1/spend is NOT `*`, and is limited to origins named in `CORS_ORIGINS`.
   * It has no authentication, so a wildcard would let any page on the internet
   * make a visitor's browser spend against a tab. The allow-list does not fix
   * the missing auth — a direct POST is unaffected, since CORS never protects
   * a non-browser client — but a public endpoint should not additionally
   * conscript passing browsers into calling it.
   *
   * `CORS_ORIGINS` is a comma-separated list of exact origins. Unset means no
   * browser origin may spend, which is the safe default for a fresh deploy.
   */
  const spendOrigins = (process.env['CORS_ORIGINS'] ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)

  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin
    if (!origin) return // same-origin or a non-browser client; CORS does not apply

    // On a preflight the real method is in the header, not on the request.
    const intended =
      request.method === 'OPTIONS'
        ? ((request.headers['access-control-request-method'] as string | undefined) ?? 'GET')
        : request.method

    const allow =
      intended === 'GET' || intended === 'HEAD'
        ? '*'
        : spendOrigins.includes(origin)
          ? origin
          : null

    if (allow !== null) {
      reply.header('access-control-allow-origin', allow)
      // Echoing a specific origin makes the response origin-dependent, so it
      // must not be cached and served to a different one.
      if (allow !== '*') reply.header('vary', 'Origin')
    }

    /*
     * Preflights are answered HERE rather than by a route.
     *
     * Fastify has no OPTIONS handler for these paths, so a preflight would 404
     * — and a 404 preflight fails the CORS check just as surely as a missing
     * header, with a browser error that points at the wrong thing.
     *
     * A DISALLOWED origin is answered 204 without the allow header rather than
     * with an error status: the browser must reject it, and it reads the
     * absence of the header, not the status code. Sending 403 would put a
     * misleading error in the console for what is a policy decision.
     */
    if (request.method === 'OPTIONS') {
      if (allow !== null) {
        reply.header('access-control-allow-methods', 'GET, POST, OPTIONS')
        reply.header('access-control-allow-headers', 'content-type')
        reply.header('access-control-max-age', '86400')
      }
      return reply.code(204).send()
    }
  })

  /*
   * AMOUNT FIELDS IN JSON USE `toWire`, NEVER `format`.
   *
   * `format` is a DISPLAY function: it truncates to 4 decimals and uses a
   * U+2212 minus. Serving it as an API value is lossy and was — `1.234567`
   * went out as `"1.2345"` and parsed back as `1234500`, silently dropping 67
   * micro-USDC. A dashboard built on that cannot match HashScan, which is the
   * one thing a dashboard must do.
   *
   * `toWire` gives six decimals and an ASCII minus, which `usdc()` round-trips
   * exactly. Prose messages may still embed `format` inside a sentence, where
   * a human is the reader and 4dp is the point.
   */
  // ── the EARN leg ────────────────────────────────────────────────────────
  //
  // The gateway fronts the agent's endpoint. x402 answers the 402, verifies and
  // settles the inbound payment into the hot float, and only then does the
  // handler below run — so by the time we forward upstream, the money has
  // already moved and the credit is attestable.
  if (earn) {
    const route = 'GET /v1/earn'
    const built = createEarnServer({
      network: earn.network,
      facilitator: earn.facilitator,
      routes: [
        {
          route,
          // Payment lands in the hot float, never in the agent's hands. The
          // agent holds nothing — that is the entire premise.
          payTo: deps.env.operatorId,
          asset: earn.asset,
          atomicPrice: earn.endpoint.atomicPrice,
          description: earn.endpoint.description,
        },
      ],
    })
    paymentMiddleware(app, built.routes as never, built.server as never)

    app.get('/v1/earn', async (request, reply) => {
      const payer = (request.query as { payer?: string }).payer ?? 'unknown'

      /*
       * The settlement transaction id, from the middleware that just settled.
       *
       * `x402Context.beforeHandlerSettlement` is the settle result, and it is
       * available here because the payment moved BEFORE this handler ran. The
       * route used to pass nothing, so every credit receipt fell back to
       * `unsettled:<timestamp>` and the reconciler had no id to match it
       * against — a receipt claiming money moved, with nothing tying it to the
       * transfer that moved it. Only accept a SUCCESS: a failed settle can
       * still carry an id, and recording that would assert a movement that
       * did not happen.
       */
      const settled = (
        request as unknown as {
          x402Context?: {
            beforeHandlerSettlement?: { result?: { success?: boolean; transaction?: string } }
          }
        }
      ).x402Context?.beforeHandlerSettlement?.result

      const result = await serveAndCredit(
        {
          env: deps.env,
          state: deps.state,
          receipts: deps.receipts,
          window: deps.window,
          endpoint: earn.endpoint,
        },
        {
          payer,
          path: '/serve',
          ...(settled?.success && settled.transaction ? { settlementTx: settled.transaction } : {}),
        },
      )
      return reply.status(result.status).send({
        served: result.body,
        credited: {
          amount: toWire(earn.endpoint.atomicPrice),
          attested: result.status >= 200 && result.status < 300,
          receiptSeq: result.receiptSeq,
          written: result.creditWritten,
        },
      })
    })
  }

  app.get('/health', async () => ({
    ok: true,
    network: deps.env.network,
    token: deps.env.tokenId,
    window: deps.window(),
    demoMode: deps.env.demoMode,
    /*
     * The topic ids, so a reader can go and check for themselves.
     *
     * Served at RUNTIME rather than baked into the console at build time, and
     * the difference is not cosmetic: the console's HashScan links pointed at
     * `0.0.4881203` — a MOCK topic id left over from the mock data — so anyone
     * clicking "view on HashScan" landed on a topic that is not ours. On the one
     * screen whose job is "do not trust me, go and look", that is worse than
     * having no link at all.
     *
     * Coming from the same place the data comes from means they cannot drift
     * apart again: if the gateway is reading a topic, that is the topic it names.
     */
    topics: {
      receipts: deps.env.receiptTopic,
      ceilings: deps.env.ceilingTopic,
      settlements: deps.env.settlementTopic,
    },
  }))

  /** The spend leg. The agent asks; the gateway decides, pays and records. */
  app.post('/v1/spend', async (request, reply) => {
    const body = request.body as {
      tab?: string
      url?: string
      max?: string
      idempotencyKey?: string
    }

    if (!body?.url || !body?.tab) {
      return reply.status(400).send({
        error: 'tab and url are required',
        example: { tab: '0.0.8812188', url: 'https://seller/feed/25', max: '0.040000' },
      })
    }

    /*
     * `max` is OPTIONAL, and omitting it is the normal case.
     *
     * The seller states its price in the x402 challenge, so a caller with no
     * particular budget has nothing to add — and requiring the field forced
     * exactly that invention. Supply it to spend LESS than the seller asks (the
     * call is then refused rather than underpaid); omit it to accept the quote,
     * subject to every underwriting check as usual.
     */
    let max: MicroUsdc | undefined
    if (body.max !== undefined) {
      try {
        max = usdc(body.max)
      } catch {
        return reply.status(400).send({
          error: `max must be a decimal amount like "0.040000", received ${JSON.stringify(body.max)}`,
        })
      }
    }

    const outcome = await spend(deps, {
      tab: body.tab,
      url: body.url,
      // Spread rather than assigned: `exactOptionalPropertyTypes` treats an
      // explicit `undefined` as different from an absent key, and absent is
      // what "no budget stated" means.
      ...(max !== undefined ? { max } : {}),
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
        available: toWire(outcome.available),
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
        amount: toWire(outcome.amount),
        seller: outcome.seller,
        holdId: outcome.holdId,
        receiptSeq: outcome.receiptSeq,
        elapsedMs: outcome.elapsedMs,
      },
      body: outcome.body,
    })
  })

  /** What the SDK and dashboard read. */
  /**
   * Every tab this gateway knows about.
   *
   * "Knows about" is the honest framing, and the console says so: this is
   * whatever appeared on the RECEIPT TOPIC during replay, not a registry.
   * **Nothing writes a `register` message yet** — one Starter Tab per funding
   * root is unenforced, and the README labels it OPEN — so there is no
   * registration timestamp to report and none is invented. A tab appears here
   * the first time it spends or earns, and that is all this endpoint claims.
   *
   * Deliberately unpaginated. `state.tabs()` is bounded by the number of tabs
   * that have ever transacted against this gateway, which on testnet is three;
   * a cursor here would be an interface promising a scale the projection does
   * not have (it is a single-instance in-memory map — see `state.ts`).
   */
  app.get('/v1/tabs', async () => {
    const at = nowConsensus()
    const ceilings = deps.ceilings?.()
    const registrations = deps.registrations?.()
    return {
      window: deps.window(),
      /*
       * Stated on the response, not left for a reader to assume.
       *
       * This was `false` with a note saying no registration flow existed. It
       * does now: the engine resolves each tab's funding root from the
       * published `graphFact` messages and claims it, first claim winning
       * permanently, so a hundred agents minted from one wallet yield ONE
       * starter grant. The flag stays on the response rather than in the view
       * because every consumer needs to know which rule is in force.
       *
       * `true` describes the RULE, not the data: it is enforced on every engine
       * pass whether or not any root has been claimed yet. `rootsClaimed` is
       * the data, and a reader wanting "has this actually run" should look
       * there rather than at the flag.
       */
      registrationEnforced: true,
      rootsClaimed: deps.rootsClaimed?.() ?? 0,
      note:
        'One Starter Tab per funding root, enforced by the engine: a tab whose root is already ' +
        'claimed by another tab gets NO starter floor and must earn its ceiling from independent ' +
        'revenue. Tabs themselves appear here the first time they spend or earn.',
      tabs: deps.state.tabs().map((tab) => {
        const p = deps.state.position(tab, at)
        const published = ceilings?.get(tab)?.at(-1)
        return {
          tab,
          balance: toWire(p.balance),
          outstanding: toWire(p.outstanding),
          holds: toWire(p.holds),
          available: toWire(p.available),
          /** What the fast path enforces for this tab, right now. */
          ceiling: toWire(p.ceiling),
          entries: deps.state.entriesFor(tab).length,
          /*
           * The Starter Tab claim this tab holds, when it holds one.
           *
           * Absent means the engine has not registered it yet — NOT that it was
           * denied. The gateway cannot tell those apart: resolving a funding
           * root needs `@tab/graph`, which it may not import, and guessing
           * would put a verdict on screen that no topic carries.
           */
          ...(registrations?.get(tab)
            ? {
                registeredRoot: registrations.get(tab)!.root,
                registeredAt: registrations.get(tab)!.at,
                registrationSeq: registrations.get(tab)!.seq,
                // The HCS-14 identifier, when one was published.
                ...(registrations.get(tab)!.uaid ? { uaid: registrations.get(tab)!.uaid } : {}),
              }
            : {}),
          // Present only when the engine has published for this tab. A tier is
          // never guessed from the balance — an unpublished tab has no tier,
          // which is a different fact from being Unrated.
          ...(published
            ? {
                tier: published.inputs.tier,
                publishedCeiling: toWire(published.ceiling),
                binding: published.binding,
                cause: published.cause,
                model: published.model,
                seq: published.seq,
              }
            : {}),
        }
      }),
    }
  })

  app.get('/v1/tabs/:tab', async (request) => {
    const { tab } = request.params as { tab: string }
    const at = nowConsensus()
    const p = deps.state.position(tab, at)
    return {
      tab,
      window: deps.window(),
      balance: toWire(p.balance),
      outstanding: toWire(p.outstanding),
      holds: toWire(p.holds),
      available: toWire(p.available),
      ceiling: toWire(p.ceiling),
      perCallCap: toWire(deps.env.perCallCap),
      entries: deps.state.entriesFor(tab).length,
    }
  })

  app.get('/v1/tabs/:tab/holds', async (request) => {
    const { tab } = request.params as { tab: string }
    return deps.state.holds(tab, nowConsensus()).map((h) => ({
      ...h,
      amount: toWire(h.amount),
    }))
  })

  /**
   * Published independence weights, for the Counterparties view.
   *
   * Served from what the ENGINE published to HCS, not recomputed here — the
   * gateway cannot import `@tab/graph` and should not: recomputing would give
   * the console a second answer to compare against the topic, and two answers
   * is worse than one even when they agree.
   */
  app.get('/v1/tabs/:tab/counterparties', async (request) => {
    const { tab } = request.params as { tab: string }
    const weights = deps.weights?.() ?? new Map()
    const facts = deps.facts?.()

    /*
     * The tab's OWN funder, carried on every row.
     *
     * Denormalised on purpose. `COMMON_FUNDER` is decided by comparing exactly
     * two values — `facts[tab].funder` and `facts[counterparty].funder` — and
     * putting both on the row makes each one self-contained: a reader can check
     * the rule without holding the rest of the response in their head, and the
     * console does not have to correlate two shapes to render one sentence.
     *
     * These are the values the rule actually compared, not a re-derivation. The
     * gateway cannot import `@tab/graph` and does not need to.
     */
    const tabFacts = facts?.get(tab)

    return [...weights.values()]
      .filter((w) => w.tab === tab)
      .sort((a, b) => b.shareBp - a.shareBp || (a.counterparty < b.counterparty ? -1 : 1))
      .map((w) => {
        const own = facts?.get(w.counterparty)
        return {
          counterparty: w.counterparty,
          bp: w.bp,
          reasons: w.reasons,
          blocking: w.blocking,
          revenue: toWire(w.revenue),
          shareBp: w.shareBp,
          window: w.window,
          at: w.at,
          ...(w.token ? { token: w.token } : {}),
          /*
           * Absent when nothing has been published for this account.
           *
           * Never defaulted. A counterparty whose provenance we have not
           * observed is a DIFFERENT fact from one funded by nobody, and the
           * console renders the difference — inventing a funder here would
           * fabricate the exact evidence this panel exists to expose.
           */
          ...(own?.createdAt ? { firstSeen: own.createdAt } : {}),
          ...(own?.funder ? { funder: own.funder } : {}),
          ...(own?.funderSeq !== undefined ? { funderSeq: own.funderSeq } : {}),
          ...(tabFacts?.funder ? { tabFunder: tabFacts.funder } : {}),
        }
      })
  })

  /**
   * The ceiling in force, its arithmetic, and the series behind it.
   *
   * Served from the CEILING TOPIC, not recomputed. The gateway cannot import
   * `@tab/scoring` and should not: a console that recomputed the ceiling would
   * give a viewer a second answer to compare against the topic, and the whole
   * argument for having no contract is that there is one public record and
   * everyone reads it.
   *
   * `inputs` is included so the view can show the calculation. A ceiling of
   * `0.0000` with no arithmetic beside it reads as a bug; the same zero next to
   * `tier Unrated · mult 0x · cause graph_change` reads as the rail working,
   * which is what it is.
   */
  app.get('/v1/tabs/:tab/ceiling', async (request, reply) => {
    const { tab } = request.params as { tab: string }
    const history = deps.ceilings?.().get(tab) ?? []
    const current = history.at(-1)

    if (!current) {
      /*
       * 200 with an explicit `published: false`, not a 404.
       *
       * A tab with no published ceiling yet is the NORMAL state for the first
       * minutes of its life — the engine has not run — and the gateway is
       * enforcing the starter ceiling meanwhile. A 404 would make the console
       * render an error for a healthy tab, and would hide the fact that a real
       * limit is in force.
       */
      return reply.send({
        tab,
        published: false,
        enforced: toWire(deps.state.ceilingFor(tab)),
        note: 'No ceiling published yet — the starter ceiling is in force. Run the engine.',
        history: [],
      })
    }

    return reply.send({
      tab,
      published: true,
      ...wireCeiling(current),
      /*
       * What the FAST PATH is actually enforcing, alongside what was published.
       *
       * These are normally equal, and when they are not, that gap is the single
       * most useful number on the screen: the ceiling poll runs every 15s, so a
       * fresh collapse can be on the topic and not yet in force. A console
       * showing only the published value would tell an operator a spend will be
       * refused when it is about to succeed.
       */
      enforced: toWire(deps.state.ceilingFor(tab)),
      history: history.map(wireCeiling),
    })
  })

  /**
   * Settled windows, from the settlements topic.
   *
   * The gross legs travel with the net on purpose. This view exists to show one
   * claim — many receipts became one transfer — and `net` alone shows the
   * transfer while hiding the netting, which is the part worth proving.
   */
  app.get('/v1/tabs/:tab/settlements', async (request) => {
    const { tab } = request.params as { tab: string }
    const rows = deps.settlements?.().get(tab) ?? []
    return rows.map((s) => ({
      window: s.window,
      at: s.at,
      ...(s.seq !== undefined ? { seq: s.seq } : {}),
      net: toWire(s.net),
      // Absent on settlements published before these fields existed. Passed
      // through as absent rather than defaulted to "0.000000": a window whose
      // credits were genuinely zero and one that never recorded them are
      // different facts, and the console must be able to say "not published".
      ...(s.credits !== undefined ? { credits: toWire(s.credits) } : {}),
      ...(s.debits !== undefined ? { debits: toWire(s.debits) } : {}),
      ...(s.interest !== undefined ? { interest: toWire(s.interest) } : {}),
      ...(s.outstanding !== undefined ? { outstanding: toWire(s.outstanding) } : {}),
      ...(s.receiptCount !== undefined ? { receiptCount: s.receiptCount } : {}),
      outcome: s.outcome,
      rampFromBp: s.rampFromBp,
      rampToBp: s.rampToBp,
      ...(s.transactionId ? { transactionId: s.transactionId } : {}),
      ...(s.token ? { token: s.token } : {}),
    }))
  })

  app.get('/v1/tabs/:tab/entries', async (request) => {
    const { tab } = request.params as { tab: string }
    return deps.state.entriesFor(tab).map((e) => ({
      ...e,
      amount: 'amount' in e ? toWire(e.amount) : undefined,
      requested: 'requested' in e ? toWire(e.requested) : undefined,
    }))
  })

  return app
}
