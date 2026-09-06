/**
 * @tab/params — every tunable number, versioned.
 *
 * Tier 0. Depends only on `@tab/money`. No I/O, no environment reads.
 *
 * A parameter here is not a config value; it is part of the audit trail. Every
 * published ceiling carries the `MODEL_VERSION` it was computed under, and
 * `verify-ceiling` recomputes it from the frozen set for that version. That is
 * why these are importable constants rather than env vars: an env var that has
 * since changed makes every historical ceiling unverifiable.
 */
import { usdc, type MicroUsdc } from '@tab/money'
import type { ParameterSet, Tier } from './schema.ts'
import { v1 } from './versions/v1.ts'
import { v2 } from './versions/v2.ts'

/** The set in force. Bumped on ANY parameter change. */
export const MODEL_VERSION = 2

/**
 * The version as a published identifier.
 *
 * Every HCS ceiling message carries this so a historical ceiling stays
 * recomputable, and `@tab/protocol` types the field as a string of 3-32 chars —
 * so a bare `1`, or `v1`, will not validate. Deliberately not just the number:
 * a ceiling that says `model: "tab-v1"` names the parameter SET it was computed
 * under, where `model: 1` could be read as a schema version, an API version, or
 * anything else a year from now.
 */
export const MODEL_ID = `tab-v${MODEL_VERSION}`

/*
 * Every version ever published, forever.
 *
 * A ceiling published under v1 must stay recomputable in week three, so
 * versions are added and never removed. `paramsForVersion` throws on an unknown
 * one rather than falling back to the current set — verifying a v1 ceiling
 * against v2 numbers would report a mismatch that looks exactly like fraud and
 * is only a lookup bug.
 */
const SETS: Record<number, ParameterSet> = { 1: v1, 2: v2 }

export const params: ParameterSet = v2

/**
 * The parameter set a historical ceiling was computed under.
 *
 * Throws on an unknown version rather than falling back to the current set.
 * Verifying a v1 ceiling against v2 numbers would report a mismatch that looks
 * like fraud but is only a lookup bug — the worst possible failure mode for the
 * one tool whose job is telling those apart.
 */
export function paramsForVersion(version: number): ParameterSet {
  const set = SETS[version]
  if (!set) {
    throw new Error(
      `No parameter set for model version ${version}. Known: ${Object.keys(SETS).join(', ')}. ` +
        'A published ceiling must stay recomputable, so versions are never removed — ' +
        'if this version once existed, it was deleted in error.',
    )
  }
  return set
}

/** APR for a tier, basis points. Unrated pays the C rate. */
export function aprBpFor(t: Tier, set: ParameterSet = params): number {
  return set.aprBp[t] ?? set.aprBp['Unrated']!
}

/** Ceiling multiple for a tier, basis points. 10000 = 1x attested earnings. */
export function tierMultipleBpFor(t: Tier, set: ParameterSet = params): number {
  return set.tierMultipleBp[t] ?? set.tierMultipleBp['Unrated']!
}

/** Caps as money, parsed once. The set stores them as strings so it can be hashed. */
export const caps: {
  perCall: MicroUsdc
  perWindow: MicroUsdc
  starterCeiling: MicroUsdc
} = {
  perCall: usdc(params.caps.perCallUsdc),
  perWindow: usdc(params.caps.perWindowUsdc),
  starterCeiling: usdc(params.caps.starterCeilingUsdc),
}

/**
 * Every parameter in force, as printable lines.
 *
 * The demo depends on being able to show this. A rail that says "credit is
 * earned, not granted" has to be able to show the numbers that decide it, and
 * the testnet-tuned `ageFullDays` is in here deliberately — hiding a tuning
 * knob reads far worse than explaining one.
 */
export function describeParams(set: ParameterSet = params): string[] {
  const pct = (b: number) => `${(b / 100).toFixed(2)}%`
  return [
    `model version        ${set.version}`,
    `APR by tier          A ${pct(set.aprBp['A']!)} · B ${pct(set.aprBp['B']!)} · C ${pct(set.aprBp['C']!)} · Unrated ${pct(set.aprBp['Unrated']!)}`,
    `ceiling multiple     A ${set.tierMultipleBp['A']! / 10000}x · B ${set.tierMultipleBp['B']! / 10000}x · C ${set.tierMultipleBp['C']! / 10000}x · Unrated ${set.tierMultipleBp['Unrated']! / 10000}x`,
    `ramp                 start ${pct(set.ramp.startBp)} · clean +${pct(set.ramp.cleanStepBp)} · missed −${pct(set.ramp.missedStepBp)} · clamp ${pct(set.ramp.minBp)}–${pct(set.ramp.maxBp)}`,
    `caps                 ${set.caps.perCallUsdc}/call · ${set.caps.perWindowUsdc}/window · starter ceiling ${set.caps.starterCeilingUsdc}`,
    `concentration cap    ${pct(set.caps.concentrationCapBp)} of attested earnings from one counterparty`,
    `unattested discount  ${pct(set.unattestedDiscountBp)} of face value`,
    `account age          full credit at ${set.ageFullDays} days  (TUNED DOWN FOR TESTNET — every testnet account is young)`,
    `funding ancestry     ${set.fundingAncestryHops} hops`,
    `window               ${set.window.seconds}s · hold TTL ${set.window.holdTtlSeconds}s`,
    `rounding             interest ${set.interestRounding} · ramp ${set.ramp.rounding}  (both compound; never in the agent's favour)`,
  ]
}

export { parameterSet, tier, type ParameterSet, type Tier } from './schema.ts'
export { v1 } from './versions/v1.ts'
export { v2 } from './versions/v2.ts'
export {
  windowConsensusRange,
  windowEnd,
  windowOf,
  windowStart,
  type EpochSeconds,
} from './window.ts'
