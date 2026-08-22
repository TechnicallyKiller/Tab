# @tab/mirror

**Tier 2 · adapter · background use only · never in the fast path**

Typed client for the Hedera Mirror Node REST API: account info, transfer history, token
relationships, and HCS topic replay.

**No credentials required.** Mirror Node is a public read-only API, which is why this was the first
on-chain package built and why `pnpm --filter @tab/mirror test:live` runs against real testnet in CI.

## Why this is separate from @tab/hedera

So the ban can be mechanical. `boundaries.json` forbids `@tab/fastpath` from depending on this
package: one history call inside a path budgeted under 50ms spends the whole budget, and the README
calls that a hard rule rather than a target. Two packages means one can be granted and the other
refused.

## Contents

| File | Holds |
|---|---|
| `src/client.ts` | base client, retry, and the pagination walk |
| `src/accounts.ts` | account age, token relationships, the association check, USDC balance |
| `src/transfers.ts` | transaction history → directed graph edges |
| `src/topics.ts` | HCS replay and chunk reassembly |
| `src/types.ts` | response shapes, transcribed from live responses rather than docs |
| `src/live-check.ts` | 7 checks against real testnet — this is Probe 4 |

## What the API actually does

Every one of these was measured, not read:

- **Empty pages appear in the MIDDLE of a real result set.** Measured 7 of 8 pages empty with one
  page of data, `links.next` non-null throughout. **Stop only when `links.next` is null**, never on
  an empty page — stopping early silently truncates history, and truncated history is a wrong
  counterparty graph, which is a wrong credit decision.
- **100 rows per page maximum.** Pagination from the first line of code, not after something
  silently caps at 100.
- **Failed transactions are returned.** Filter `result === 'SUCCESS'`. A reverted transfer never
  moved value and would be a phantom edge in the graph.
- **HCS messages above ~1KB are chunked**, each chunk with its own sequence number and
  `chunk_info: {number, total}`. Parsing a lone chunk yields truncated JSON. Everything goes through
  `reassembleChunks()`, which drops and reports incomplete groups rather than parsing them.
- **`created_timestamp` gives exact account age** — a direct Sybil input, strictly better than
  inferring from a first operation.
- **Mirror Node is the reliable source for token association and balance.** Consensus-node token
  queries no longer return this dependably; `@x402/hedera`'s own preflight uses Mirror Node for the
  same reason.
- **Lag behind consensus is a few seconds.** Expected, not an error. The projection is eventually
  consistent by design and the fast path reads a cache snapshot, never this.

## Invariants

- **`@tab/fastpath` may never depend on this.** Enforced by `boundaries.json`.
- **Pagination is exhausted, or truncation is reported.** `PageWalk.truncated` and `resumeFrom` exist
  so a bounded walk is visible rather than silent.
- **Replay is ordered by consensus timestamp**, compared as bigints — a float comparison loses
  nanosecond precision, and consensus order is the one ordering a stranger can reproduce.
- **Retries only on 429 and 5xx.** A 4xx will not fix itself.

```bash
pnpm --filter @tab/mirror test:live    # 7 checks against real Hedera testnet
```

## Still to do

- `getTransactions` walks from the beginning when no `from` is given. The indexer must pass a
  cursor; there is no default time bound yet.
- No unit tests with recorded fixtures — the live check covers behaviour but needs the network.
- Rate limiting is retry-only; no token bucket. Fine at demo volume, not for a backfill.
