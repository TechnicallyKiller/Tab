# Infrastructure

**Managed services only. Nothing to self-host, no Docker, no local daemons.**

Tab needs exactly two pieces of stateful infrastructure, and both have a free tier that
covers the hackathon comfortably. Everything else — consensus, history, token transfers —
is Hedera testnet and the public Mirror Node, which we do not run either.

| Need | Service | Why | Free tier |
|---|---|---|---|
| Postgres | **Supabase** | connection string and done; dashboard for inspecting the graph during the demo; branching if we need a throwaway DB | 500MB, plenty |
| Redis | **Upstash** | serverless, TCP-compatible with `ioredis`, no eviction surprises on the free plan | 10k commands/day |

Hedera testnet accounts and HBAR come from the [Hedera Portal](https://portal.hedera.com).

## Setup

Two dashboards, four values into `.env`. There is no step three.

1. **Supabase** — create a project, copy the **direct connection** string (port 5432, not the
   pooler on 6543) into `DATABASE_URL`. Drizzle migrations need a direct connection; the
   transaction pooler does not support prepared statements or DDL reliably.
2. **Upstash** — create a Redis database, copy the `rediss://` URL into `REDIS_URL`.
3. `pnpm db:migrate` to apply the schema.
4. `pnpm bootstrap` to create the HCS topics and fund the hot float.

## Two things to get right

**Region matters for the fast path.** The fast path is budgeted at under 50ms end to end, and a
cross-continent Redis round trip can eat most of that on its own. Create the Upstash database
in the same region as wherever the gateway runs, and keep a short-TTL in-process LRU in front
of Redis so the common case never leaves the process. Redis is the fallback and the source of
shared state, not the first read.

**BullMQ needs `maxRetriesPerRequest: null`.** Upstash will otherwise drop long-lived blocking
connections and the workers will look like they have silently stopped. Set it once in
`@tab/cache` where the connection is constructed, not per queue.

## Deployment target

Not decided in v1 and deliberately left open — the apps are plain Node processes with a
`PORT` and an env schema, so any of Railway, Fly, Render or a single VM works. The only
constraint is the region note above. Record the choice in an ADR when it is made.

## What we are not doing

- **No local Hedera node.** `@hashgraph/hedera-local` exists, but we are on real testnet with
  the real Mirror Node. A local network would not exercise the Mirror Node lag and pagination
  behaviour that Probe 4 exists to characterise, so it would test the wrong thing.
- **No Docker, no compose file.** Two managed connection strings replace it. Time spent on a
  compose file is time not spent on the ceiling engine.
- **No Kubernetes, no Terraform.** Five processes and two managed services.
