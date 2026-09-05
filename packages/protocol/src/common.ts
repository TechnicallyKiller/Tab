import { z } from 'zod'

/**
 * Shared field shapes for every HCS message.
 *
 * Two hard constraints shape this file, both measured rather than assumed:
 *
 *  1. **Keep a message under 1KB.** Above roughly that, HCS splits the payload
 *     across chunks with separate sequence numbers, and parsing a lone chunk
 *     yields truncated JSON — loud if you are lucky, silent if you are not.
 *     Field names are therefore short and nothing carries prose.
 *  2. **Amounts are decimal strings, never numbers.** `JSON.stringify` cannot
 *     serialise a bigint, and a float would defeat the whole point of
 *     @tab/money. Six decimals, matching the token.
 */

/** Every message carries its schema version. A topic is append-only: a v1 message written in week one must still parse in week three. */
export const SCHEMA_VERSION = 1

/** "0.0.1234" */
export const entityId = z.string().regex(/^\d+\.\d+\.\d+$/, 'expected a Hedera entity id like 0.0.1234')

/** "seconds.nanos" — the consensus ordering key. */
export const consensusTimestamp = z.string().regex(/^\d+\.\d{1,9}$/, 'expected seconds.nanos')

/** Signed decimal with exactly 6 places. Parse with usdc() from @tab/money. */
export const amount = z
  .string()
  .regex(/^-?\d+\.\d{6}$/, 'expected a signed decimal with exactly 6 places, e.g. "-0.482100"')

/** Integer basis points. 10000 = 1.0. Rates are never decimals. */
export const basisPoints = z.number().int().min(0).max(1_000_000)

/** Truncated hash, enough to correlate without bloating the message. */
export const shortHash = z.string().regex(/^[0-9a-f]{8,64}$/, 'expected lowercase hex')

export const windowIndex = z.number().int().nonnegative()

export const base = z.object({
  /** Schema version. */
  v: z.literal(SCHEMA_VERSION),
  /** The agent this message concerns. */
  tab: entityId,
  /** Window index, so a replay can bucket without arithmetic on timestamps. */
  w: windowIndex,
})

export type Base = z.infer<typeof base>
