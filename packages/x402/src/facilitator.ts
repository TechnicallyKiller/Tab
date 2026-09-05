import { x402Facilitator } from '@x402/core/facilitator'
import {
  createHederaClient,
  createHederaPreflightTransfer,
  createHederaSignAndSubmitTransaction,
  createHederaVerifyPayerSignature,
  toFacilitatorHederaSigner,
} from '@x402/hedera'
import { ExactHederaScheme } from '@x402/hedera/exact/facilitator'
import type { PrivateKey } from '@hiero-ledger/sdk'

/**
 * Tab's self-hosted facilitator, for the EARN leg.
 *
 * @x402/hedera exports the facilitator class, so running one is configuration
 * rather than a protocol implementation. Self-hosting removes a third-party
 * liveness dependency and lets an attested credit receipt be written in the
 * same code path that settled the payment — which is exactly the attestation
 * claim. See docs/adr/0004-self-hosted-facilitator.md.
 *
 * On the SPEND leg we are the client and must use whatever facilitator the
 * seller advertises. Self-hosting does not help there.
 */

export interface FacilitatorConfig {
  network: string
  /** Must be a funded ECDSA account, separate from the seller. */
  feePayerId: string
  feePayerKey: PrivateKey
  mirrorNodeUrl?: string
}

export interface TabFacilitator {
  verify: x402Facilitator['verify']
  settle: x402Facilitator['settle']
  getSupported: () => Promise<ReturnType<x402Facilitator['getSupported']>>
  feePayerId: string
}

export function createFacilitator(config: FacilitatorConfig): TabFacilitator {
  const signer = toFacilitatorHederaSigner({
    getAddresses: () => [config.feePayerId],
    // Resolves only on a SUCCESS receipt; any other status throws and the
    // scheme reports settlement failure. Do not "helpfully" swallow these.
    signAndSubmitTransaction: createHederaSignAndSubmitTransaction(
      (network: string) => createHederaClient(network),
      config.feePayerKey,
    ),
    // Called unconditionally by the scheme and cannot be skipped: fetches the
    // payer's on-chain key and checks it actually signed the frozen body.
    verifyPayerSignature: config.mirrorNodeUrl
      ? createHederaVerifyPayerSignature({ mirrorNodeUrl: config.mirrorNodeUrl })
      : createHederaVerifyPayerSignature(),
    // Mirror Node balance + association check before submitting. Turns a
    // silent TOKEN_NOT_ASSOCIATED_TO_ACCOUNT into a reason.
    preflightTransfer: config.mirrorNodeUrl
      ? createHederaPreflightTransfer({ mirrorNodeUrl: config.mirrorNodeUrl })
      : createHederaPreflightTransfer(),
  })

  const facilitator = new x402Facilitator().register(
    config.network as Parameters<x402Facilitator['register']>[0],
    new ExactHederaScheme(signer),
  )

  return {
    verify: facilitator.verify.bind(facilitator),
    settle: facilitator.settle.bind(facilitator),
    getSupported: async () => facilitator.getSupported(),
    feePayerId: config.feePayerId,
  }
}

/**
 * Present the facilitator as the client a resource server expects.
 *
 * The cast is unavoidable: @x402/core's own getSupported() widens `network` to
 * string where its FacilitatorClient interface requires `${string}:${string}`.
 * That mismatch is inside the library's types.
 */
export function asFacilitatorClient<T>(facilitator: TabFacilitator): T {
  return {
    verify: facilitator.verify,
    settle: facilitator.settle,
    getSupported: facilitator.getSupported,
  } as unknown as T
}
