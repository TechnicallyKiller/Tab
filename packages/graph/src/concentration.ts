import type { MicroUsdc } from '@tab/money'
import type { AccountId } from './types.ts'

/**
 * The single-counterparty share cap.
 *
 * An agent earning 95% of its revenue from one buyer is not diversified, and
 * its ceiling should not pretend otherwise — if that buyer stops, the revenue
 * the credit was extended against vanishes at once. This is a concentration
 * discount, not a fraud finding: a legitimate agent with one big customer is
 * common and is not doing anything wrong.
 *
 * ALL INTEGER BASIS POINTS. This check was written once with a float — `share >
 * 0.4` — and that is a real defect rather than a style point: `0.4` has no
 * exact binary representation, so at exactly 40% the comparison can go either
 * way depending on how the share was computed. A rule that decides differently
 * on identical inputs is worse than no rule.
 */

export interface ConcentrationEntry {
  counterparty: AccountId
  amount: MicroUsdc
  /** Share of the total, integer basis points. */
  shareBp: number
  /** True when this counterparty is over the cap. */
  over: boolean
}

export interface ConcentrationResult {
  total: MicroUsdc
  entries: readonly ConcentrationEntry[]
  /** Counterparties over the cap, largest first. */
  overCap: readonly ConcentrationEntry[]
  /** The largest single share, basis points. 0 when there is no revenue. */
  topShareBp: number
}

/**
 * Share of total revenue per counterparty, against `capBp`.
 *
 * @param byCounterparty  revenue per counterparty. Must be non-negative.
 * @param capBp           from `@tab/params` — 4000 is 40%.
 */
export function concentration(
  byCounterparty: ReadonlyMap<AccountId, MicroUsdc>,
  capBp: number,
): ConcentrationResult {
  let total = 0n
  for (const amount of byCounterparty.values()) {
    if (amount < 0n) {
      throw new Error('concentration takes revenue, which cannot be negative')
    }
    total += amount
  }

  if (total === 0n) {
    // No revenue is not concentrated revenue. Returning a 100% share here — or
    // dividing by zero — would make a brand-new agent look maximally risky for
    // the one reason that says nothing about it.
    return { total: total as MicroUsdc, entries: [], overCap: [], topShareBp: 0 }
  }

  const entries: ConcentrationEntry[] = [...byCounterparty.entries()]
    .map(([counterparty, amount]) => {
      // Integer division, truncating. The share is understated by less than one
      // basis point, and understating is the safe direction: it can only fail
      // to flag a borderline counterparty, never flag a compliant one.
      const shareBp = Number((amount * 10_000n) / total)
      return { counterparty, amount, shareBp, over: shareBp > capBp }
    })
    .sort((a, b) => b.shareBp - a.shareBp || (a.counterparty < b.counterparty ? -1 : 1))

  return {
    total: total as MicroUsdc,
    entries,
    overCap: entries.filter((e) => e.over),
    topShareBp: entries[0]?.shareBp ?? 0,
  }
}
