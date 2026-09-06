/**
 * Publishing a ceiling to HCS.
 *
 * The transparency claim rests entirely on this file. `verify-ceiling` says a
 * stranger can take a published ceiling message, rerun `@tab/scoring` on the
 * inputs it carries, and get the same number and the same hash. That is only
 * true if EVERY input that influenced the result is in the message — so the
 * message carries the full `CeilingInputs` record, the canonical hash of it,
 * and the `MODEL_ID` of the parameter set it was computed under.
 *
 * If a number affected the output and is not in here, the transparency claim is
 * decoration. There is no partial version of this property.
 */
import { submitMessage, type TabClient } from '@tab/hedera'
import { toWire, type MicroUsdc } from '@tab/money'
import { canonicalHash, ceilingUpdate, encode } from '@tab/protocol'
import type { CeilingResult } from '@tab/scoring'

export type PublishCause =
  | 'clean_settlement'
  | 'missed_settlement'
  | 'graph_change'
  | 'registration'
  | 'freeze'

export interface PublishedCeiling {
  sequenceNumber: number | null
  hash: string
  /** The exact bytes that were hashed, so a caller can show or re-verify them. */
  canonical: unknown
}

/**
 * The hashed input record.
 *
 * Built explicitly rather than by spreading `CeilingResult.inputs`, and that is
 * deliberate: a spread would silently include any field later added to
 * `CeilingInputs`, changing the hash of every future ceiling without anyone
 * deciding to. Naming each field means adding one is a visible choice, which is
 * what a version bump is for.
 *
 * bigints become decimal STRINGS via `toWire`. `canonicalize` refuses floats
 * outright, and JSON has no bigint — so amounts are strings and rates are
 * integer basis points, everywhere, on purpose.
 */
export function ceilingInputRecord(result: CeilingResult): Record<string, unknown> {
  const i = result.inputs
  return {
    rev: toWire(i.revenue),
    revAtt: toWire(i.attested),
    revUnatt: toWire(i.unattested),
    tier: i.tier,
    mult: i.multipleBp,
    ramp: i.rampBp,
    cap: toWire(i.hardCap),
    floor: toWire(i.starterFloor),
    // An input that changes the output on its own, so it is published. A new
    // tab and a defaulted tab both read as Unrated and get very different
    // ceilings; without this, verify-ceiling could not tell them apart.
    def: i.hasDefaulted,
  }
}

export interface PublishParams {
  hedera: TabClient
  topicId: string
  tab: string
  window: number
  result: CeilingResult
  cause: PublishCause
  modelId: string
  /**
   * What the fast path should enforce, when the asymmetry rule differs from the
   * formula.
   *
   * Defaults to the computed ceiling. Passing the in-force value matters
   * because the gateway CONSUMES this message: publishing the computed figure
   * while a growth was being held would hand the fast path the increase the
   * guard exists to withhold, and the asymmetry rule would be defeated by its
   * own audit trail.
   */
  inForce?: MicroUsdc
}

/**
 * Publish, and return the hash so the caller can print it next to the number.
 *
 * A ceiling is published even when it did NOT change — "stayed capped because
 * concentration" is information the operator needs, and an engine that only
 * speaks when a number moves is indistinguishable from one that has died. The
 * caller decides; this function does not second-guess it by skipping a write.
 */
export async function publishCeiling(params: PublishParams): Promise<PublishedCeiling> {
  const inputs = ceilingInputRecord(params.result)
  const hash = await canonicalHash(inputs)

  const inForce = params.inForce ?? params.result.ceiling
  const held = inForce !== params.result.ceiling

  const message = ceilingUpdate.parse({
    v: 1,
    t: 'ceiling',
    tab: params.tab,
    w: params.window,
    ceil: toWire(inForce),
    // Only when they differ, so the common case stays a smaller message and a
    // reader can tell "held" from "normal" without comparing two numbers.
    ...(held ? { computed: toWire(params.result.ceiling) } : {}),
    bind: params.result.binding,
    inputs,
    model: params.modelId,
    hash,
    cause: params.cause,
  })

  const written = await submitMessage(params.hedera.client, params.topicId, encode(message))
  return { sequenceNumber: written.sequenceNumber, hash, canonical: inputs }
}
