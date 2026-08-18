# @tab/mirror

**Tier 2 · adapter · background use only · never in the fast path**

Typed client for the Hedera Mirror Node REST API: account info, transfer history, token
balances, and topic message replay.

## Why this is separate from @tab/hedera

So that the ban can be mechanical. `@tab/fastpath` needs nothing from either, but the danger is a
future refactor giving it consensus-side access and history access together. Two packages means
`boundaries.json` can grant one and refuse the other. The README calls the no-Mirror-Node rule in
the hot path "a hard rule, not a performance target" — this split is what makes that true rather
than aspirational.

One accidental history call in the hot path and the 50ms budget is gone.

## Contents

| File | Holds |
|---|---|
| `src/client.ts` | base client, retry, and **explicit timestamp-range pagination** |
| `src/accounts.ts` | account info including `created_timestamp` |
| `src/transfers.ts` | token transfer history for graph edge construction |
| `src/topics.ts` | HCS topic message replay — what `tools/verify` uses |
| `src/urls.ts` | network → base URL, imported from `@x402/hedera`'s constants |

## What the API actually does, from Probe 4

- **100 rows per page.** Plan for pagination from the first line of code, not after it silently
  truncates a result at 100 edges and the graph quietly gets a wrong answer.
- **Explicit timestamp ranges.** Walk history in bounded chunks (the README suggests 60-day
  windows) rather than requesting open-ended history.
- **Lags finality by a few seconds.** This is fine — the projection is eventually consistent by
  design and the fast path reads a cache snapshot, never this. Do not add a retry loop that waits
  for a transfer to appear inside a request.
- **`created_timestamp` on the accounts endpoint gives exact account age.** This is a real
  advantage over a first-operation heuristic, and account age is a direct input to Sybil scoring.
- **Mirror Node is the reliable source for token-association and balance data.** Consensus-node
  token queries no longer return it dependably — `@x402/hedera`'s own preflight implementation
  notes this and uses Mirror Node for the same reason.

## Invariants

- **`@tab/fastpath` may never depend on this.** Enforced by `boundaries.json`.
- **Mirror Node lag is never treated as an error.** A transfer that has not appeared yet is
  expected. Retrying inside a request converts lag into latency.
- **Pagination is exhausted or explicitly bounded and logged.** A silently truncated page is a
  wrong graph, and a wrong graph is a wrong credit decision.
- **When Mirror Node is down or lagging, the ceiling holds at its last computed value.** Slow
  path only. The fast path is unaffected because it reads the cache. This row is in the README's
  failure matrix and must actually behave that way.
