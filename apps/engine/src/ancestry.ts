/**
 * Resolving funding ancestry, with a memory.
 *
 * Extracted from `main.ts` so it can be tested, and it needed to be: this is a
 * **security rule that fails open**, and the branch that matters most — Mirror
 * Node unavailable, topic answers instead — is the branch a live run is least
 * likely to exercise, because Mirror usually works. Proving it by coincidence
 * is not proving it.
 *
 * The rule the whole file implements: **a fact observed once is never
 * forgotten.** Funding ancestry used to be re-derived every pass from Mirror
 * Node's transactions-by-account index, which is *intermittent* for new
 * accounts — measured returning 5 transactions once and 0 both before and
 * after, minutes apart. A failed lookup meant no `fundedBy`, which weighted the
 * counterparty INDEPENDENT, the unsafe direction. The loop attacker went
 * uncaught on its first full run because of exactly that.
 */
import type { AccountFacts, AccountId } from '@tab/graph'
import type { RememberedFacts } from '@tab/ledger'
import type { ObservedFact } from './publish/facts.ts'

/** What one lookup can tell us. Both optional: absent means NOT OBSERVED. */
export interface Observation {
  createdAt?: string
  funder?: AccountId
}

export interface AncestryDeps {
  /** Fetch one account's provenance. May throw — that is the case that matters. */
  observe: (account: AccountId) => Promise<Observation>
  /** What the topic already remembers. Monotonic; see `factsFromMessages`. */
  remembered: ReadonlyMap<AccountId, RememberedFacts>
  /** Hop limit. `params.fundingAncestryHops`. */
  hops: number
  /** Where progress and warnings go. Injected so tests can read them. */
  note?: (line: string) => void
}

export interface AncestryResult {
  /** Ready for `@tab/graph`. One `fundedBy` per account; chains resolve by lookup. */
  facts: Map<AccountId, AccountFacts>
  /**
   * Accounts with NO funder — neither observed this pass nor remembered.
   *
   * The funding rules could not be evaluated against these, and before v3 that
   * read as "no relationship" and weighted them independent. `UNVERIFIED_FUNDING`
   * now discounts them instead.
   *
   * Note what this is NOT: an account that genuinely has no creating payer.
   * Those exist — `0.0.2` is a genesis account — but a counterparty of an
   * agent's tab is never one, and treating a genesis account as unverifiable is
   * the safe direction anyway.
   */
  unverified: Set<AccountId>
  /** Creation times, so the age rule needs no second fetch. */
  birthdays: Map<AccountId, string>
  /** Everything this pass actually saw, for the publisher to diff. */
  observed: ObservedFact[]
  stats: {
    /** Answered by Mirror Node. */
    fetched: number
    /** Answered by the TOPIC after Mirror failed. The fix, counted. */
    remembered: number
    /** Never observed and never published — the residual fail-open. */
    unknown: number
  }
}

export async function resolveAncestry(
  roots: readonly AccountId[],
  deps: AncestryDeps,
): Promise<AncestryResult> {
  const note = deps.note ?? (() => {})
  const facts = new Map<AccountId, AccountFacts>()
  const birthdays = new Map<AccountId, string>()
  const unverified = new Set<AccountId>()
  const observed: ObservedFact[] = []
  const stats = { fetched: 0, remembered: 0, unknown: 0 }

  /*
   * Memoised across the whole pass, not per root.
   *
   * The point of an ancestry walk is that accounts share ancestors, so the same
   * funder gets asked for repeatedly — and every extra ask is another chance
   * for the intermittent index to fail on an account we already resolved.
   */
  const resolved = new Set<AccountId>()

  async function walk(account: AccountId, hopsLeft: number): Promise<void> {
    if (hopsLeft <= 0 || resolved.has(account)) return
    resolved.add(account)

    const recall = deps.remembered.get(account)
    let seen: Observation | undefined

    try {
      seen = await deps.observe(account)
      stats.fetched++
      observed.push({ account, ...seen })
    } catch (error) {
      /*
       * Mirror Node could not answer — so ASK THE TOPIC.
       *
       * This is the line the whole change exists for. A fact observed once is
       * on the topic forever, so an outage now costs a cheaper answer rather
       * than a wrong one.
       */
      if (recall?.funder) {
        stats.remembered++
        note(
          `    remembered  ${account} funded by ${recall.funder} ` +
            `(published seq ${recall.funderSeq ?? '?'}) — Mirror unavailable, topic answered`,
        )
      } else {
        /*
         * THE RESIDUAL FAIL-OPEN — smaller, but not gone.
         *
         * An account never successfully observed, during an outage, is still
         * treated as having no ancestry, which weights it independent.
         * Publishing facts closes the "saw it once, then Mirror flaked" case,
         * which is the case that actually bit us. It cannot close "never saw it
         * at all", because there is nothing to remember.
         *
         * Closing that needs a POLICY change — discount an unverifiable
         * counterparty rather than trust it — and a policy change moves
         * ceilings, so it needs a new frozen parameter set rather than an edit
         * here. Named in HANDOFF rather than papered over.
         */
        stats.unknown++
        note(
          `    WARNING  ancestry for ${account} unavailable ` +
            `(${error instanceof Error ? error.message : String(error)}) and never published — ` +
            `treated as independent (FAILS OPEN)`,
        )
      }
    }

    /*
     * The remembered value wins even on a SUCCESSFUL fetch that found none.
     *
     * A pass during a partial outage can get a 200 from the accounts endpoint
     * and nothing from the transactions index — success, with no funder. Taking
     * that at face value would drop an edge the topic already holds, which is
     * the erase-on-outage bug wearing a different hat. Same monotonic rule as
     * the reader: once known, never unknown.
     */
    const funder = seen?.funder ?? recall?.funder
    const createdAt = seen?.createdAt ?? recall?.createdAt

    facts.set(account, { id: account, ...(funder ? { fundedBy: [funder] } : {}) })
    if (createdAt) birthdays.set(account, createdAt)
    if (!funder) unverified.add(account)

    if (funder) await walk(funder, hopsLeft - 1)
  }

  for (const root of roots) await walk(root, deps.hops)

  return { facts, birthdays, observed, unverified, stats }
}
