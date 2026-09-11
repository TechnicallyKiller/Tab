import { createHash, randomUUID } from 'node:crypto'
import type {
  Entry,
  PublishedCeiling,
  PublishedWeight,
  Registration,
  RememberedFacts,
} from '@tab/ledger'
/*
 * `toWire` is IMPORTED, not redefined.
 *
 * This file carried its own copy — byte-equivalent to `@tab/money`'s, so
 * nothing was wrong yet — while `server.ts`, in the same app, imported the
 * shared one. Two implementations of one function side by side is the setup
 * for drift, not drift itself, and it is the fifth private copy of something
 * shared to appear in this repo: three replay decoders each lost a message
 * type, and `whoami.ts`'s inline type re-created a decimals bug. The pattern
 * is reliable enough to treat as a rule.
 */
import { format, type MicroUsdc, micro, toWire, usdc } from '@tab/money'
import type { RefusalCode } from '@tab/protocol'
import type { SpendClient } from '@tab/x402'
import type { GatewayEnv } from './env.ts'
import { nowConsensus, type ReceiptWriter } from './receipts.ts'
import type { SettlementEntry } from './settlements.ts'
import type { LedgerState } from './state.ts'

/**
 * The spend leg.
 *
 * The order is fixed and not negotiable:
 *
 *   1. RESERVE  the fast path issues a hold id and available drops immediately
 *   2. PAY      x402 pays the seller, hold id as the idempotency key
 *   3. COMMIT   the hold becomes a debit and the receipt goes to HCS
 *
 * A crash between 2 and 3 leaves a transfer with no receipt. That is recoverable
 * — the reconciler diffs Mirror Node outbound transfers against the receipt
 * topic and writes a repair. A crash between 1 and 2 is harmless: the hold
 * expires and releases exactly what it reserved.
 *
 * The seller sees an ordinary x402 customer. Nothing here sends a Tab-specific
 * header, credential or negotiation. That property — works with any unmodified
 * x402 endpoint — is the strongest line in the design and must not be traded.
 */

export interface SpendRequest {
  tab: string
  url: string
  /**
   * Ceiling for this single call, atomic units.
   *
   * Optional: when absent the seller's own quoted price is used, so a caller
   * that has no opinion about budget does not have to invent one.
   */
  max?: MicroUsdc
  /** Replays return the original result rather than spending twice. */
  idempotencyKey?: string
}

export interface SpendRefused {
  outcome: 'refused'
  rule: RefusalCode
  /** Plain sentence for a human; the rule is what machines read. */
  reason: string
  evidence: Record<string, string | number>
  available: MicroUsdc
}

export interface SpendSettled {
  outcome: 'paid'
  holdId: string
  amount: MicroUsdc
  seller: string
  /** The seller's own response. The agent asked for this, not for a receipt. */
  body: unknown
  receiptSeq: number | null
  elapsedMs: number
}

export interface SpendFailed {
  outcome: 'failed'
  /** Distinct from a refusal on purpose: infrastructure, not underwriting. */
  reason: string
  holdId: string
}

export type SpendOutcome = SpendRefused | SpendSettled | SpendFailed

export interface SpendDeps {
  env: GatewayEnv
  state: LedgerState
  client: SpendClient
  receipts: ReceiptWriter
  window: () => number
  /**
   * Published independence weights, for the console to read.
   *
   * Optional and unused by the spend path — the graph runs in the engine and
   * the fast path never consults it. It is here only because `apps/web` may
   * talk to nothing but the gateway.
   */
  weights?: () => ReadonlyMap<string, PublishedWeight>
  /**
   * Published ceiling history, for the console to read.
   *
   * Also unused by the spend path, which enforces `state.ceilingFor(tab)` —
   * the single value the ceiling poll wrote. Serving the series here would be
   * a second place a ceiling could come from if the spend path ever reached for
   * it, so it does not: this is a read surface, and the two must not converge.
   */
  ceilings?: () => ReadonlyMap<string, PublishedCeiling[]>
  /**
   * Published settlements, for the console to read.
   *
   * The gateway makes no claim about whether a window settled — the worker does,
   * and it reads both topics to make it. This is the console's window onto that
   * claim, nothing more.
   */
  settlements?: () => ReadonlyMap<string, SettlementEntry[]>
  /**
   * Published account provenance, for the Counterparties evidence panel.
   *
   * Read-only and never consulted by the spend path — the graph runs in the
   * engine and the fast path enforces only the published ceiling.
   */
  facts?: () => ReadonlyMap<string, RememberedFacts>
  /** Published Starter Tab claims, by tab. For the console; never consulted by spend. */
  registrations?: () => ReadonlyMap<string, Registration>
  /** How many funding ROOTS are claimed. Not the same as the number of tabs. */
  rootsClaimed?: () => number
}

