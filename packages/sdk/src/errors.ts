/**
 * Typed errors — and the one thing that is deliberately NOT an error.
 *
 * **A refusal is a value, not an exception.** `spend()` returns a discriminated
 * result carrying the rule that fired. Throwing on refusal would push every
 * consumer into `try/catch`, and refusal is the product demonstrating that
 * underwriting works — it deserves a first-class type, not a control-flow
 * escape.
 *
 * These throw only for transport and protocol failures: the gateway was
 * unreachable, or it answered something this client cannot interpret.
 */

/** The gateway could not be reached, or did not answer in time. */
export class TabUnavailableError extends Error {
  readonly kind = 'unavailable' as const
  /*
   * Fields declared and assigned, not TS parameter properties.
   *
   * `erasableSyntaxOnly` is on across the repo so Node can run the TypeScript
   * directly with `--experimental-strip-types`, and parameter properties are
   * not erasable — they generate assignments. The constraint is repo-wide; see
   * HANDOFF.
   */
  readonly reason: unknown
  constructor(message: string, reason?: unknown) {
    super(message)
    this.name = 'TabUnavailableError'
    this.reason = reason
  }
}

/**
 * The gateway answered, but not with something this client understands.
 *
 * Carries the status and the raw body. A caller debugging a version mismatch
 * needs to see what actually came back — "invalid response" with the evidence
 * discarded is the least useful error a client can raise.
 */
export class TabProtocolError extends Error {
  readonly kind = 'protocol' as const
  readonly status: number
  readonly body: unknown
  constructor(message: string, status: number, body: unknown) {
    super(message)
    this.name = 'TabProtocolError'
    this.status = status
    this.body = body
  }
}

/** A caller mistake — a malformed amount, a missing tab id. */
export class TabInvalidError extends Error {
  readonly kind = 'invalid' as const
  constructor(message: string) {
    super(message)
    this.name = 'TabInvalidError'
  }
}

export type TabError = TabUnavailableError | TabProtocolError | TabInvalidError

export function isTabError(error: unknown): error is TabError {
  return (
    error instanceof TabUnavailableError ||
    error instanceof TabProtocolError ||
    error instanceof TabInvalidError
  )
}
