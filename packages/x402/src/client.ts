import { PrivateKey } from '@hiero-ledger/sdk'
import { x402Client, wrapFetchWithPayment, x402HTTPClient } from '@x402/fetch'
import { createClientHederaSigner } from '@x402/hedera'
import { ExactHederaScheme } from '@x402/hedera/exact/client'
import { formatAtomic, type Asset } from './assets.ts'

/**
 * The SPEND leg: Tab pays an unmodified x402 seller from the hot float.
 *
 * The seller sees an ordinary x402 customer and does not know Tab exists.
 * Nothing here may send a Tab-specific header or credential — the moment a
 * seller has to understand Tab, we lose "works with any unmodified x402
 * endpoint", which is the strongest property in the design.
 *
 * The hot float signs per request, inside the request. That is why it is a
 * single-key account and the KeyList reserve sits behind it.
 * See docs/adr/0003-two-account-float.md.
 */

export interface SpendClientConfig {
  network: string
  /** Hot float — signs each payment. */
  payerId: string
  payerKey: PrivateKey
  asset: Asset
  /**
   * Hard per-payment ceiling in atomic units.
   *
   * x402's own spend controls default to USD-pegged assets only, so a
   * non-default asset (native HBAR included) needs an explicit entry. Worth
   * knowing: this control is CLIENT-side and advisory — whoever configures the
   * client can raise it. Tab's real cap lives in the gateway fast path, where
   * the agent cannot reach it. This is defence in depth, not the defence.
   */
  maxAtomicPerPayment: bigint
}

export interface SpendResult {
  status: number
  body: unknown
  /** Set when the response carried a settlement receipt. */
  settlementTransaction?: string
  elapsedMs: number
}

export interface SpendClient {
  fetch: typeof fetch
  http: x402HTTPClient
  /** Call an x402 endpoint, paying if it answers 402. */
  call: (url: string, init?: RequestInit) => Promise<SpendResult>
  describe: () => string
}

export function createSpendClient(config: SpendClientConfig): SpendClient {
  const signer = createClientHederaSigner(config.payerId, config.payerKey, {
    network: config.network,
  })

  const client = new x402Client().register(
    config.network as Parameters<x402Client['register']>[0],
    new ExactHederaScheme(signer),
  )

  client.setSpendControls({
    allowedAssets: [
      {
        network: config.network as never,
        asset: config.asset.id,
        maxAmountPerPayment: config.maxAtomicPerPayment.toString(),
      },
    ],
  })

  const payingFetch = wrapFetchWithPayment(fetch, client)
  const http = new x402HTTPClient(client)

  return {
    fetch: payingFetch,
    http,
    describe: () =>
      `${config.payerId} paying up to ${formatAtomic(config.asset, config.maxAtomicPerPayment)} per call`,
    call: async (url, init) => {
      const started = performance.now()
      const response = await payingFetch(url, init ?? { method: 'GET' })
      // Clone before processResponse, which consumes the stream. The agent
      // needs the seller's body; we need the settlement receipt.
      const body = await response.clone().json().catch(() => null)
      /*
       * The settlement id lives in `header`, not `settlement`.
       *
       * This read `processed.settlement?.transaction`, which is a property
       * `processResponse` has never returned — it returns
       * `{ status, paymentStatus, body, header }`, where `header` is the
       * decoded PAYMENT-RESPONSE. So `tx` was ALWAYS undefined and every debit
       * receipt fell back to `unsettled:<holdId>`, which made the reconciler
       * structurally unable to match a single spend against the chain. The cast
       * is what hid it: an inline type asserts a shape rather than checking it,
       * so the compiler had nothing to disagree with.
       *
       * Only trust the id when the payment actually settled. A `settle_failed`
       * response can still carry a transaction id, and recording that as proof
       * of a debit would assert a movement that failed.
       */
      const processed = (await http.processResponse(response)) as {
        paymentStatus?: 'none' | 'payment_required' | 'settled' | 'settle_failed'
        header?: { success?: boolean; transaction?: string }
      }
      const tx =
        processed.paymentStatus === 'settled' && processed.header?.success
          ? processed.header.transaction
          : undefined
      return {
        status: response.status,
        body,
        ...(tx ? { settlementTransaction: tx } : {}),
        elapsedMs: performance.now() - started,
      }
    },
  }
}
