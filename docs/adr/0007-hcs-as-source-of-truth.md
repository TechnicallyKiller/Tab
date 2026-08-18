# ADR-0007 — HCS is the ledger; Postgres is a rebuildable projection

**Status:** Accepted · **Date:** 2026-08-18

## Context

The README states that HCS is the source of truth and Postgres holds "the counterparty graph,
read models". That is the right split, but stating it is not the same as enforcing it, and the
failure mode is gradual: a column that exists only in Postgres, then a balance read from
Postgres because it was convenient, and eventually a ledger whose truth is a database we alone
can read — which forfeits the entire "verifiable by a stranger" argument that justifies having
no smart contract.

## Decision

**Every fact that money depends on is derived from an HCS message.** Postgres is a cache of
computation over HCS plus Mirror Node, and it must be safe to `DROP` and rebuild from scratch
with no loss of authoritative state.

Concretely:

- The receipt, ceiling and settlement topics carry the authoritative record.
- Postgres holds only: the counterparty graph projection, read models for the dashboard,
  indexer cursors, and operational data that money does not depend on (registrations, seller
  allowlists — each of which is itself announced to HCS).
- A rebuild command must exist from day one and run in CI on a seeded topic. If rebuilding is
  only attempted for the first time in week three, it will not work.
- Any new Postgres column that money reads requires a corresponding HCS message. This is the
  review question for every schema migration.

## Consequences

**What we gain.** `verify-tab` and `verify-ceiling` can be honest — `tools/verify` is barred by
`boundaries.json` from importing `@tab/db` at all, so a stranger with the repo and network
access can reproduce our numbers. This is the substantive part of the no-contract argument:
without it, "HCS records better than a contract" is a slogan.

**What it costs.** Ordering and idempotency become the indexer's problem. HCS consensus
timestamps give a total order, so use them as the ordering key rather than our own sequence
numbers, and make every projection write idempotent on `(topic, consensus_timestamp)` so a
replay is safe. Mirror Node lags finality by a few seconds, so the projection is eventually
consistent by design — which is fine, because the fast path reads a cache snapshot and never
the projection.

**The rule that keeps this true.** If a value is needed to decide whether money moves, it must
be reconstructible from HCS. No exceptions, including "just for now".