/** Hash the request, never store the request. Receipts carry the hash. */
function requestHash(url: string, at: string): string {
  return createHash('sha256').update(`${url}|${at}`).digest('hex').slice(0, 12)
}

/** Hedera entity id. The receipt schema rejects anything else. */
const ENTITY_ID = /^\d+\.\d+\.\d+$/

/**
 * Who gets paid, resolved from the seller's own 402 challenge.
 *
 * This used to read a `?payTo=` query parameter and fall back to the literal
 * string `'unknown'`. Every demo script appended that parameter, so it always
 * worked locally — and the first time anyone pasted a PLAIN seller URL, the
 * receipt schema rejected `'unknown'`, the hold could not publish, and the
 * spend died as a 502 carrying a raw validation dump. The counterparty is not
 * the caller's to supply, and asking for it made the rail look broken at the
 * exact moment someone tried it for real.
 *
 * The challenge already carries the answer: x402 puts the payment
 * requirements, `payTo` among them, in the `payment-required` header. So the
 * unpaid GET that discovers the price also discovers who is charging it.
 *
 * The query parameter is still honoured FIRST, and only when it is a
 * well-formed id — existing demo scripts keep working, and a malformed one
 * falls through to the challenge rather than poisoning the receipt.
 */
interface Challenge {
  /** The seller's Hedera account, or `'unknown'` when it could not be read. */
  payTo: string
  /** The seller's own price, when the challenge stated one. */
  amount?: MicroUsdc
  /** The seller never answered at all, as opposed to answering unhelpfully. */
  unreachable?: boolean
}

async function resolveSeller(url: string): Promise<Challenge> {
  try {
    const fromQuery = new URL(url).searchParams.get('payTo')
    if (fromQuery && ENTITY_ID.test(fromQuery)) return { payTo: fromQuery }
  } catch {
    return { payTo: 'unknown' } // not a URL at all; the caller is told plainly below
  }

  try {
    /*
     * A GENEROUS timeout, and the earlier comment here had it backwards.
     *
     * It argued for a short one "because this runs before the hold". That is
     * exactly why it can afford to be long: nothing is reserved yet, so waiting
     * costs latency and nothing else, while giving up early costs the whole
     * spend.
     *
     * Measured against a suspended free-tier seller: 72.9s to wake. At 10s
     * every first purchase after an idle period failed — and failed claiming
     * the seller "served no challenge", which is a different and wrong
     * accusation. 60s covers a cold start while still bounding a seller that is
     * genuinely hanging.
     */
    const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(60_000) })
    const header = res.headers.get('payment-required')
    if (!header) return { payTo: 'unknown' }

    const decoded: unknown = JSON.parse(Buffer.from(header, 'base64').toString('utf8'))
    const accepts = (decoded as { accepts?: { payTo?: unknown; amount?: unknown }[] }).accepts
    const first = accepts?.[0]
    const payTo = first?.payTo
    if (typeof payTo !== 'string' || !ENTITY_ID.test(payTo)) return { payTo: 'unknown' }

    /*
     * The price travels with the payee, because they are the same statement:
     * "this account wants this much for this resource". Reading one and
     * discarding the other would leave the caller to invent a number the
     * seller had already named.
     *
     * Atomic units on the wire, so it is parsed as an integer and never
     * through a float.
     */
    const raw = first?.amount
    const quoted = typeof raw === 'string' && /^\d+$/.test(raw) ? micro(BigInt(raw)) : undefined
    return quoted === undefined ? { payTo } : { payTo, amount: quoted }
  } catch (error) {
    /*
     * "Did not answer" and "answered, without a challenge" are different
     * problems with different fixes, and reporting the second for the first
     * sent us looking at a perfectly well-behaved seller.
     */
    const timedOut = error instanceof Error && /timeout|abort/i.test(error.name)
    return { payTo: 'unknown', ...(timedOut ? { unreachable: true } : {}) }
  }
}

