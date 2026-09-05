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
        },
      ],
      description: route.description,
      mimeType: route.mimeType ?? 'application/json',
    }
  }

  return { server, routes }
}
