/**
 * Gathering the inputs the pure packages need.
 *
 * `@tab/graph` and `@tab/scoring` cannot fetch — `boundaries.json` bars them
 * from `mirror`, `db` and `hedera` — because `verify-ceiling` must reproduce a
 * decision from public data alone. That makes this file the seam: everything a
 * ceiling depends on is fetched HERE, from sources a stranger also has, and
 * handed over as plain data.
 *
 * The rule that keeps it honest: if a number is not in `CeilingInputs`, it may
 * not reach the formula. So this module's job is to produce exactly those
 * numbers and nothing that quietly influences them on the side.
 */
import {
  getAccount, getTransactionAt, getTransactions, toTransferEdges, type MirrorClient,
} from '@tab/mirror'
import { micro, usdc, type MicroUsdc } from '@tab/money'
import { params, windowConsensusRange, windowOf } from '@tab/params'
import type { AccountFacts, AccountId, TransferEdge as GraphEdge } from '@tab/graph'
import type { Entry } from '@tab/ledger'
import type { WindowRevenue } from '@tab/scoring'

export interface GatheredInputs {
  /** Every token transfer touching the accounts of interest, direction kept. */
  edges: readonly GraphEdge[]
  /** Creation times and funding ancestry, for the age and cluster rules. */
  facts: ReadonlyMap<AccountId, AccountFacts>
  /** Attested vs unattested revenue per window, from the receipt topic. */
  history: readonly WindowRevenue[]
  /** Distinct counterparties that contributed ATTESTED revenue. */
  attestedCounterparties: ReadonlySet<AccountId>
  /** Revenue per counterparty across the trailing span, for concentration. */
  revenueByCounterparty: ReadonlyMap<AccountId, MicroUsdc>
}

/**
 * Revenue per window, from receipts rather than from chain transfers.
 *
 * Attestation is the whole distinction: a credit receipt means the gateway
 * served a request and recorded it at the time. The chain shows money arriving
 * and cannot tell a purchase from a top-up. So the receipt topic is the source
 * for the attested/unattested split, and Mirror Node is the source for the
 * graph — two different questions, two different sources, deliberately.
 */
export function revenueFromEntries(
  entries: readonly Entry[],
  windowCount: number,
  currentWindow: number,
): {
  history: WindowRevenue[]
  attestedCounterparties: Set<AccountId>
  revenueByCounterparty: Map<AccountId, MicroUsdc>
} {
  const byWindow = new Map<number, { attested: bigint; unattested: bigint }>()
  const attestedCounterparties = new Set<AccountId>()
  const revenueByCounterparty = new Map<AccountId, MicroUsdc>()

  // Only CLOSED windows, and only the trailing span. The window still open is
  // excluded because its receipts are still arriving: including a half-finished
  // window drags the average down and would make every ceiling sag mid-window
  // and recover at the tick, for no underlying reason.
  // INCLUSIVE, and the `<` matters. Written first as `<= oldest`, which made a
  // span of N collect only N−1 windows while `effectiveRevenue` still divided
  // by N — so the oldest window's revenue was silently dropped and every
  // agent's run-rate was understated by a fixed fraction. A span of 1 collected
  // nothing at all, which is how it surfaced.
  const oldest = currentWindow - windowCount

  for (const entry of entries) {
    if (entry.kind !== 'credit') continue
    if (entry.window >= currentWindow || entry.window < oldest) continue

    const bucket = byWindow.get(entry.window) ?? { attested: 0n, unattested: 0n }
    if (entry.attested) {
      bucket.attested += entry.amount
      attestedCounterparties.add(entry.counterparty)
    } else {
      bucket.unattested += entry.amount
    }
    byWindow.set(entry.window, bucket)

    revenueByCounterparty.set(
      entry.counterparty,
      micro((revenueByCounterparty.get(entry.counterparty) ?? 0n) + entry.amount),
    )
  }

  const history = [...byWindow.entries()]
    .map(([window, v]) => ({
      window,
      attested: micro(v.attested),
      unattested: micro(v.unattested),
    }))
    .sort((a, b) => a.window - b.window)

  return { history, attestedCounterparties, revenueByCounterparty }
}

