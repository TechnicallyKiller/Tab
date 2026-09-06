import { createHash, randomUUID } from 'node:crypto'
import { format, micro, usdc, type MicroUsdc } from '@tab/money'
import type { RefusalCode } from '@tab/protocol'
import type { Entry } from '@tab/ledger'
import type { SpendClient } from '@tab/x402'
import type { GatewayEnv } from './env.ts'
import { nowConsensus, type ReceiptWriter } from './receipts.ts'
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
  /** Ceiling for this single call, atomic units. */
  max: MicroUsdc
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
}

/** Hash the request, never store the request. Receipts carry the hash. */
function requestHash(url: string, at: string): string {
  return createHash('sha256').update(`${url}|${at}`).digest('hex').slice(0, 12)
}

function sellerFromUrl(url: string): string {
  // Until a seller registry exists, the demo passes the account id as a query
  // parameter. A real deployment resolves it from the 402 challenge's payTo.
  try {
    return new URL(url).searchParams.get('payTo') ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

export async function spend(deps: SpendDeps, request: SpendRequest): Promise<SpendOutcome> {
  const { env, state, client, receipts } = deps
  const at = nowConsensus()
  const window = deps.window()
  const seller = sellerFromUrl(request.url)

  // ── the checks, cheapest and most-likely-to-refuse first ────────────────
  const refusal = check(deps, request, at)
  if (refusal) {
    // A refusal is published, not logged. The Refusals view is the product
    // demonstrating that underwriting works.
    await receipts
      .write({
        v: 1, t: 'refused', tab: request.tab, w: window,
        cp: seller, amt: toWire(request.max), rule: refusal.rule, ev: refusal.evidence,
      })
      .catch(() => undefined) // a receipt failure must not turn a refusal into a 500
    return refusal
  }

  // ── 1. RESERVE ───────────────────────────────────────────────────────────
  const holdId = request.idempotencyKey ?? `h_${randomUUID().replace(/-/g, '').slice(0, 16)}`
  const expiresAt = shiftSeconds(at, env.holdTtlSeconds)
  const hold: Entry = {
    kind: 'hold', at, window, holdId, counterparty: seller,
    amount: request.max, expiresAt,
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
      v: 1, t: 'hold', tab: request.tab, w: window,
      hold: holdId, cp: seller, amt: toWire(request.max),
      exp: expiresAt, req: requestHash(request.url, at),
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
  let result
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
  const debit: Entry = {
    kind: 'debit', at: nowConsensus(), window, holdId, counterparty: seller,
    amount: micro(-request.max),
    transactionId: result.settlementTransaction ?? `unsettled:${holdId}`,
  }
  state.push(request.tab, debit)

  const written = await receipts.write({
    v: 1, t: 'debit', tab: request.tab, w: window,
    cp: seller, amt: toWire(micro(-request.max)), hold: holdId,
    req: requestHash(request.url, at),
    tx: debit.transactionId,
  })

  return {
    outcome: 'paid',
    holdId,
    amount: request.max,
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
function check(deps: SpendDeps, request: SpendRequest, at: string): SpendRefused | null {
  const { env, state } = deps
  const price = request.max

  if (price > env.perCallCap) {
    return {
      outcome: 'refused', rule: 'PER_CALL_CAP',
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
      outcome: 'refused', rule: 'CEILING_EXCEEDED',
      reason:
        `Spend of ${format(price)} refused. Outstanding ${format(p.outstanding)} plus holds ` +
        `${format(p.holds)} plus the request would pass the ${format(p.ceiling)} ceiling.`,
      evidence: {
        requested: format(price), outstanding: format(p.outstanding),
        holds: format(p.holds), ceiling: format(p.ceiling),
        shortfall: format(decision.shortfall ?? micro(0n)),
      },
      available: decision.available,
    }
  }

  return null
}

function toWire(amount: MicroUsdc): string {
  const negative = amount < 0n
  const m = negative ? -amount : amount
  const whole = m / 1_000_000n
  const frac = (m % 1_000_000n).toString().padStart(6, '0')
  return `${negative ? '-' : ''}${whole}.${frac}`
}

function shiftSeconds(consensus: string, seconds: number): string {
  const [s = '0', n = '0'] = consensus.split('.')
  return `${BigInt(s) + BigInt(seconds)}.${n}`
}

export { usdc }
