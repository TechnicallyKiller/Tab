import type { AccountFacts, AccountId } from './types.ts'

/**
 * Funding ancestry.
 *
 * "Who paid to bring this account into existence, and who paid them?" — walked
 * outward a bounded number of hops.
 *
 * The bound is not a performance guard. **Funding graphs contain cycles**: A
 * funds B, B funds C, C funds A is ordinary behaviour for accounts under one
 * operator, and it is exactly the shape an attacker produces. An unbounded
 * traversal here is an infinite loop inside the engine, and a hang during the
 * demo is indistinguishable from a crash. So this terminates two ways — a hop
 * limit and a visited set — and the cycle case is tested explicitly rather
 * than assumed.
 */

export interface AncestryResult {
  /** Every account reachable by following funding edges, excluding the root. */
  ancestors: readonly AccountId[]
  /** Hops at which each was first reached. Nearest wins on a re-encounter. */
  hops: ReadonlyMap<AccountId, number>
  /** True when the hop limit stopped the walk before the graph ran out. */
  truncated: boolean
}

/**
 * Walk funding ancestry breadth-first, up to `maxHops`.
 *
 * Breadth-first rather than depth-first so `hops` records the SHORTEST path to
 * each ancestor. That matters: "funded within 3 hops" is a claim about the
 * closest relationship, and a depth-first walk that happened to arrive the long
 * way round would record a distance that makes a related account look
 * independent.
 *
 * @param root     the account whose ancestry is being traced
 * @param facts    what is known about accounts, keyed by id
 * @param maxHops  from `@tab/params` — never a literal at the call site
 */
export function fundingAncestry(
  root: AccountId,
  facts: ReadonlyMap<AccountId, AccountFacts>,
  maxHops: number,
): AncestryResult {
  if (!Number.isInteger(maxHops) || maxHops < 0) {
    throw new Error(`maxHops must be a non-negative integer, got ${maxHops}`)
  }

  const hops = new Map<AccountId, number>()
  const visited = new Set<AccountId>([root])
  let frontier: AccountId[] = [root]
  let truncated = false

  for (let hop = 1; hop <= maxHops; hop++) {
    const next: AccountId[] = []
    for (const id of frontier) {
      for (const funder of facts.get(id)?.fundedBy ?? []) {
        // The visited set is what makes a cycle terminate. Without it, A→B→A
        // walks forever and the hop limit only bounds the depth of ONE branch.
        if (visited.has(funder)) continue
        visited.add(funder)
        hops.set(funder, hop)
        next.push(funder)
      }
    }
    if (next.length === 0) return { ancestors: [...hops.keys()], hops, truncated: false }
    frontier = next
  }

  // Anything still on the frontier had unexplored funders when we stopped.
  for (const id of frontier) {
    if ((facts.get(id)?.fundedBy ?? []).some((f) => !visited.has(f))) {
      truncated = true
      break
    }
  }

  return { ancestors: [...hops.keys()], hops, truncated }
}

/**
 * Did `funder` fund `target`, within `maxHops`?
 *
 * The hard-block question on the spend leg: an agent buying from a seller it
 * funded is buying from itself, and the "revenue" that justifies its ceiling is
 * its own float going in a circle.
 */
export function fundedWithin(
  funder: AccountId,
  target: AccountId,
  facts: ReadonlyMap<AccountId, AccountFacts>,
  maxHops: number,
): { funded: boolean; hops?: number } {
  if (funder === target) return { funded: false }
  const ancestry = fundingAncestry(target, facts, maxHops)
  const hop = ancestry.hops.get(funder)
  return hop === undefined ? { funded: false } : { funded: true, hops: hop }
}

/**
 * The nearest common funding ancestor of two accounts, if any within `maxHops`.
 *
 * A shared root is weaker evidence than direct funding — two accounts funded by
 * the same exchange are not colluding — so this drives a DISCOUNT rather than a
 * block, and the caller decides using the hop distance.
 */
