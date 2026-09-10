import { canonicalize } from './canonical.ts'

/**
 * HCS-14 — a Universal Agent Identifier for the tab.
 *
 * A deterministic, self-sovereign id for an agent, derived from six canonical
 * fields rather than issued by anyone. There is no registry to ask and no
 * permission to obtain: given the same six inputs, any party computes the same
 * identifier, which is what lets a credit record travel between systems that do
 * not know each other.
 *
 * ## Why this matters for Tab specifically
 *
 * A tab is currently keyed on a Hedera account id, so a redeployment onto a new
 * account starts the reputation from zero — the earning is on the topic, but
 * nothing ties it to the new account. A UAID is stable across that, because it
 * is derived from what the agent IS rather than where it currently lives.
 *
 * ## Additive, deliberately
 *
 * Deriving an identifier changes no ceiling, no weight and no settlement. It is
 * published as an optional field on the registration message that already
 * exists, so a reader that does not care ignores it and every existing message
 * still decodes. Nothing about the credit model moves.
 *
 * ## The canonical form is the whole standard
 *
 * Get the bytes wrong and the identifier is not reproducible by anyone else,
 * which is strictly worse than having none — so the rules are followed exactly
 * as written and pinned by tests:
 *
 *  - ONLY the six required fields are hashed. Endpoints, topic ids and
 *    capabilities are excluded on purpose, so the id survives an endpoint move.
 *  - Object keys sorted lexicographically; no insignificant whitespace.
 *  - `skills` sorted numerically ascending.
 *  - SHA-384 over the UTF-8 bytes, Base58-encoded, no truncation.
 *
 * `canonicalize` from this package already produces exactly that JSON — sorted
 * keys, no whitespace — so it is reused rather than reimplemented. A second
 * canonicalizer beside the one `verify-ceiling` depends on is precisely the
 * shape of private copy that has bitten this repo five times.
 *
 * Spec: https://hol.org/docs/standards/hcs-14/
 */

/** The six fields, and only these, are hashed. */
export interface Hcs14Agent {
  /** Namespace, e.g. `hol`. Not a central authority — just a namespace. */
  registry: string
  name: string
  /** Semantic version. */
  version: string
  /** Communication protocol, e.g. `mcp`, `a2a`, `hcs-10`. */
  protocol: string
  /** The protocol's own identifier, e.g. `hedera:testnet:0.0.10390398`. */
  nativeId: string
  /** Capability enums: 0-39 (HCS-14 core) or 100+ (OASF). */
  skills: readonly number[]
}

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

/**
 * Base58 (Bitcoin alphabet), big-endian, with leading zero bytes preserved.
 *
 * Written out rather than pulled in: it is twenty lines, and a dependency in
 * `@tab/protocol` — the package every other one imports — has to earn its place.
 *
 * Leading zeros matter. They carry no numeric value, so the bignum loop drops
 * them; the encoding requires one `1` per leading zero byte, and omitting them
 * would make two different digests share an identifier.
 */
export function base58(bytes: Uint8Array): string {
  let zeros = 0
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++

  let value = 0n
  for (const byte of bytes) value = (value << 8n) | BigInt(byte)

  let out = ''
  while (value > 0n) {
    const rem = Number(value % 58n)
    out = BASE58[rem] + out
    value /= 58n
  }
  return '1'.repeat(zeros) + (out || (bytes.length > 0 ? '' : ''))
}

/**
 * The canonical JSON that gets hashed. Exported so a test can pin the bytes.
 *
 * Anything not in `Hcs14Agent` is dropped rather than carried, and `skills` is
 * sorted here rather than trusted from the caller — an identifier that depended
 * on the order someone happened to list capabilities in would not be
 * deterministic, which defeats the point.
 */
export function hcs14Canonical(agent: Hcs14Agent): string {
  return canonicalize({
    name: agent.name,
    nativeId: agent.nativeId,
    protocol: agent.protocol,
    registry: agent.registry,
    skills: [...agent.skills].sort((a, b) => a - b),
    version: agent.version,
  })
}

/** SHA-384 of the canonical form, Base58-encoded. The AID. */
export async function hcs14Aid(agent: Hcs14Agent): Promise<string> {
  const bytes = new TextEncoder().encode(hcs14Canonical(agent))
  const digest = await crypto.subtle.digest('SHA-384', bytes)
  return base58(new Uint8Array(digest))
}

/**
 * The full identifier: `uaid:aid:{base58};{parameters}`.
 *
 * Parameters follow the documented order — `uid`, `registry`, `proto`,
 * `nativeId` — and one absent is omitted rather than emitted empty, because a
 * trailing `nativeId=` would be a claim about an identifier nobody has.
 */
export async function hcs14Uaid(
  agent: Hcs14Agent,
  params: { uid?: string | number; domain?: string } = {},
): Promise<string> {
  const aid = await hcs14Aid(agent)
  const parts = [
    `uid=${params.uid ?? 0}`,
    `registry=${agent.registry}`,
    `proto=${agent.protocol}`,
    `nativeId=${agent.nativeId}`,
    ...(params.domain ? [`domain=${params.domain}`] : []),
  ]
  return `uaid:aid:${aid};${parts.join(';')}`
}

/**
 * The tab's own identity.
 *
 * `nativeId` is the Hedera account in the protocol's own form, and `protocol`
 * is `mcp` because that is how an agent actually reaches this rail — `@tab/mcp`
 * is the surface a third-party runtime talks to.
 *
 * Skills are the two this agent genuinely has. Padding the list would change
 * the identifier and claim capabilities it does not have, and the whole value
 * of a derived id is that it describes something true.
 */
export function tabAgent(tabAccountId: string, network = 'testnet'): Hcs14Agent {
  return {
    registry: 'hol',
    name: 'Tab',
    version: '1.0.0',
    protocol: 'mcp',
    nativeId: `hedera:${network}:${tabAccountId}`,
    // 0 — general capability; 17 — commerce/payments.
    skills: [0, 17],
  }
}
