/**
 * The recheck itself, separated from the command that prints it.
 *
 * Extracted so it can be tested. These are the functions the entire
 * transparency claim rests on, and "it printed PASS against live data once" is
 * not the same as knowing that a TAMPERED record fails — which is the only
 * property that makes a PASS worth anything.
 */

import { type MicroUsdc, usdc } from '@tab/money'
import { paramsForVersion, type Tier } from '@tab/params'
import { canonicalHash } from '@tab/protocol'
import { type CeilingInputs, computeCeiling } from '@tab/scoring'

export interface RecheckTarget {
  /** In force, from the message. */
  ceiling: MicroUsdc
  /** The formula's result, when the asymmetry rule held a growth back. */
  computed?: MicroUsdc
  binding: string
  model: string
  hash: string
  /** The published input record, verbatim. */
  inputs: Record<string, unknown>
}

export type RecheckFailure = 'hash_mismatch' | 'not_reproducible'

export interface RecheckResult {
  ok: boolean
  failure?: RecheckFailure
  /** Hash recomputed from the published inputs. */
  rehash: string
  hashOk: boolean
  /** What the formula produces from the published inputs today. */
  recomputed: MicroUsdc
  recomputedBinding: string
  /** What the message claims the formula produced. */
  claimed: MicroUsdc
  /** True when `ceil` is deliberately below the formula's result. */
  heldBack: boolean
  valueOk: boolean
  bindingOk: boolean
  parameterVersion: number
}

/**
 * `tab-v1` → 1.
 *
 * The message carries a string because a bare number could be read as a schema
 * version a year from now; the numeric suffix indexes the frozen sets.
 */
export function versionOf(modelId: string): number {
  const match = /(\d+)$/.exec(modelId)
  if (!match) throw new Error(`Cannot read a parameter-set version from model id "${modelId}"`)
  return Number(match[1])
}

/**
 * Rebuild `CeilingInputs` from a published record.
 *
 * Nothing is defaulted from the current environment, and that restraint is the
 * point: a value quietly supplied here would be one the publisher never
 * committed to, and the recomputation would be checking our present state
 * rather than their published claim.
 *
 * Throws on a malformed record rather than coercing. A record that cannot be
 * read is unverifiable, and unverifiable must never read as fine.
 */
export function inputsFrom(raw: Record<string, unknown>): CeilingInputs {
  const amount = (key: string): string => {
    const value = raw[key]
    if (typeof value !== 'string') {
      throw new Error(`published input "${key}" is ${typeof value}, expected a decimal string`)
    }
    return value
  }
  const rate = (key: string): number => {
    const value = raw[key]
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      throw new Error(`published input "${key}" is not an integer basis-point value`)
    }
    return value
  }
  const tier = raw['tier']
  if (tier !== 'A' && tier !== 'B' && tier !== 'C' && tier !== 'Unrated') {
    throw new Error(`published input "tier" is ${JSON.stringify(tier)}, not a known tier`)
  }
  return {
    revenue: usdc(amount('rev')),
    attested: usdc(amount('revAtt')),
    unattested: usdc(amount('revUnatt')),
    tier: tier as Tier,
    multipleBp: rate('mult'),
    rampBp: rate('ramp'),
    hardCap: usdc(amount('cap')),
    starterFloor: usdc(amount('floor')),
    // Optional for ceilings published before the field existed. Absent means
    // false, which is what those ceilings meant.
    hasDefaulted: raw['def'] === true,
  }
}

/**
 * Recompute and compare.
 *
 * The two failure modes mean opposite things and are reported separately:
 *
 *  - `hash_mismatch` — the published inputs do not hash to the published hash.
 *    The record contradicts itself; suspect the publisher.
 *  - `not_reproducible` — the hash MATCHES, so the record is authentic, but
 *    today's formula or parameter set no longer produces it. That is a release
 *    -process failure on our side, not a ledger failure, and it should not cast
 *    doubt on the topic.
 */
export async function recheck(target: RecheckTarget): Promise<RecheckResult> {
  const parameterVersion = versionOf(target.model)
  // Throws on an unknown version rather than falling back to the current set:
  // verifying a v1 ceiling against v2 numbers reports a mismatch that looks
  // like fraud and is only a lookup bug.
  paramsForVersion(parameterVersion)

  // Hash the record AS PUBLISHED. Round-tripping through typed fields risks
  // changing key order or number formatting and failing for a reason unrelated
  // to whether the ceiling is right.
  const rehash = await canonicalHash(target.inputs)
  const hashOk = rehash === target.hash

  const result = computeCeiling(inputsFrom(target.inputs))

  /*
   * The inputs recompute to the FORMULA's result, which is `computed` when a
   * growth was held and `ceil` otherwise. Comparing against `ceil` alone would
   * fail every held ceiling — and a held ceiling is the safety rule working.
   */
  const claimed = target.computed ?? target.ceiling
  const valueOk = result.ceiling === claimed
  const bindingOk = result.binding === target.binding
  const ok = hashOk && valueOk && bindingOk

  return {
    ok,
    ...(ok ? {} : { failure: hashOk ? ('not_reproducible' as const) : ('hash_mismatch' as const) }),
    rehash,
    hashOk,
    recomputed: result.ceiling,
    recomputedBinding: result.binding,
    claimed,
    heldBack: target.computed !== undefined,
    valueOk,
    bindingOk,
    parameterVersion,
  }
}