export function sharedFundingRoot(
  a: AccountId,
  b: AccountId,
  facts: ReadonlyMap<AccountId, AccountFacts>,
  maxHops: number,
): { shared: boolean; root?: AccountId; hops?: number } {
  const ancestryA = fundingAncestry(a, facts, maxHops)
  const ancestryB = fundingAncestry(b, facts, maxHops)

  let best: { root: AccountId; hops: number } | undefined
  for (const [id, hopA] of ancestryA.hops) {
    const hopB = ancestryB.hops.get(id)
    if (hopB === undefined) continue
    // Rank by the longer of the two legs: a root 1 hop from A but 3 from B is a
    // weaker link than one 2 hops from both, and taking the minimum would
    // overstate how close they are.
    const distance = Math.max(hopA, hopB)
    if (!best || distance < best.hops) best = { root: id, hops: distance }
  }

  return best ? { shared: true, root: best.root, hops: best.hops } : { shared: false }
}

/**
 * The FURTHEST funding ancestor within `maxHops` — an account's origin.
 *
 * Used by the registration rule: one Starter Tab per funding root is what makes
 * bulk-minting agents pointless, and that rule needs a single stable answer to
 * "where did this account ultimately come from".
 *
 * Furthest rather than nearest, deliberately. The nearest funder of a minted
 * agent is whatever throwaway account minted it, and an attacker can make a
 * fresh one per agent for free — so keying the rule on the nearest funder would
 * defend against nothing. The furthest reachable ancestor is the account an
 * attacker actually has to spend real value to replace.
 *
 * ## Determinism, because this decides credit
 *
 * Ties are broken by lexicographic account id, and that is not cosmetic. Two
 * ancestors at the same hop distance must yield the same root on every run and
 * for every reader, or the same tab could claim a root in one pass and be denied
 * in the next — and a published ceiling would stop being reproducible.
 *
 * Returns `undefined` when nothing is known, which callers must distinguish
 * from "is its own root": an account with no observed ancestry has NOT been
 * shown to be independent, it has simply not been seen. See
 * `UNVERIFIED_FUNDING`.
 */
export function fundingRoot(
  account: AccountId,
  facts: ReadonlyMap<AccountId, AccountFacts>,
  maxHops: number,
): { root: AccountId; hops: number } | undefined {
  const { hops } = fundingAncestry(account, facts, maxHops)

  let best: { root: AccountId; hops: number } | undefined
  for (const [id, distance] of hops) {
    // See `isSystemAccount`. Without this the root of every account on the
    // network is the treasury.
    if (isSystemAccount(id)) continue
    if (!best || distance > best.hops || (distance === best.hops && id < best.root)) {
      best = { root: id, hops: distance }
    }
  }
  return best
}

/**
 * Hedera reserves entity numbers below 1000 for the network itself.
 *
 * ## Why this exists, and what it prevented
 *
 * `0.0.2` is the treasury. **Every account on Hedera is ultimately funded by
 * it**, so without this exclusion the funding root of every tab on the entire
 * network resolves to `0.0.2` — and the registration rule, which grants one
 * Starter Tab per root, would have let the FIRST tab ever registered deny the
 * starter grant to every other agent on Hedera forever.
 *
 * A live run caught it on the first pass: the engine resolved
 * `0.0.10390398 → 0.0.8812188 → 0.0.2` and claimed `0.0.2`. No unit test would
 * have, because a hand-built fixture has no genesis.
 *
 * Excluding these is not a heuristic. Being funded by the treasury is not
 * evidence of common control — it is what it means to exist on this network,
 * and it says exactly as much about two accounts as sharing a planet does. The
 * furthest NON-system ancestor is the operator: the account someone would have
 * to fund a hundred times over to farm a hundred starter grants, which is
 * precisely what the rule is defending.
 *
 * Not a versioned parameter. This is a fact about the network, like USDC having
 * six decimals — not a policy dial, so it does not belong in `@tab/params` and
 * changing it would not be a model change but a bug fix.
 */
export function isSystemAccount(id: AccountId): boolean {
  const num = Number(id.split('.').at(-1))
  return Number.isFinite(num) && num < 1000
}
