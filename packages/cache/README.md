# @tab/cache

**Tier 2 · adapter · Redis · fails closed**

The fast path's entire data source: ceiling snapshots, hold reservations, per-window spend
counters, and the global circuit breaker.

## Fail closed. Always.

If Redis is unreachable, **every spend is refused.** Never allow on a cache miss, never fall
back to a database read, never serve a stale value past its TTL.

The asymmetry the README states is the whole reason: a refused spend costs the agent a job; an
allowed spend past a ceiling costs the house real money. When those are the two options, refuse.

This is not a `try/catch` that logs and continues. Make it structural: the read returns
`Result<Snapshot, CacheUnavailable>` and the fast path's only handling of the error case is to
refuse. There should be no code path where an exception here becomes an allow.

## Contents

| File | Holds |
|---|---|
| `src/connection.ts` | ioredis setup. **`maxRetriesPerRequest: null`** — see below |
| `src/snapshot.ts` | ceiling snapshot read and write. Written by the engine, read by the fast path |
| `src/holds.ts` | hold reservation with a 60s TTL, atomic decrement of available |
| `src/counters.ts` | per-window spend totals, and per-seller totals for the concentration check |
| `src/breaker.ts` | global circuit breaker |
| `src/lru.ts` | short-TTL in-process cache in front of Redis |

## Two operational details that will cost a day if missed

**`maxRetriesPerRequest: null`.** Required against Upstash, or long-lived blocking connections
drop and the BullMQ workers appear to have silently stopped — no error, no throughput. Set it
once here, not per queue.

**The in-process LRU is not an optimisation.** The fast path is budgeted under 50ms end to end,
and a cross-region round trip to managed Redis can consume most of that alone. Redis is shared
state and the fallback read; a short-TTL in-process LRU is the first read. Create the Upstash
database in the gateway's region as well. See [ADR-0005](../../docs/adr/0005-managed-infrastructure.md).

The LRU TTL must be short enough that a mid-window ceiling **shrink** takes effect fast — a
shrink is a safety action and must not wait out a cache. Growth waits for a clean settlement
anyway, so staleness in that direction is harmless. This asymmetry decides the TTL.

## Invariants

- **Hold reservation is atomic.** Check-available and decrement in one Lua script or one
  transaction. Two concurrent spends must not both see the same available balance — that race is
  the attack the README lists as "racing many spends before the ceiling updates", and it is
  listed as *caught*.
- **Holds expire on their own** via TTL, so a crashed gateway cannot strand available balance.
  Expiry releasing the wrong amount is a silent accounting error.
- **The snapshot is written only by `apps/engine` and read only by `apps/gateway`.** One writer.
- **Every snapshot carries `MODEL_VERSION` and a computed-at timestamp**, so the fast path can
  refuse on a snapshot that is too old rather than trusting it indefinitely.
