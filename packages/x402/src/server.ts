import { x402ResourceServer } from '@x402/core/server'
import { ExactHederaScheme } from '@x402/hedera/exact/server'
import { atomicAmount, type Asset } from './assets.ts'
import { asFacilitatorClient, type TabFacilitator } from './facilitator.ts'

/**
 * The EARN leg: Tab fronts the agent's own endpoint, returns a 402, collects
 * payment, forwards the request, and writes an ATTESTED credit receipt.
 *
 * Attestation means one specific thing — an inbound payment corresponded to a
 * request the gateway actually served. Because we self-facilitate, settlement
 * and receipt-writing happen in the same code path, which is what makes that
 * claim tight. It does NOT prove the payer was independent; that is
 * @tab/graph's job.
 */

export interface EarnRouteConfig {
  /** Express-style route key, e.g. `"POST /v1/agents/:id/invoke"`. */
  route: string
  /** Where payment lands. Tab's hot float, not the agent. */
  payTo: string
  asset: Asset
  /** Price in the asset's atomic units. */
  atomicPrice: bigint
  description: string
  mimeType?: string
}

export interface EarnServer {
  server: x402ResourceServer
  routes: Record<string, unknown>
}

export function createEarnServer(params: {
  network: string
  facilitator: TabFacilitator
  routes: EarnRouteConfig[]
}): EarnServer {
  const server = new x402ResourceServer(
    asFacilitatorClient<ConstructorParameters<typeof x402ResourceServer>[0]>(params.facilitator),
  ).register(
    params.network as Parameters<x402ResourceServer['register']>[0],
    new ExactHederaScheme(),
  )

  const routes: Record<string, unknown> = {}
  for (const route of params.routes) {
    routes[route.route] = {
      accepts: [
        {
          scheme: 'exact',
          // Atomic units for the named asset. A bare number here is how you
          // get a 100x error between tinybars and micro-units.
          price: { amount: atomicAmount(route.asset, route.atomicPrice), asset: route.asset.id },
          network: params.network,
          // A Hedera account id string, never an EVM address.
          payTo: route.payTo,
          /*
           * `upfront` settles BEFORE the handler runs, and the earn leg
           * depends on that.
           *
           * The Hedera exact scheme supports `authorization` (default) and
           * `upfront`. Under `authorization` the payment is only verified
           * before the handler and settled in the response's `onSend` hook —
           * so the money has NOT moved while the handler runs. The earn leg
           * writes an attested credit receipt in the handler, which under that
           * flow means asserting revenue for a payment that might still fail
           * to settle, and leaves no transaction id to reconcile against.
           *
           * `upfront` makes the ordering the code already claimed: money
           * first, then serve, then a credit that names the transaction which
           * moved it. It also means a payment can be taken for a request the
           * agent's endpoint then fails to serve — which is exactly the case
           * `attested: false` exists for, rather than a reason to avoid it.
           *
           * The key is `paymentFlow`. `assetTransferMethod` is a different
           * axis — it names the transfer mechanism (`default` for this scheme)
           * and setting `upfront` there fails at boot with
           * `unsupported_asset_transfer_method`, which is at least a loud
           * failure rather than a silent fallback to the wrong flow.
           */
          extra: { paymentFlow: 'upfront' },
        },
      ],
      description: route.description,
      mimeType: route.mimeType ?? 'application/json',
    }
  }

  return { server, routes }
}
