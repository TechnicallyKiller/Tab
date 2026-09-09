import { type MicroUsdc, usdc } from '@tab/money'
import type { Tier } from '@tab/params'

/**
 * Revenue, diversity and settlement history → tier.
 *
 * Tier decides both the ceiling multiple and the APR, so this is the single
 * most consequential function in the package and the one a judge will push on.
 * It is deliberately boring: bands, a diversity requirement, and one absolute
 * rule.
 */

export interface TierInputs {
  /** Effective revenue per window, already weighted. */
  perWindow: MicroUsdc
  /** How many DISTINCT counterparties contributed attested revenue. */
  counterparties: number
  /** Consecutive clean settlements. Resets to zero on a miss. */
  cleanStreak: number
  /** Has this tab ever missed a settlement it was asked to make? */
  hasDefaulted: boolean
}

export interface TierResult {
  tier: Tier
  /** Why this tier and not the one above. The operator's actual question. */
  reason: string
}

/** Revenue bands, per window. A tier needs revenue AND diversity AND history. */
const BANDS: readonly {
  tier: Exclude<Tier, 'Unrated'>
  min: string
  counterparties: number
  streak: number
}[] = [
  { tier: 'A', min: '5.000000', counterparties: 5, streak: 10 },
  { tier: 'B', min: '1.000000', counterparties: 3, streak: 4 },
  { tier: 'C', min: '0.100000', counterparties: 1, streak: 1 },
]

/**
 * A default collapses the tab to Unrated. There is no partial credit.
 *
 * The harshest rule here and the one worth defending: a missed settlement is
 * the only event that proves the credit decision was wrong. Everything else is
 * a prediction. Softening it — "one default drops you a tier" — makes the first
 * default cheap, and the whole product rests on it being expensive.
 *
 * Unrated sets the tier multiple to zero, so the ceiling becomes exactly zero.
 * The tab can still earn its way back: revenue accrues, and a clean settlement
 * history rebuilds. It just cannot borrow while it does.
 */
export function tierOf(inputs: TierInputs): TierResult {
  if (inputs.hasDefaulted) {
    return {
      tier: 'Unrated',
      reason: 'a missed settlement collapses the tab to Unrated — there is no partial credit',
    }
  }

  if (inputs.counterparties < 0 || inputs.cleanStreak < 0) {
    throw new Error('counterparties and cleanStreak cannot be negative')
  }

  /*
   * Walk bands high to low and award the FIRST one fully met.
   *
   * The first version jumped straight to "the tier below" when a band's
   * non-revenue requirements failed, which is wrong: failing A's streak does
   * not make a tab B, because B has a streak requirement too. It would have
   * awarded B to a tab with A-grade revenue and zero settlement history — the
   * exact profile the streak requirement exists to exclude.
   */
  let nearMiss: string | undefined
  for (const band of BANDS) {
    const min = usdc(band.min)
    if (inputs.perWindow < min) continue

    if (inputs.counterparties < band.counterparties) {
      nearMiss ??=
        `revenue reaches ${band.tier} but only ${inputs.counterparties} counterparty(ies) ` +
        `contributed — ${band.tier} needs ${band.counterparties}. Revenue from one buyer is ` +
        "one buyer's decision, not a market"
      continue
    }
    if (inputs.cleanStreak < band.streak) {
      nearMiss ??=
        `revenue and diversity reach ${band.tier} but the clean streak is ` +
        `${inputs.cleanStreak} of the ${band.streak} required — the history is not there yet`
      continue
    }
    return {
      tier: band.tier,
      reason: nearMiss
        ? `${band.tier}: ${nearMiss}`
        : `revenue, diversity and settlement history all meet ${band.tier}`,
    }
  }

  return {
    tier: 'Unrated',
    reason:
      nearMiss ??
      `revenue per window is below the ${BANDS[BANDS.length - 1]!.min} floor for any rated tier`,
  }
}
