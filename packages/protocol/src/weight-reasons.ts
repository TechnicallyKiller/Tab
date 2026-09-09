/**
 * Independence weight reasons.
 *
 * Here rather than in `@tab/graph` because they are a PUBLISHED interface, the
 * same as `REFUSAL_CODES`: they go on HCS in a weight message, they are
 * rendered in the Counterparties view, and `apps/web` may not import
 * `@tab/graph` — it reads through `@tab/sdk`, and the SDK re-exports protocol.
 *
 * Keeping them in graph forced the console to invent its own vocabulary, and it
 * did: seven names, of which two matched, and **no `COMMON_FUNDER` at all** —
 * the one rule that actually fires on live data. A dashboard rendering reason
 * codes that do not exist in the system is worse than one rendering none.
 */
export const WEIGHT_REASONS = [
  /** Counted in full. A decision, and as auditable as a discount. */
  'INDEPENDENT',
  /**
   * The agent funded this counterparty.
   *
   * Structurally unreachable for a Tab agent — a tab holds no key and can never
   * be a funder — and kept because the rule is correct for any deployment where
   * the tab CAN sign. `COMMON_FUNDER` is what fires here.
   */
  'FUNDED_BY_AGENT',
  /** The same account funded both the tab and this counterparty. Hard block. */
  'COMMON_FUNDER',
  /** The agent is this account's only counterparty. Hard block. */
  'SOLE_COUNTERPARTY',
  /** Value flows back toward the agent — some of this revenue is circular. */
  'RECIPROCAL_FLOW',
  /** Funded from the same root as the agent within the hop limit. Discount. */
  'SHARED_FUNDING_ROOT',
  /** Newer than the age threshold. Discount. */
  'YOUNG_ACCOUNT',
  /** Over the single-counterparty share cap. Discount. */
  'CONCENTRATED',
  /** No gateway receipt — money arrived, no purchase can be proven. */
  'UNATTESTED',
  /**
   * The funding rules could not be EVALUATED against this account.
   *
   * Not "it has no funder" — that is a different and much rarer claim. This
   * means no funder was ever observed for it and none has been published, so
   * `COMMON_FUNDER` and `SHARED_FUNDING_ROOT` could not be asked.
   *
   * Exists because the alternative was silence. An unverifiable counterparty
   * used to be weighted INDEPENDENT — the unsafe direction — and the loop
   * attacker went uncaught on its first full run because of exactly that.
   * Publishing observed facts closed the case where a funder was once seen and
   * Mirror Node later would not answer; this reason covers the case where it
   * was never seen at all, where there is nothing to remember.
   *
   * A DISCOUNT, deliberately not a block. Mirror Node lag is routine, and
   * blocking on it would turn an indexer hiccup into a refusal for every
   * counterparty at once. It is also self-healing: the moment provenance IS
   * observed it is published, and a published fact is never forgotten, so this
   * reason cannot apply to the same account twice.
   */
  'UNVERIFIED_FUNDING',
] as const

export type WeightReason = (typeof WEIGHT_REASONS)[number]

/** Reasons that take a weight to ZERO and refuse a spend, rather than discount it. */
export const BLOCKING_REASONS: readonly WeightReason[] = [
  'FUNDED_BY_AGENT',
  'COMMON_FUNDER',
  'SOLE_COUNTERPARTY',
]

export function isBlocking(reason: WeightReason): boolean {
  return BLOCKING_REASONS.includes(reason)
}

/** Human-readable, for the console and the refusal message. */
export const WEIGHT_REASON_DETAIL: Record<WeightReason, string> = {
  INDEPENDENT: 'no funding relationship, no reciprocal flow, counted in full',
  FUNDED_BY_AGENT: 'the agent funded this account — revenue from it is the agent paying itself',
  COMMON_FUNDER:
    'the same account funded both this counterparty and the agent’s tab — one operator on both ' +
    'sides of the trade, so the revenue is not independent demand',
  SOLE_COUNTERPARTY:
    'the agent is this account’s only counterparty — it exists to trade with the agent',
  RECIPROCAL_FLOW: 'value flows back toward the agent — some of this revenue is circular',
  SHARED_FUNDING_ROOT: 'funded from the same root as the agent within the hop limit',
  YOUNG_ACCOUNT: 'account is newer than the age threshold — not yet independently established',
  CONCENTRATED: 'over the single-counterparty share cap of the agent’s total',
  UNATTESTED: 'no gateway receipt — money arrived, but no purchase can be proven',
  UNVERIFIED_FUNDING:
    'no funding provenance has been observed or published for this account, so the funding rules ' +
    'could not be evaluated against it — discounted rather than trusted',
}
