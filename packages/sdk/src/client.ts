import { TabProtocolError, TabUnavailableError } from './errors.ts'

/**
 * The HTTP client.
 *
 * Thin on purpose. `boundaries.json` forbids `@hiero-ledger/sdk`, `ioredis` and
 * `drizzle-orm` here, and that constraint carries the product claim: the agent
 * holds no key and signs nothing, so the library it installs should not even be
 * ABLE to sign. If this bundled the Hedera SDK the claim would rest on us not
 * having used it; this way it rests on a check anyone can run.
 *
 * Browser-safe for the same reason — `apps/web` imports this, and a browser
 * bundle must not be able to reach a signing path or a database driver.
 */

export interface TabClientConfig {
  /** The gateway's base URL. */
  baseUrl: string
  /**
   * Bearer token, if the deployment requires one.
   *
   * NOT a private key, and there is deliberately no way to pass one. If this
   * constructor ever accepts key material the whole claim is gone.
   */
  token?: string
  /** Per-request timeout. Default 120s — a spend waits on x402 settlement. */
  timeoutMs?: number
  /** Retries for transport failures only. Default 2. */
  maxRetries?: number
  /** Injectable for tests and for runtimes with a non-global fetch. */
  fetch?: typeof globalThis.fetch
}

const DEFAULTS = {
  /*
   * 120 seconds, which looks absurd for an HTTP client and is not.
   *
   * A spend waits on an x402 HTS settlement, measured at 25-39s end to end,
   * plus a hold write awaiting consensus. A 30s default would time out on
   * perfectly healthy spends and the caller would retry — against a gateway
   * that had already taken the hold.
   */
  timeoutMs: 120_000,
  maxRetries: 2,
}

export class TabClient {
  private readonly baseUrl: string
  private readonly token?: string
  private readonly timeoutMs: number
  private readonly maxRetries: number
  private readonly doFetch: typeof globalThis.fetch

  constructor(config: TabClientConfig) {
    // Trailing slash removed once, here, so every path can be written `/v1/...`
    // without a caller having to know whether it will be doubled.
    this.baseUrl = config.baseUrl.replace(/\/+$/, '')
    if (config.token) this.token = config.token
    this.timeoutMs = config.timeoutMs ?? DEFAULTS.timeoutMs
    this.maxRetries = config.maxRetries ?? DEFAULTS.maxRetries
    /*
     * BOUND to globalThis, and that bind is load-bearing in a browser.
     *
     * `fetch` is a method on Window, and the spec requires it to be called with
     * a Window receiver. Stored bare and invoked as `this.doFetch(...)`, the
     * receiver becomes this client instance and the browser throws
     *
     *   TypeError: Failed to execute 'fetch' on 'Window': Illegal invocation
     *
     * before a single byte leaves the machine. Node's fetch has no such
     * requirement, so every test here and every server-side caller passed while
     * the console failed on EVERY request — and failed as a transport error,
     * which reads exactly like an unreachable gateway. It cost hours of
     * chasing CORS and cold starts that were never involved.
     *
     * An INJECTED fetch is used as given: it is the caller's function and
     * binding it to globalThis would be us rewriting their receiver.
     */
    this.doFetch = config.fetch ?? globalThis.fetch.bind(globalThis)
  }

  /**
   * One request, with retries for transport failures only.
   *
   * A 4xx or 5xx is NOT retried. The gateway answered — retrying an answer we
   * did not like is how a refused spend becomes six refused spends, and how a
   * 500 mid-settlement becomes a double payment. Only a thrown fetch (DNS,
   * connection reset, timeout) is retried, and only because in that case the
   * caller has no answer at all.
   */
  async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`
    let lastError: unknown

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), this.timeoutMs)
      try {
        const response = await this.doFetch(url, {
          method,
          headers: {
            'content-type': 'application/json',
            ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: controller.signal,
        })

        const text = await response.text()
        let parsed: unknown
        try {
          parsed = text.length > 0 ? JSON.parse(text) : null
        } catch {
          throw new TabProtocolError(
            `The gateway returned ${response.status} with a body that is not JSON`,
            response.status,
            text.slice(0, 512),
          )
        }

        /*
         * A REFUSAL comes back 200 with `{ refused: ... }`, so it lands here as
         * a normal response and the caller gets a value. A non-2xx really is a
         * protocol failure — the gateway could not answer the question.
         */
        if (!response.ok) {
          throw new TabProtocolError(
            `The gateway returned ${response.status}`,
            response.status,
            parsed,
          )
        }
        return parsed as T
      } catch (error) {
        if (error instanceof TabProtocolError) throw error
        lastError = error
        // Backoff only between attempts, never after the last one.
        if (attempt < this.maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt))
        }
      } finally {
        clearTimeout(timer)
      }
    }

    /*
     * The outcome is UNKNOWN, and saying so is the whole point of this message.
     *
     * The first draft said "nothing was spent", which is false and dangerously
     * reassuring: a timeout can mean the gateway took the hold, paid the seller,
     * and the RESPONSE was lost. A client that tells a caller it is safe to
     * retry blindly is how one spend becomes two.
     *
     * The idempotency key is what makes a retry safe, so the caller is told to
     * reuse it rather than told not to worry.
     */
    /*
     * The CAUSE is named in the message, not only attached as `cause`.
     *
     * "Could not reach the gateway" is true of a CORS rejection, a DNS
     * failure, a refused connection and a timeout alike — and those have
     * completely different fixes. The distinguishing detail was being carried
     * on a property nothing displays, so a console showing this error sent us
     * hunting the wrong problem more than once.
     *
     * An AbortError here is always OUR timeout firing, so it is named as one:
     * "aborted" reads like a cancelled request and hides the fact that a
     * deadline was exceeded.
     */
    const because =
      lastError instanceof Error
        ? lastError.name === 'AbortError' || lastError.name === 'TimeoutError'
          ? `timed out after ${this.timeoutMs}ms`
          : `${lastError.name}: ${lastError.message}`
        : String(lastError)

    throw new TabUnavailableError(
      `Could not reach the Tab gateway at ${url} after ${this.maxRetries + 1} attempt(s) ` +
        `(${because}). ` +
        'The outcome is UNKNOWN — a transport failure cannot distinguish "never arrived" from ' +
        '"succeeded and the response was lost". Retry with the SAME idempotencyKey: the gateway ' +
        'treats it as the hold id, so a repeat cannot double-spend. Do not retry with a new key.',
      lastError,
    )
  }
}