/**
 * Who created this account.
 *
 * Derived from the account's CREATING transaction, found by a point lookup on
 * its `created_timestamp`. The transaction id's payer is the creator.
 *
 * ## Why not "the earliest inbound transfer"
 *
 * That was the first implementation and it failed live, twice over.
 *
 * It scanned `/transactions?account.id=X&transactiontype=CRYPTOTRANSFER`, and
 * for a newly created account that index is not merely lagging — it is
 * INTERMITTENT. Against a real attacker account it returned 5 transactions
 * once and 0 both before and after, minutes apart, while
 * `/accounts/{id}/tokens` correctly showed the funded balance the whole time.
 * The loop attacker therefore ran end to end and was NOT caught: the engine
 * fails open, so an account with no discoverable ancestry is weighted as
 * independent.
 *
 * It was also less correct even when it worked. "Earliest inbound transfer"
 * answers a different question from "who created this" — an account can be
 * created by one party and first paid by another.
 *
 * The point lookup fixes both: `created_timestamp` comes from
 * `/accounts/{id}`, which was reliable throughout, and one exact-timestamp
 * query returns the CRYPTOCREATEACCOUNT itself.
 *
 * ## What it still does not fix
 *
 * Two requests per counterparty per pass, and a fresh lookup every time. The
 * real answer is to record the edge WHEN IT IS OBSERVED and never forget it —
 * which is what `@tab/db` is for, and this is the concrete justification for
 * it: a security rule that fails open must not depend on re-deriving its
 * inputs from an eventually-consistent index.
 */
export async function funderOf(
  mirror: MirrorClient,
  account: AccountId,
): Promise<AccountId | undefined> {
  const info = await getAccount(mirror, account)
  const created = info.created_timestamp
  if (!created) return undefined

  const creating = await getTransactionAt(mirror, created)
  if (!creating) return undefined

  /*
   * The payer is the id's own account prefix: `0.0.8812188-1788698157-659492670`.
   *
   * Read from the id rather than from the transfer list on purpose. The
   * transfer list also contains fee collectors (`0.0.98`, `0.0.802`) with
   * POSITIVE amounts and the payer with a negative one, so "the most negative
   * entry" would work until a transaction where it does not — while the id's
   * prefix is the payer by definition.
   */
  const payer = creating.transaction_id?.split('-')[0]
  return payer && payer !== account ? payer : undefined
}

/**
 * Whether an account is younger than the age threshold.
 *
 * Uses `created_timestamp` from the accounts endpoint — the exact creation
 * time. The tempting alternative, "timestamp of its first operation", is wrong
 * in the direction that matters: an attacker's freshly minted seller looks
 * older than it is the moment someone funds it, and that is precisely the
 * account the age discount exists to catch.
 *
 * Returns `undefined` when Mirror Node has no creation time rather than
 * guessing. An unknown age must not be silently treated as "old enough".
 */
export async function isYoung(
  mirror: MirrorClient,
  account: AccountId,
  nowSeconds: number,
  ageFullDays = params.ageFullDays,
): Promise<boolean | undefined> {
  const info = await getAccount(mirror, account)
  const created = info.created_timestamp
  if (!created) return undefined
  const createdSeconds = Number(created.split('.')[0])
  if (!Number.isFinite(createdSeconds)) return undefined
  const ageDays = (nowSeconds - createdSeconds) / 86_400
  return ageDays < ageFullDays
}

/**
 * Token transfer edges touching an account, over a bounded window span.
 *
 * Bounded for the same reason the reconciler is: an unbounded walk of a busy
 * account's history takes 5-15s per page from here and gets slower forever.
 * Mirror Node lag is normal and is not an error — when a page is missing, the
 * caller holds the last computed ceiling rather than retry-looping.
 */
export async function edgesFor(
  mirror: MirrorClient,
  accounts: readonly AccountId[],
  tokenId: string,
  fromWindow: number,
  windowSeconds: number,
): Promise<GraphEdge[]> {
  const range = windowConsensusRange(fromWindow, windowSeconds)
  const seen = new Set<string>()
  const edges: GraphEdge[] = []

  for (const account of accounts) {
    const walk = await getTransactions(mirror, {
      accountId: account,
      from: range.from,
      pageSize: 100,
    })
    for (const edge of toTransferEdges(walk.items, tokenId)) {
      // Two accounts of interest on one transfer yields the same edge twice.
      // Deduped on the transaction id plus both ends, so a genuine repeat
      // payment of the same amount is still counted twice — it happened twice.
      const key = `${edge.transactionId}:${edge.from}:${edge.to}:${edge.amount}`
      if (seen.has(key)) continue
      seen.add(key)
      /*
       * Mapped field by field, NOT spread.
       *
       * `@tab/mirror` and `@tab/graph` both export a type called
       * `TransferEdge` and they are NOT the same shape — mirror carries
       * `consensusTimestamp`, graph wants `at`. A spread compiles happily and
       * hands the graph an edge with an undefined timestamp, which nothing
       * downstream notices because the graph rules that use time are the ones
       * that fail open.
       */
      edges.push({
        from: edge.from,
        to: edge.to,
        amount: edge.amount,
        at: edge.consensusTimestamp,
      })
    }
  }
  return edges
}

/** The window a consensus timestamp falls in. */
export function windowAt(consensus: string, windowSeconds: number): number {
  return windowOf(Number(consensus.split('.')[0]), windowSeconds)
}

export { usdc }
