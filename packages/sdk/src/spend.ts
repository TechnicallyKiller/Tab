import { type MicroUsdc, toWire, usdc } from '@tab/money'
import type { RefusalCode } from '@tab/protocol'
import { isRetryable, REFUSAL_GUIDANCE } from '@tab/protocol'
import type { TabClient } from './client.ts'
import { TabInvalidError, TabProtocolError } from './errors.ts'
import type { Quote, SpendRequest, SpendResult, TabState } from './types.ts'

/**
 * Spend, quote, and read state.
 *
 * The one design decision worth restating: **a refusal is a value.** `spend()`
 * returns a discriminated result carrying the rule that fired, because refusal
 * is the product demonstrating that underwriting works — not an error
 * condition. Throwing would push every consumer into `try/catch` and make the
 * Refusals view harder to build than the happy path.
 */

/**
 * A key that makes a retry safe.
 *
 * The gateway treats it as the hold id, so the same key cannot spend twice. It
 * is generated HERE rather than in the gateway because only the caller can
 * decide that two calls are the same intent — and it is returned on every
 * outcome, including failures, so a caller retrying an unknown outcome can
 * reuse it.
 *
 * `crypto.randomUUID` is available in Node 19+ and every modern browser, which
 * keeps this package browser-safe with no dependency.
 */
function newIdempotencyKey(): string {
  return `h_${globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`
}

/** Parse a wire amount, with a message that names the field. */
function amount(value: unknown, field: string): MicroUsdc {
  if (typeof value !== 'string') {
    throw new TabProtocolError(
      `Expected "${field}" to be a decimal string amount, got ${typeof value}`,
      200,
      value,
    )
  }
  /*
   * STRICT — exactly six decimals and an ASCII minus, which is what `toWire`
   * emits and nothing else.
   *
   * `usdc()` alone is not enough here, and a test caught that: it is tolerant
   * by design, accepting a U+2212 minus and padding a 4-decimal value. That
   * tolerance is right for human input and wrong for a wire parser, because it
   * makes silent data loss undetectable — the gateway once served `format()`
   * output where a wire value belonged, `1.234567` went out as `"1.2345"`, and
   * `usdc()` would have happily parsed it as `1234500`. Sixty-seven
   * micro-USDC per value, no error, and a dashboard that cannot match
   * HashScan.
   *
   * So the shape is checked before parsing, and a display string is rejected
   * with a message that names the actual cause.
   */
  if (!/^-?\d+\.\d{6}$/.test(value)) {
    throw new TabProtocolError(
      `"${field}" = ${JSON.stringify(value)} is not a wire amount. ` +
        'Exactly six decimals and an ASCII minus are required (`toWire`). Four decimals or a ' +
        'U+2212 minus means the server serialised a DISPLAY string instead of a wire value, ' +
        'which is lossy — do not "fix" this by loosening the check.',
      200,
      value,
    )
  }
  try {
    return usdc(value)
  } catch (error) {
    throw new TabProtocolError(
      `"${field}" = ${JSON.stringify(value)} has the right shape but did not parse`,
      200,
      error,
    )
  }
}

