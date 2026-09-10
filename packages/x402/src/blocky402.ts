import type { x402Facilitator } from '@x402/core/facilitator'
import type { TabFacilitator } from './facilitator.ts'

/**
 * Blocky402 — a REMOTE facilitator for the earn leg.
 *
 * ## Why this exists alongside the self-hosted one
 *
 * `createFacilitator` runs the facilitator in-process (ADR-0004), which removes
 * a third-party liveness dependency and lets an attested credit receipt be
 * written in the same code path that settled the payment. That reasoning still
 * holds and the self-hosted path is not going anywhere.
 *
 * This is the other end of the same seam: some deployments — and the Hedera
 * x402 track specifically — require settlement through Blocky402's hosted
 * facilitator. Because `TabFacilitator` is only `verify` / `settle` /
 * `getSupported`, that requirement is a **client swap, not a rewrite**: the
 * resource server cannot tell which one it was handed.
 *
 * ## What changes when you use it
 *
 * The fee payer is THEIRS, not yours. `/supported` advertises
 * `hedera:testnet` with `extra.feePayer`, and settlement is submitted by their
 * account — so `FAUCET_ACCOUNT_ID` / `FAUCET_ACCOUNT_KEY` are unused on the
 * earn leg. That is a real trade: one less funded account to keep topped up,
 * one more service that has to be up.
 *
 * Testnet needs no credential. Mainnet takes an `X-Api-Key` of the form
 * `b402_<64 hex>` — passed through here so the same client covers both.
 */

export const BLOCKY402_TESTNET = 'https://api.testnet.blocky402.com'

export interface Blocky402Config {
  /** Defaults to the testnet facilitator. */
  baseUrl?: string
  /** Required on mainnet, unused on testnet. */
  apiKey?: string
  /** Milliseconds. Settlement waits on Hedera consensus, so be patient. */
  timeoutMs?: number
}

interface SupportedKind {
  scheme: string
  network: string
  x402Version: number
  extra?: { feePayer?: string }
}

/**
 * Read the fee payer Blocky402 will settle with, for a network.
 *
 * Fetched rather than configured. Their fee payer is their operational
 * detail and can change; a value copied into our `.env` would be correct until
 * the day it silently was not, and the failure would surface as an
 * unexplained settlement error rather than a stale config.
 */
export async function blocky402FeePayer(
  network: string,
  config: Blocky402Config = {},
): Promise<string | undefined> {
  const base = config.baseUrl ?? BLOCKY402_TESTNET
  const res = await fetch(`${base}/supported`, { headers: headersFor(config) })
  if (!res.ok) throw new Error(`Blocky402 /supported returned ${res.status}`)
  const body = (await res.json()) as { kinds?: SupportedKind[] }
  return body.kinds?.find((k) => k.network === network && k.scheme === 'exact')?.extra?.feePayer
}

function headersFor(config: Blocky402Config): Record<string, string> {
  return {
    'content-type': 'application/json',
    accept: 'application/json',
    ...(config.apiKey ? { 'X-Api-Key': config.apiKey } : {}),
  }
}

async function post(path: string, body: unknown, config: Blocky402Config): Promise<unknown> {
  const base = config.baseUrl ?? BLOCKY402_TESTNET
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.timeoutMs ?? 60_000)
  try {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: headersFor(config),
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    /*
     * A non-2xx is a TRANSPORT failure and is thrown; a 200 carrying
     * `isValid: false` or `success: false` is the facilitator's ANSWER and is
     * returned. Collapsing the two would make "the payment was rejected" and
     * "the facilitator is down" indistinguishable to the earn leg — and only
     * one of those means the money definitely did not move.
     */
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(
        `Blocky402 ${path} returned ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`,
      )
    }
    return await res.json()
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(
        `Blocky402 ${path} timed out after ${config.timeoutMs ?? 60_000}ms. Settlement waits on ` +
          'Hedera consensus, so a short timeout abandons payments that were about to succeed.',
      )
    }
    throw error
  }
}

/**
 * Blocky402 presented as a `TabFacilitator`.
 *
 * Drop-in for `createFacilitator`: the resource server takes either.
 *
 * `feePayerId` is resolved from `/supported` when the caller does not supply
 * one, so the value reported is the one that will actually sign — see
 * `blocky402FeePayer`.
 */
export function createBlocky402Facilitator(
  network: string,
  config: Blocky402Config & { feePayerId?: string } = {},
): TabFacilitator {
  type Verify = x402Facilitator['verify']
  type Settle = x402Facilitator['settle']

  const verify = (async (...args: Parameters<Verify>) =>
    post('/verify', requestFrom(args), config)) as unknown as Verify

  const settle = (async (...args: Parameters<Settle>) =>
    post('/settle', requestFrom(args), config)) as unknown as Settle

  return {
    verify,
    settle,
    getSupported: async () => {
      const base = config.baseUrl ?? BLOCKY402_TESTNET
      const res = await fetch(`${base}/supported`, { headers: headersFor(config) })
      if (!res.ok) throw new Error(`Blocky402 /supported returned ${res.status}`)
      return (await res.json()) as ReturnType<x402Facilitator['getSupported']>
    },
    /*
     * Reported as unknown until resolved, never guessed.
     *
     * Their fee payer is on `/supported`, and the caller can pass it if it has
     * already fetched it. Inventing a placeholder would put an account id in a
     * log line that never signed anything.
     */
    feePayerId: config.feePayerId ?? 'blocky402:unresolved',
  }
}

/**
 * Build the wire body from the arguments `@x402/core` hands a facilitator.
 *
 * The call arrives as `(paymentPayload, paymentRequirements)`, and Blocky402
 * wants both plus `x402Version` at the top level — the shape documented at
 * blocky402.com/docs/api-reference. Kept in one place so `verify` and `settle`,
 * which take identical bodies, cannot drift apart.
 */
function requestFrom(args: readonly unknown[]): Record<string, unknown> {
  const [paymentPayload, paymentRequirements] = args
  const version = (paymentPayload as { x402Version?: number } | undefined)?.x402Version ?? 2
  return { x402Version: version, paymentPayload, paymentRequirements }
}
