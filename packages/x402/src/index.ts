/**
 * @tab/x402 — the adapter over @x402/core and @x402/hedera.
 *
 * Tab plays all three protocol roles, which is why they live in one package
 * rather than scattered across the gateway:
 *
 *   client       SPEND leg — pays unmodified sellers from the hot float
 *   server       EARN leg  — fronts the agent's endpoint, returns 402
 *   facilitator  EARN leg  — verifies and settles inbound ourselves
 *
 * Proven end to end on Hedera testnet in tools/probes: 402 challenge, signed
 * retry, verify, settle, 200 with the seller's body, in 2.4s for HBAR. See
 * tools/probes/README.md for the measurements and their caveats.
 */
export {
  type Asset,
  atomicAmount,
  formatAtomic,
  HBAR,
  hbarAsset,
  MICRO_PER_TOKEN,
  NETWORKS,
  TESTNET_USDC,
  TINYBAR_PER_HBAR,
  tokenAsset,
} from './assets.ts'
export {
  BLOCKY402_TESTNET,
  type Blocky402Config,
  blocky402FeePayer,
  createBlocky402Facilitator,
} from './blocky402.ts'
export {
  createSpendClient,
  type SpendClient,
  type SpendClientConfig,
  type SpendResult,
} from './client.ts'
export {
  asFacilitatorClient,
  createFacilitator,
  type FacilitatorConfig,
  type TabFacilitator,
} from './facilitator.ts'
export { createEarnServer, type EarnRouteConfig, type EarnServer } from './server.ts'
