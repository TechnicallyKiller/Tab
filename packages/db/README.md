# @tab/db

**Tier 2 · adapter · Drizzle + Supabase Postgres · a rebuildable projection**

Schema and migrations for the counterparty graph and the dashboard read models.

## This is not the ledger

**HCS is the source of truth.** This database is a cache of computation over HCS plus Mirror
Node, and it must be safe to drop and rebuild from scratch with zero loss of authoritative state.

The failure mode is gradual, which is what makes it dangerous: a column that exists only here,
then a balance read from here because it was convenient, and eventually a ledger whose truth is a
database only we can read — which forfeits the entire argument for having no smart contract.

**The review question for every migration:** does money depend on this column? If yes, it needs a
corresponding HCS message. No exceptions, including "just for now."

See [ADR-0007](../../docs/adr/0007-hcs-as-source-of-truth.md).

## Contents

| File | Holds |
|---|---|
| `src/schema/graph.ts` | accounts, funding edges, transfer edges, computed clusters |
| `src/schema/receipts.ts` | receipt projection, keyed by `(topic, consensus_timestamp)` |
| `src/schema/agents.ts` | registrations, starter-tab issuance, seller allowlists |
| `src/schema/readmodels.ts` | dashboard views: tab state, refusals, settlements |
| `src/schema/cursors.ts` | indexer position per source |
| `src/rebuild.ts` | full rebuild from HCS + Mirror Node |
| `drizzle/` | generated migrations. Committed |

## Invariants

- **Every projection write is idempotent on `(topic, consensus_timestamp)`.** A replay must be
  safe, because a replay will happen — after a crash, after a schema change, and on purpose in CI.
- **Order by HCS consensus timestamp, never by our own sequence numbers.** Consensus gives a
  total order for free; the README makes this claim and it should be literally what the code does.
- **`rebuild.ts` exists from day one and runs in CI against a seeded topic.** A rebuild first
  attempted in week three does not work. This is the check that keeps ADR-0007 honest.
- **Migrations use Supabase's direct connection on port 5432**, not the transaction pooler on
  6543 — the pooler does not handle prepared statements or DDL reliably.
- **`apps/web` does not import this package.** It reads through `@tab/sdk`. A browser
  bundle must not be able to reach a database driver.
- **`tools/verify` does not import this package.** Barred in `boundaries.json`, because a
  stranger recomputing a ceiling has no Postgres.