export async function spend(deps: SpendDeps, request: SpendRequest): Promise<SpendOutcome> {
  const { env, state, client, receipts } = deps
  const at = nowConsensus()
  const window = deps.window()
  const challenge = await resolveSeller(request.url)
  const seller = challenge.payTo

  /*
   * An unresolved counterparty stops the spend HERE, before any state changes.
   *
   * `'unknown'` is not a Hedera id, so every receipt written about this spend
   * would be rejected by the schema. Continuing produced a 502 carrying a zod
   * dump about a field the caller never supplied — true, and useless. This is
   * infrastructure, not underwriting, so it is `failed` rather than a refusal:
   * nothing about the tab's creditworthiness was in question.
   */
  if (!ENTITY_ID.test(seller)) {
    return {
      outcome: 'failed',
      reason: challenge.unreachable
        ? `${request.url} did not respond in time, so it could not be asked who to pay. ` +
          'Nothing was reserved or spent. A suspended host can take over a minute to wake — ' +
          'retry once it is up.'
        : `could not work out who to pay at ${request.url} — the seller answered but served no ` +
          'x402 challenge naming a Hedera payTo account, so nothing was reserved or spent',
      holdId: request.idempotencyKey ?? 'none',
    }
  }

  /*
   * What this call is worth, and therefore what gets underwritten.
   *
   * A caller-supplied `max` wins — that is an explicit budget. Otherwise it is
   * the seller's own quoted price, which is the number the checks below should
   * have been reading all along: the cap exists to bound what an agent PAYS,
   * and the seller decides that.
   *
   * Defaulting to the per-call cap instead (which the chat tool briefly did)
   * silently disarms the cap: every spend arrives exactly AT the limit, passes,
   * and then fails at payment time against a seller wanting more. The refusal
   * that should have fired never does, and an underwriting decision surfaces as
   * a transport error.
   *
   * With no `max` and no quote there is nothing to underwrite, so the spend
   * stops here rather than guessing.
   */
  const max = request.max ?? challenge.amount
  if (max === undefined) {
    return {
      outcome: 'failed',
      reason:
        `no price for ${request.url} — the seller quoted no amount in its x402 challenge and ` +
        'the caller named no max, so there was nothing to authorise',
      holdId: request.idempotencyKey ?? 'none',
    }
  }
  const priced: SpendRequest & { max: MicroUsdc } = { ...request, max }

  // ── the checks, cheapest and most-likely-to-refuse first ────────────────
  const refusal = check(deps, priced, at)
  if (refusal) {
    // A refusal is published, not logged. The Refusals view is the product
    // demonstrating that underwriting works.
    await receipts
      .write({
        v: 1,
        t: 'refused',
        tab: request.tab,
        w: window,
        tok: env.tokenId,
        cp: seller,
        amt: toWire(max),
        rule: refusal.rule,
        ev: refusal.evidence,
      })
      .catch(() => undefined) // a receipt failure must not turn a refusal into a 500
    return refusal
  }

  // ── 1. RESERVE ───────────────────────────────────────────────────────────
  const holdId = request.idempotencyKey ?? `h_${randomUUID().replace(/-/g, '').slice(0, 16)}`
  const expiresAt = shiftSeconds(at, env.holdTtlSeconds)
  const hold: Entry = {
    kind: 'hold',
    at,
    window,
    holdId,
    counterparty: seller,
    amount: max,
    expiresAt,
  }
  state.push(request.tab, hold)

  /*
   * Publish the hold and AWAIT consensus, before paying anything.
   *
   * The await is the whole point. `reserve → pay → commit` is the safety
   * property this rail rests on, and until holds were published it was the one
   * thing a stranger had to take on trust: an HCS replay showed debits
   * appearing from nowhere, so `verify-tab` could not assert `debit_has_hold`.
   * Publishing it AFTER the payment, or not awaiting it, would put the two
   * messages on the topic in an order that proves nothing.
   *
   * The cost is ~2-4s of consensus. It is affordable because it does not touch
   * the 50ms authorization budget — that is the cache read above — and the pay
   * step below is an x402 HTS settlement taking 25-39s, so this is roughly 10%
   * on a path already dominated by the chain.
   */
  const holdWrite = await receipts
    .write({
      v: 1,
      t: 'hold',
      tab: request.tab,
      w: window,
      tok: env.tokenId,
      hold: holdId,
      cp: seller,
      amt: toWire(max),
      exp: expiresAt,
      req: requestHash(request.url, at),
    })
    .then((written) => ({ ok: true as const, written }))
    .catch((error: unknown) => ({ ok: false as const, error }))

  if (!holdWrite.ok) {
    /*
     * FAIL CLOSED. No hold on the topic means no spend.
     *
     * Proceeding would pay a seller with no published authorisation, producing
     * exactly the debit-from-nowhere this change exists to eliminate — and it
     * would be indistinguishable, to a stranger, from a gateway inventing
     * debits. Refusing costs the agent one job; proceeding costs the ledger its
     * only external proof of ordering.
     */
    return {
      outcome: 'failed',
      reason:
        'could not publish the hold, so the spend was not attempted: ' +
        (holdWrite.error instanceof Error ? holdWrite.error.message : String(holdWrite.error)),
      holdId,
    }
  }

  // ── 2. PAY ───────────────────────────────────────────────────────────────
  const started = Date.now()
  let result: Awaited<ReturnType<SpendClient['call']>>
  try {
    result = await client.call(request.url)
  } catch (error) {
    // The hold stays and expires on its own. Never release it here: we cannot
    // know whether the seller was paid, and releasing would let the agent spend
    // the same headroom twice.
    return {
      outcome: 'failed',
      reason: error instanceof Error ? error.message : String(error),
      holdId,
    }
  }

  if (result.status !== 200) {
    return { outcome: 'failed', reason: `seller returned HTTP ${result.status}`, holdId }
  }

  // ── 3. COMMIT ────────────────────────────────────────────────────────────
  /*
   * Debit what the seller ACTUALLY charged, not the caller's cap.
   *
   * This recorded `request.max`, so a spend capped at `0.200000` against a
   * seller charging `0.040000` debited the agent `0.200000` — overstating what
   * it owed by `0.160000` while the float kept the difference. Invisible for as
   * long as every demo set `max` equal to the price, and wrong the moment they
   * differed. The reconciler would have caught it as an `amount_mismatch`
   * against the on-chain transfer, which is some comfort, but the ledger should
   * not need repairing for something knowable at write time.
   *
   * Falls back to `max` only when x402 did not report a price, and that case is
   * recorded rather than silently treated as equal — an unreported price means
   * the debit is an UPPER BOUND, and the reconciler will flag it.
   */
  const charged = result.amountPaid !== undefined ? micro(result.amountPaid) : max
  if (result.amountPaid === undefined) {
    console.warn(
      `[spend] x402 reported no price for ${holdId}; debiting the cap ${format(max)} as ` +
        'an upper bound. The reconciler will flag this against the on-chain transfer.',
    )
  }

  const debit: Entry = {
    kind: 'debit',
    at: nowConsensus(),
    window,
    holdId,
    counterparty: seller,
    amount: micro(-charged),
    transactionId: result.settlementTransaction ?? `unsettled:${holdId}`,
  }
  state.push(request.tab, debit)

  const written = await receipts.write({
    v: 1,
    t: 'debit',
    tab: request.tab,
    w: window,
    tok: env.tokenId,
    cp: seller,
    amt: toWire(micro(-charged)),
    hold: holdId,
    req: requestHash(request.url, at),
    tx: debit.transactionId,
  })

  return {
    outcome: 'paid',
    holdId,
    // What was actually charged, so a caller reconciling against its own
    // records sees the settled figure rather than the limit it set.
    amount: charged,
    seller,
    body: result.body,
    receiptSeq: written.sequenceNumber,
    elapsedMs: Date.now() - started,
  }
}

