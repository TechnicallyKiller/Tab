/**
 * Rechecking a published WEIGHT.
 *
 * `verify-ceiling` proves a ceiling follows from its published inputs. It never
 * proved the weights that produced those inputs, and until v3 it could not:
 * the discount steps lived in `apps/engine`, so `bp 3360` was a number a reader
 * could see and not check. Freezing the steps in `@tab/params` closed that, and
 * this is the check it unlocks.
 *
 * The arithmetic is deliberately re-implemented here rather than imported from
 * `@tab/graph`. Calling the same function that produced the number would prove
 * only that it is deterministic — a verifier has to reach the answer
 * independently, from the published reasons and the frozen steps, exactly as a
 * stranger with a spreadsheet would. `boundaries.json` bars `verify` from
 * `graph` for this reason.
 *
 * What a PASS means: the weight follows from its own published reasons under the
 * parameter set it names. It does NOT mean the reasons are the right ones — that
 * would require re-deriving the graph from Mirror Node, which is a different and
 * much weaker check, since it would compare our reading of an
 * eventually-consistent index against theirs.
 */
import { type ParameterSet, paramsForVersion, weightPolicyFor } from '@tab/params'
import { BLOCKING_REASONS, type WeightReason } from '@tab/protocol'

/**
 * The discount order, mirrored from `@tab/graph`.
 *
 * A second copy, and the duplication is the point: if this drifts from the
 * graph's ORDER the check fails, which is precisely the signal wanted. Order
 * matters because multiplication commutes but integer truncation does not, so
 * the sequence is part of the frozen model.
 */
const ORDER: readonly WeightReason[] = [
  'UNVERIFIED_FUNDING',
  'RECIPROCAL_FLOW',
  'SHARED_FUNDING_ROOT',
  'YOUNG_ACCOUNT',
  'CONCENTRATED',
  'UNATTESTED',
]

export interface ReweighTarget {
  counterparty: string
  /** Basis points, as published. */
  bp: number
  reasons: readonly WeightReason[]
  blocking: boolean
  /** The parameter set named on the message, e.g. `tab-v3`. Absent on older ones. */
  model?: string
}

export type ReweighVerdict =
  | 'ok'
  /** No model on the message, or a set with no frozen weight policy. */
  | 'not_verifiable'
  /** The steps reproduce a different number. The record contradicts itself. */
  | 'bp_mismatch'
  /** A blocking reason must be exactly zero, and a zero must have one. */
  | 'blocking_inconsistent'

export interface ReweighResult {
  verdict: ReweighVerdict
  /** What the published reasons reproduce under the named set. */
  recomputed?: number
  /** Why it could not be checked, when it could not. */
  note?: string
  parameterVersion?: number
}

/** `tab-v3` → 3. Shared shape with `versionOf` in recheck.ts. */
function versionOf(modelId: string): number | undefined {
  const match = /(\d+)$/.exec(modelId)
  return match ? Number(match[1]) : undefined
}

function stepFor(
  reason: WeightReason,
  policy: NonNullable<ParameterSet['weights']>,
  unattestedDiscountBp: number,
): number | undefined {
  switch (reason) {
    case 'RECIPROCAL_FLOW':
      return policy.reciprocalBp
    case 'SHARED_FUNDING_ROOT':
      return policy.sharedRootBp
    case 'YOUNG_ACCOUNT':
      return policy.youngBp
    case 'CONCENTRATED':
      return policy.concentratedBp
    case 'UNVERIFIED_FUNDING':
      return policy.unverifiedBp
    case 'UNATTESTED':
      return unattestedDiscountBp
    default:
      // INDEPENDENT and the blocking reasons carry no step.
      return undefined
  }
}

export function reweigh(target: ReweighTarget): ReweighResult {
  /*
   * A blocking reason is checked FIRST, and it is checked in both directions.
   *
   * A weight of 0 with no blocking reason is as wrong as a blocking reason with
   * a non-zero weight: the first is a refusal nobody can explain, the second is
   * a hard block that did not block. Neither needs a parameter set to catch,
   * which is why this runs before the version lookup — an old message with no
   * model can still fail here.
   */
  const blockingReasons = target.reasons.filter((r) =>
    (BLOCKING_REASONS as readonly string[]).includes(r),
  )
  if (blockingReasons.length > 0 || target.bp === 0 || target.blocking) {
    const consistent = blockingReasons.length > 0 && target.bp === 0 && target.blocking
    return consistent
      ? { verdict: 'ok', recomputed: 0 }
      : {
          verdict: 'blocking_inconsistent',
          recomputed: 0,
          note:
            `bp ${target.bp} · blocking ${target.blocking} · reasons [${target.reasons.join(', ')}] — ` +
            'a hard block must be exactly zero AND carry a blocking reason; a zero weight with no ' +
            'blocking reason is a refusal nobody can explain',
        }
  }

  if (!target.model) {
    return {
      verdict: 'not_verifiable',
      note:
        'the message carries no model id, so the frozen discount steps cannot be resolved — ' +
        'assuming the current set would check this weight against numbers that were not in ' +
        'force when it was written',
    }
  }

  const version = versionOf(target.model)
  if (version === undefined) {
    return {
      verdict: 'not_verifiable',
      note: `cannot read a parameter-set version from model id "${target.model}"`,
    }
  }

  let policy: NonNullable<ParameterSet['weights']> | undefined
  let unattestedDiscountBp: number
  try {
    policy = weightPolicyFor(version)
    // From the SAME set, never the current one. `unattestedDiscountBp` is a
    // top-level field rather than part of the weights block, because it
    // predates it and the ceiling formula reads it too.
    unattestedDiscountBp = paramsForVersion(version).unattestedDiscountBp
  } catch (error) {
    return {
      verdict: 'not_verifiable',
      parameterVersion: version,
      note: error instanceof Error ? error.message : String(error),
    }
  }

  if (!policy) {
    return {
      verdict: 'not_verifiable',
      parameterVersion: version,
      note:
        `parameter set v${version} carries no weight policy — the discount steps lived in ` +
        'apps/engine before v3, so a weight published under it is genuinely not reproducible ' +
        'from the frozen record. Absence of proof, not evidence of a problem',
    }
  }

  let bp = 10_000
  for (const reason of ORDER) {
    if (!target.reasons.includes(reason)) continue
    const step = stepFor(reason, policy, unattestedDiscountBp)
    if (step === undefined) continue
    // Integer, truncating — matching `@tab/graph` exactly. Rounding the other
    // way here would fail a correct weight by a micro-unit.
    bp = Math.floor((bp * step) / 10_000)
  }

  return bp === target.bp
    ? { verdict: 'ok', recomputed: bp, parameterVersion: version }
    : {
        verdict: 'bp_mismatch',
        recomputed: bp,
        parameterVersion: version,
        note:
          `reasons [${target.reasons.join(' × ')}] under ${target.model} reproduce ${bp}bp, ` +
          `but the message published ${target.bp}bp`,
      }
}