export async function spend(client: TabClient, request: SpendRequest): Promise<SpendResult> {
  if (!request.tab) throw new TabInvalidError('spend() needs a tab id')
  if (!request.url) throw new TabInvalidError('spend() needs a seller url')
  if (request.max !== undefined && request.max <= 0n) {
    // A zero or negative max is a programming error, not a refusal: there is no
    // spend to underwrite, so the rail has nothing to decide.
    throw new TabInvalidError(`spend() needs a positive max, got ${request.max}`)
  }

  const idempotencyKey = request.idempotencyKey ?? newIdempotencyKey()

  const body = await client.request<{
    paid?: {
      amount: string
      seller: string
      holdId: string
      receiptSeq: number | null
      elapsedMs: number
    }
    refused?: { rule: RefusalCode; reason: string; evidence?: Record<string, string | number> }
    failed?: { reason: string; holdId: string }
    error?: string
    body?: unknown
  }>('POST', '/v1/spend', {
    tab: request.tab,
    url: request.url,
    // Absent means "accept the seller's quote"; the gateway reads it from the
    // 402. Sending an explicit null would instead be a value the gateway must
    // interpret, so the key is simply left off.
    ...(request.max !== undefined ? { max: toWire(request.max) } : {}),
    idempotencyKey,
    ...(request.init ? { init: request.init } : {}),
  })

  if (body.refused) {
    const rule = body.refused.rule
    return {
      outcome: 'refused',
      rule,
      reason: body.refused.reason,
      /*
       * Guidance comes from `@tab/protocol`, not from the server's message.
       *
       * The rule code is the contract; the prose is not. Taking guidance from
       * the wire would let a server version change what an agent does next
       * without any consumer noticing.
       */
      guidance: REFUSAL_GUIDANCE[rule] ?? 'Surface this to the operator.',
      retryable: isRetryable(rule),
      ...(body.refused.evidence ? { evidence: body.refused.evidence } : {}),
    }
  }

  if (body.paid) {
    return {
      outcome: 'paid',
      amount: amount(body.paid.amount, 'paid.amount'),
      seller: body.paid.seller,
      holdId: body.paid.holdId,
      receiptSeq: body.paid.receiptSeq,
      body: body.body ?? null,
      elapsedMs: body.paid.elapsedMs,
    }
  }

  if (body.failed) {
    return { outcome: 'failed', reason: body.failed.reason, holdId: body.failed.holdId }
  }

  /*
   * Infrastructure failure reported through the top-level `error` field.
   *
   * Returned as `failed` rather than thrown, carrying the idempotency key —
   * the caller needs that key to retry safely, and an exception would discard
   * the one piece of information that makes the retry safe.
   */
  if (body.error) {
    return { outcome: 'failed', reason: body.error, holdId: idempotencyKey }
  }

  throw new TabProtocolError('The gateway returned neither paid, refused, nor failed', 200, body)
}

/**
 * What could this tab afford right now, without reserving anything.
 *
 * Derived from `state()` rather than a dedicated endpoint, and deliberately so:
 * a quote that took a hold would leave a hold that never commits, which is
 * exactly the shape the reconciler exists to clean up. This reserves nothing
 * and therefore guarantees nothing — between a quote and a spend, another call
 * on the same tab can take the headroom.
 */
export async function quote(
  client: TabClient,
  params: { tab: string; max: MicroUsdc },
): Promise<Quote> {
  const s = await state(client, params.tab)

  if (params.max > s.perCallCap) {
    return {
      tab: s.tab,
      affordable: false,
      available: s.available,
      ceiling: s.ceiling,
      perCallCap: s.perCallCap,
      wouldRefuse: 'PER_CALL_CAP',
      reason: `${toWire(params.max)} exceeds the per-call cap of ${toWire(s.perCallCap)}`,
    }
  }
  if (params.max > s.available) {
    return {
      tab: s.tab,
      affordable: false,
      available: s.available,
      ceiling: s.ceiling,
      perCallCap: s.perCallCap,
      wouldRefuse: 'CEILING_EXCEEDED',
      reason: `${toWire(params.max)} exceeds the available ${toWire(s.available)} under a ceiling of ${toWire(s.ceiling)}`,
    }
  }
  return {
    tab: s.tab,
    affordable: true,
    available: s.available,
    ceiling: s.ceiling,
    perCallCap: s.perCallCap,
  }
}

export async function state(client: TabClient, tab: string): Promise<TabState> {
  if (!tab) throw new TabInvalidError('state() needs a tab id')
  const body = await client.request<Record<string, unknown>>('GET', `/v1/tabs/${tab}`)
  return {
    tab: String(body['tab'] ?? tab),
    balance: amount(body['balance'], 'balance'),
    outstanding: amount(body['outstanding'], 'outstanding'),
    holds: amount(body['holds'], 'holds'),
    available: amount(body['available'], 'available'),
    ceiling: amount(body['ceiling'], 'ceiling'),
    perCallCap: amount(body['perCallCap'], 'perCallCap'),
    window: Number(body['window'] ?? 0),
    entries: Number(body['entries'] ?? 0),
  }
}

export { amount as parseAmount }
