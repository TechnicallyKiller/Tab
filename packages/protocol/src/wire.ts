import { tabMessage, type TabMessage } from './messages.ts'
import { canonicalize } from './canonical.ts'

/**
 * Encoding to and from an HCS topic.
 *
 * The size limit is not advisory. Above roughly 1KB, HCS splits a payload
 * across chunks with their own sequence numbers, and a lone chunk parses as
 * truncated JSON. Measured on testnet; see docs/probes.md.
 */
export const MAX_MESSAGE_BYTES = 1024

export function encode(message: TabMessage): Uint8Array {
  // Validate before writing. A topic is append-only — a malformed message is
  // permanent, and there is no migration for consensus.
  const parsed = tabMessage.parse(message)
  const bytes = new TextEncoder().encode(canonicalize(parsed))

  if (bytes.length > MAX_MESSAGE_BYTES) {
    throw new Error(
      `Message is ${bytes.length} bytes, over the ${MAX_MESSAGE_BYTES} byte single-chunk limit. ` +
        'It would be split across chunks and a partial read would parse as truncated JSON. ' +
        'Shorten it — receipts carry hashes and ids, never payloads.',
    )
  }
  return bytes
}

export type DecodeResult =
  | { ok: true; message: TabMessage }
  | { ok: false; reason: string; raw: string }

/**
 * Decode a topic message.
 *
 * Returns a result rather than throwing: a replay walks the whole topic, and
 * one unrecognised message — a `bootstrap.hello`, or a future schema version —
 * must not abort the reconstruction of everything after it.
 */
export function decode(payload: Uint8Array | string): DecodeResult {
  const raw = typeof payload === 'string' ? payload : new TextDecoder().decode(payload)
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return { ok: false, reason: 'not valid JSON (a truncated chunk looks like this)', raw }
  }
  const parsed = tabMessage.safeParse(json)
  if (!parsed.success) {
    return { ok: false, reason: parsed.error.issues[0]?.message ?? 'schema mismatch', raw }
  }
  return { ok: true, message: parsed.data }
}
