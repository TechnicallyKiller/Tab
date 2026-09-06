import { micro, type MicroUsdc } from '@tab/money'
import { fundedWithin } from './ancestry.ts'
import type { AccountFacts, AccountId, TransferEdge, WeightReason } from './types.ts'

/**
 * Control-cluster detection, in BOTH directions.
 *
 * A lender asks one question: is this payer independent of the borrower? Tab
 * asks it twice — of the payer on the earn leg, and of the SELLER on the spend
 * leg. Same graph, same arithmetic, applied to a different account.
 *
 * The spend-leg direction is the one that catches the loop attacker, and it is
 * the one almost nobody implements, because it only matters if credit is
 * extended against revenue. An agent that funds a seller, buys from it, and
 * books the seller's income as proof of its own creditworthiness has built a
 * circle out of the lender's own float. Checking the payer alone never sees it:
 * every individual payment is real, signed and settled.
 */

export interface ClusterFinding {
  /** Whether this counterparty is inside the agent's control cluster. */
  clustered: boolean
  /** The rules that fired. Empty when independent. */
  reasons: readonly WeightReason[]
  detail: string
}

export interface ClusterInputs {
  agent: AccountId
  counterparty: AccountId
  /** Every transfer known to involve either account. Direction preserved. */
  edges: readonly TransferEdge[]
  facts: ReadonlyMap<AccountId, AccountFacts>
  /** From `@tab/params`. Never a literal here. */
  maxHops: number
}

/**
 * Is `counterparty` under the agent's control?
 *
 * Two rules are fatal, and both mean the same thing in different evidence: the
 * counterparty is not an independent economic actor.
 */
export function detectCluster(inputs: ClusterInputs): ClusterFinding {
  const { agent, counterparty, edges, facts, maxHops } = inputs
  const reasons: WeightReason[] = []
  const details: string[] = []

  if (agent === counterparty) {
    return {
      clustered: true,
      reasons: ['SOLE_COUNTERPARTY'],
      detail: 'the counterparty IS the agent — self-dealing, not revenue',
    }
  }

  // Rule 1 — the agent funded it. Its money is the agent's money.
  const funded = fundedWithin(agent, counterparty, facts, maxHops)
  if (funded.funded) {
    reasons.push('FUNDED_BY_AGENT')
    details.push(
      `the agent funded ${counterparty} ${funded.hops} hop(s) back, so its revenue is the ` +
        'agent’s own float returning',
    )
  }

  /*
   * Rule 2 — the SAME account funded both sides.
   *
   * Written after discovering that Rule 1 can never fire in Tab's own model. An
   * agent's tab holds no key by design: it receives settlement payouts and
   * signs nothing. A tab that cannot sign cannot fund anybody, so
   * "the agent funded the seller" is unreachable for a Tab agent, and the
   * hard-block rule the design leaned on was dead code.
   *
   * The reachable control shape is one operator standing behind both accounts,
   * which shows up as a shared IMMEDIATE funder. That is much tighter than
   * "shares any root within N hops" — the loose version is what makes shared
   * roots a discount rather than a block, because on a public network an
   * exchange funds thousands of unrelated accounts.
   *
   * The honest limitation: if a public exchange funded both the tab and a
   * genuine customer, this fires wrongly. It is a hard block, so that false
   * positive costs a real agent real revenue. Two things make it defensible
   * HERE and both would need revisiting on a network where tabs are funded from
   * exchanges: a Tab is funded by the gateway's float, not by an exchange, and
   * a counterparty funded by that same float is by construction inside our own
   * control cluster.
   */
  const agentFunder = facts.get(agent)?.fundedBy?.[0]
  const counterpartyFunder = facts.get(counterparty)?.fundedBy?.[0]
  if (agentFunder && counterpartyFunder && agentFunder === counterpartyFunder) {
    reasons.push('COMMON_FUNDER')
    details.push(
      `${agentFunder} funded both the tab and ${counterparty} — one operator on both sides`,
    )
  }

  // Rule 3 — the agent is its only counterparty. It exists to trade with us.
  const others = new Set<AccountId>()
  for (const edge of edges) {
    if (edge.from === counterparty && edge.to !== agent) others.add(edge.to)
    if (edge.to === counterparty && edge.from !== agent) others.add(edge.from)
  }
  const touchesAgent = edges.some(
    (e) =>
      (e.from === counterparty && e.to === agent) || (e.to === counterparty && e.from === agent),
  )
  if (touchesAgent && others.size === 0) {
    reasons.push('SOLE_COUNTERPARTY')
    details.push(
      `${counterparty} has traded with nobody but the agent — it is not an independent market`,
    )
  }

  if (reasons.length > 0) {
    return { clustered: true, reasons, detail: details.join('; ') }
  }

  return {
    clustered: false,
    reasons: [],
    detail: `${counterparty} has ${others.size} other counterparty(ies) and no funding link to the agent`,
  }
}

export interface ReciprocityFinding {
  /** Value the counterparty sent toward the agent. */
  backflow: MicroUsdc
  /** Value the agent sent to the counterparty. */
  outflow: MicroUsdc
  /** Backflow as a share of outflow, basis points. */
  ratioBp: number
  reciprocal: boolean
}

/**
 * How much of what the agent paid comes back?
 *
 * Not a cluster on its own — a genuine two-way trading relationship exists and
 * is not fraud. It is a DISCOUNT signal, because revenue that is partly the
 * agent's own money returning is worth less as evidence of independent demand
 * than revenue that is not.
 *
 * Integer basis points throughout: a ratio computed as a float and compared to
 * a threshold is the exact defect `guard:money` exists to catch.
 */
export function reciprocity(
  agent: AccountId,
  counterparty: AccountId,
  edges: readonly TransferEdge[],
  thresholdBp: number,
): ReciprocityFinding {
  let outflow = 0n
  let backflow = 0n
  for (const edge of edges) {
    if (edge.from === agent && edge.to === counterparty) outflow += edge.amount
    if (edge.from === counterparty && edge.to === agent) backflow += edge.amount
  }

  // No outflow means no circularity to measure — money arriving from an account
  // the agent has never paid is exactly what independent revenue looks like.
  const ratioBp = outflow === 0n ? 0 : Number((backflow * 10_000n) / outflow)

  return {
    backflow: micro(backflow),
    outflow: micro(outflow),
    ratioBp,
    reciprocal: outflow > 0n && ratioBp >= thresholdBp,
  }
}
