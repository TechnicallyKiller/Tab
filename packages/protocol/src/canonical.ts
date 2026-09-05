/**
 * Canonical serialization.
 *
 * `verify-ceiling` recomputes a published ceiling from its published inputs and
 * compares hashes. That only means anything if serialization is byte-stable:
 * keys sorted, no insignificant whitespace, no floats, no locale. Otherwise the
 * check fails for reasons unrelated to correctness — which is worse than not
 * shipping it, because it discredits the one command whose job is proving the
 * numbers.
 *
 * JSON.stringify's key order follows insertion, so it cannot be trusted here.
 */

export function canonicalize(value: unknown): string {
  return JSON.stringify(sortDeep(value))
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep)
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isInteger(value)) {
      // A float in a hashed payload is a reproducibility hazard: its decimal
      // form depends on the writer. Amounts are decimal strings and rates are
      // integer basis points precisely so this never arises.
      throw new Error(
        `Refusing to canonicalize the float ${value}. Use a decimal string or integer basis points.`,
      )
    }
    return value
  }
  const source = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(source).sort()) {
    if (source[key] !== undefined) out[key] = sortDeep(source[key])
  }
  return out
}

/**
 * SHA-256 of the canonical form, lowercase hex.
 *
 * Uses Web Crypto, which is available in Node and the browser — the dashboard's
 * verify button recomputes this client-side.
 */
export async function canonicalHash(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalize(value))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
