import { Agent, setGlobalDispatcher } from 'undici'

/**
 * Raise Node's HTTP connect timeout, process-wide.
 *
 * Node's global `fetch` is undici, and undici has a **10 second connect
 * timeout that no AbortController can extend** — an abort signal bounds the
 * whole request, but the connect phase fails first and independently.
 *
 * Measured against the public Hedera Mirror Node from a high-latency link:
 * connect takes 5–15 seconds. So roughly half of all requests die on undici's
 * default before our own timeout is ever consulted, and the failure surfaces as
 * a bare `TypeError: fetch failed`.
 *
 * That is bad enough on its own, but it is worse inside x402: the facilitator's
 * `verifyPayerSignature` fetches the payer's on-chain key from Mirror Node, and
 * when that fetch dies the scheme fails closed with
 * `invalid_exact_hedera_payload_signature_invalid` — a signature error for a
 * network problem. It cost most of an afternoon to trace, because the error
 * names the wrong subsystem.
 *
 * This is a PROCESS-GLOBAL setting, so call it exactly once at boot from an
 * app or tool entry point. Never from library code.
 */
export function configureGlobalHttp(
  options: { connectTimeoutMs?: number; headersTimeoutMs?: number; bodyTimeoutMs?: number } = {},
): void {
  const connectTimeout = options.connectTimeoutMs ?? 45_000
  setGlobalDispatcher(
    new Agent({
      connect: { timeout: connectTimeout },
      headersTimeout: options.headersTimeoutMs ?? 45_000,
      bodyTimeout: options.bodyTimeoutMs ?? 45_000,
    }),
  )
}
