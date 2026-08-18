# Environment Setup

Two managed services, one Hedera testnet account, no Docker.

## Prerequisites

- **Node 22+** (`.nvmrc` pins 22; Node 24 works)
- **pnpm 11+**
- A **Hedera testnet account** from [portal.hedera.com](https://portal.hedera.com) — free, gives an
  account id and HBAR
- A **Supabase** project (Postgres)
- An **Upstash** Redis database

No Docker, no local Postgres, no local Redis, no local Hedera node.
See [ADR-0005](adr/0005-managed-infrastructure.md) and [infra/](../infra/).

## Order of operations

```bash
pnpm install
cp .env.example .env        # fill in the six values below
pnpm probe                  # Phase 0 — must be green before anything else
pnpm db:migrate             # Supabase schema
pnpm bootstrap              # creates topics + accounts, prints ids to paste back
pnpm dev                    # gateway + engine + settlement + dashboard
```

`pnpm probe` runs first, by design. It answers four questions that could invalidate the plan, and
each has a pre-decided fallback. See [probes.md](probes.md).

## What you fill in by hand

| Variable | From |
|---|---|
| `HEDERA_OPERATOR_ID` / `HEDERA_OPERATOR_KEY` | Hedera Portal |
| `DATABASE_URL` | Supabase → **direct connection, port 5432** (not the pooler on 6543) |
| `REDIS_URL` | Upstash → the `rediss://` URL |
| `TREASURY_ACCOUNT_ID` / `HOT_FLOAT_ACCOUNT_ID` + keys | printed by `pnpm bootstrap` |
| `TOPIC_RECEIPTS` / `TOPIC_CEILINGS` / `TOPIC_SETTLEMENTS` | printed by `pnpm bootstrap` |

## What you do NOT put in `.env`

These are exported by `@x402/hedera` and must be imported, not configured. A second copy in an env
file is a second source of truth that will eventually disagree:

```
HEDERA_TESTNET_USDC = "0.0.429274"    HEDERA_USDC_DECIMALS = 6
HEDERA_TESTNET_CAIP2 = "hedera:testnet"
HEDERA_TESTNET_MIRROR_NODE_URL        HBAR_ASSET_ID = "0.0.0"
```

The README's `.env.example` lists `USDC_TOKEN_ID` and `MIRROR_NODE_URL`. Drop both.

Credit parameters do not go in `.env` either — they live in `@tab/params` behind a pinned
`MODEL_VERSION`, because `verify-ceiling` must recompute with byte-identical values. The one
exception is the demo-mode window length, which is a documented override that appears in
`tab config`.

## Two settings that cost a day if missed

**Upstash region.** The fast path is budgeted under 50ms and a cross-region Redis round trip can
consume most of it. Create the Upstash database in the same region the gateway runs in, and rely on
the in-process LRU in `@tab/cache` for the common case.

**`maxRetriesPerRequest: null`.** Required for BullMQ against Upstash, or long-lived blocking
connections drop and the workers look like they have silently stopped — no error, no throughput.
Set once in `@tab/cache`.

## Validation

Every app validates its environment at boot with a zod schema and **refuses to start on a missing
value**. A service that starts with a missing topic id and fails on the first write is much harder
to diagnose than one that will not start.
