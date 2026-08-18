# ADR-0005 — Supabase and Upstash; no Docker, no self-hosting

**Status:** Accepted · **Date:** 2026-08-18

## Context

Tab needs Postgres for the counterparty graph and read models, and Redis for the fast-path
snapshot, hold reservations and BullMQ queues. Everything else it depends on — consensus,
transaction history, token transfers — is Hedera testnet and the public Mirror Node.

The default reflex is a `docker-compose.yml`. On this project that reflex costs more than it
returns: at least one developer is on WSL2 without Docker Desktop integration, and a compose
file has to be maintained, debugged on three machines, and kept in sync with whatever we deploy
to anyway.

## Decision

Managed services. **Supabase** for Postgres, **Upstash** for Redis. No compose file, no local
daemons, no local Hedera node. Configuration is two connection strings in `.env`.

## Consequences

**What we gain.** Onboarding is two dashboard signups and four env values. Every developer and
CI run points at the same kind of infrastructure we deploy against, so "works on my machine"
stops being a category. Supabase's dashboard doubles as a way to inspect the counterparty graph
live during the demo, which is genuinely useful when explaining why a spend was refused.

**What it costs, and how we handle it.**

- **Network latency lands in the hot path.** The fast path is budgeted under 50ms and a
  cross-region Redis round trip can consume most of it. Mitigation: create the Upstash database
  in the gateway's region, and keep a short-TTL in-process LRU in front of Redis so the common
  case never leaves the process. Redis is shared state and the fallback read, not the first read.
  This is a real constraint that a local Redis would have hidden until deploy.
- **BullMQ needs `maxRetriesPerRequest: null`** against Upstash, or long-lived blocking
  connections drop and the workers appear to have silently stopped. Set once in `@tab/cache`.
- **Free-tier command limits.** 10k commands/day is ample for the demo but not for a load test.
  If we load-test, expect to pay for a day.
- **Migrations need Supabase's direct connection** (port 5432), not the transaction pooler
  (6543), which does not handle prepared statements or DDL reliably.

**No local Hedera node, deliberately.** `@hashgraph/hedera-local` exists, but Probe 4 exists
specifically to characterise Mirror Node lag and pagination under our own volume. A local
network does not reproduce either, so testing against it would build confidence in the wrong
thing.
