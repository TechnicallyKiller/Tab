import { createHash } from 'node:crypto'
import type { Entry } from '@tab/ledger'
import { format, type MicroUsdc, micro } from '@tab/money'
import type { GatewayEnv } from './env.ts'
import { nowConsensus, type ReceiptWriter } from './receipts.ts'
import type { LedgerState } from './state.ts'

/**
 * The earn leg.
 *
 * The gateway fronts the agent's own endpoint: it answers the 402, collects the
 * payment into the hot float, forwards the request, and writes an ATTESTED
 * credit receipt.
 *
 * Attestation means one specific thing: an inbound payment corresponded to a
 * request the gateway ACTUALLY SERVED. Because we self-facilitate, settlement
 * and receipt-writing happen in the same code path — which is what makes the
 * claim tight rather than inferred. Reading a chain's transfer history only
 * tells you money arrived.
 *
 * It does NOT prove the payer was independent. That is @tab/graph's job, and
 * conflating the two would be the single easiest way to overstate the design.
 */

export interface AgentEndpoint {
  /** The tab that earns from this endpoint. */
  tab: string
  /** Where the gateway forwards to once payment settles. */
  upstream: string
  /** Price per call, atomic units of the configured asset. */
  atomicPrice: MicroUsdc
  description: string
}

export interface EarnDeps {
  env: GatewayEnv
  state: LedgerState
  receipts: ReceiptWriter
  window: () => number
  endpoint: AgentEndpoint
}

export interface EarnResult {
  status: number
  body: unknown
  creditWritten: boolean
  receiptSeq: number | null
}

/**
 * Forward a paid request upstream and record the credit.
 *
 * Called only after x402 has verified AND settled — which is true only because
 * the route declares the `upfront` payment flow. Under x402's default
 * `authorization` flow the payment is merely VERIFIED before the handler and
 * settled in the response hook afterwards, and this function's whole premise
 * would be false: it would write an attested credit for money that had not
 * moved and might still fail to move. That was the actual behaviour until the
 * flow was pinned in `@tab/x402`'s earn server, and nothing here would have
 * revealed it.
 *
 * Ordering matters here too, and differently from the spend leg: the money has
 * already moved by the time we are called, so the request must be forwarded
 * even if the receipt write fails. Refusing to serve a request the payer paid
 * for would be theft; a missing receipt is repairable by the reconciler.
 */
export async function serveAndCredit(
  deps: EarnDeps,
  params: { payer: string; path: string; init?: RequestInit; settlementTx?: string },
): Promise<EarnResult> {
  const { env, state, receipts, endpoint } = deps
  const at = nowConsensus()
  const window = deps.window()
  const target = `${endpoint.upstream}${params.path}`

  let status = 502
  let body: unknown = null
  try {
    const upstream = await fetch(target, params.init ?? { method: 'GET' })
    status = upstream.status
    body = await upstream.json().catch(() => null)
  } catch (error) {
    // The payer has already paid. Report the upstream failure honestly rather
    // than pretending the request was served — but still record the credit,
    // because the money did move and the ledger must reflect reality.
    body = {
      error: 'the agent endpoint did not respond',
      detail: error instanceof Error ? error.message : String(error),
    }
  }

  const served = status >= 200 && status < 300

  const credit: Entry = {
    kind: 'credit',
    at,
    window,
    counterparty: params.payer,
    amount: endpoint.atomicPrice,
    // Attested only when we actually served the request. A payment we took but
    // could not serve is real money that must not claim to be earned revenue.
    attested: served,
    transactionId: params.settlementTx ?? `unsettled:${at}`,
  }
  state.push(endpoint.tab, credit)

  let receiptSeq: number | null = null
  let creditWritten = false
  try {
    const written = await receipts.write({
      v: 1,
      t: 'credit',
      tab: endpoint.tab,
      w: window,
      tok: env.tokenId,
      cp: params.payer,
      amt: toWire(endpoint.atomicPrice),
      att: served,
      req: requestHash(target, at),
      tx: credit.transactionId,
    })
    receiptSeq = written.sequenceNumber
    creditWritten = true
  } catch {
    // The reconciler repairs this from a Mirror Node diff. Never fail the
    // response over it — the payer paid.
    creditWritten = false
  }

  void env
  void format
  void micro
  return { status, body, creditWritten, receiptSeq }
}

function requestHash(url: string, at: string): string {
  return createHash('sha256').update(`${url}|${at}`).digest('hex').slice(0, 12)
}

function toWire(amount: MicroUsdc): string {
  const negative = amount < 0n
  const m = negative ? -amount : amount
  return `${negative ? '-' : ''}${m / 1_000_000n}.${(m % 1_000_000n).toString().padStart(6, '0')}`
}