/**
 * The pre-spend checks.
 *
 * Fails closed: anything unexpected refuses. A refused spend costs the agent a
 * job; an allowed spend past a ceiling costs the house real money.
 */
function check(
  deps: SpendDeps,
  request: SpendRequest & { max: MicroUsdc },
  at: string,
): SpendRefused | null {
  const { env, state } = deps
  const price = request.max

  if (price > env.perCallCap) {
    return {
      outcome: 'refused',
      rule: 'PER_CALL_CAP',
      reason:
        `Spend of ${format(price)} refused. The request exceeds the per-call cap of ` +
        `${format(env.perCallCap)} in force for this tab.`,
      evidence: { requested: format(price), cap: format(env.perCallCap) },
      available: state.position(request.tab, at).available,
    }
  }

  const decision = state.canSpend(request.tab, price, at)
  if (!decision.allowed) {
    const p = state.position(request.tab, at)
    return {
      outcome: 'refused',
      rule: 'CEILING_EXCEEDED',
      reason:
        `Spend of ${format(price)} refused. Outstanding ${format(p.outstanding)} plus holds ` +
        `${format(p.holds)} plus the request would pass the ${format(p.ceiling)} ceiling.`,
      evidence: {
        requested: format(price),
        outstanding: format(p.outstanding),
        holds: format(p.holds),
        ceiling: format(p.ceiling),
        shortfall: format(decision.shortfall ?? micro(0n)),
      },
      available: decision.available,
    }
  }

  return null
}

function shiftSeconds(consensus: string, seconds: number): string {
  const [s = '0', n = '0'] = consensus.split('.')
  return `${BigInt(s) + BigInt(seconds)}.${n}`
}

export { usdc }
