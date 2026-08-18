# Architecture

The product argument is in [README-TAB.md](../README-TAB.md). This document is how the code is
arranged to support it, and which claims are load-bearing.

## One sentence

A gateway sits in front of the agent on both legs of its economic life; a background engine
underwrites a ceiling from attested revenue and a counterparty graph; a settlement worker nets the
window into one transfer; and HCS is the ledger, so a stranger can check the books.

## The shape

```
                         ┌──────────────────────────────────────┐
   agent ───spend───────▶│  apps/gateway            (<50ms)     │
   (no key, no USDC)     │  ├─ x402 client   → pays sellers      │──▶ unmodified
                         │  ├─ x402 server   ← agent's endpoint  │◀── x402 sellers
   payers ───pay────────▶│  ├─ x402 facilitator (earn leg)       │
                         │  └─ @tab/fastpath — cache ONLY        │
                         └────────┬──────────────────┬───────────┘
                    reads snapshot│                  │receipts
                                  │                  ▼
                    ┌─────────────┴───────┐    ┌──────────────────────┐
                    │  Redis (Upstash)    │    │  HCS  ── THE LEDGER  │
                    │  snapshot · holds   │    │  receipts · ceilings │
                    │  counters · breaker │    │  settlements         │
                    └─────────▲───────────┘    └──────┬───────────────┘
                       writes │                       │
                    ┌─────────┴───────────┐           │
                    │  apps/engine        │◀──────────┘
                    │  slow path          │
                    │  index→graph→score  │◀── Mirror Node (history)
                    └─────────┬───────────┘
                              │                ┌──────────────────────┐
                    Postgres (Supabase)        │  apps/settlement     │
                    graph · read models        │  window tick         │
                    a rebuildable projection   │  HIP-423 schedule    │
                                               │  reconciler          │
                                               └──────────────────────┘
```

## The four structural rules

Everything else follows from these. Each is enforced, not merely documented — see
[PACKAGE_MAP.md](PACKAGE_MAP.md) and [`boundaries.json`](../boundaries.json).

**1. Two paths at deliberately different speeds.** The fast path decides in under 50ms from a cache
snapshot and never computes a ceiling. The slow path computes ceilings in the background. They meet
at the Redis snapshot, in one direction only. `@tab/fastpath` cannot declare a dependency on
`mirror`, `db`, `hedera`, `graph` or `scoring`, so the ban is mechanical.

**2. Shrink now, grow later.** The engine may collapse a ceiling mid-window instantly and may never
raise one mid-window. Shrinking is a safety action; growing is a trust action and waits for a clean
settlement. This is the mechanism behind the demo's central moment.

**3. Fail closed, always.** Redis down, snapshot stale, breaker on, facilitator unreachable →
refuse. A refused spend costs the agent a job; an allowed spend past a ceiling costs the house real
money. There must be no code path that turns an error into an allow.

**4. HCS is the ledger; Postgres is a projection.** Every fact money depends on is derived from an
HCS message, and the database must be safe to drop and rebuild. This is what makes
`verify-tab` and `verify-ceiling` honest, and those two commands are the entire substance of the
no-contract argument. See [ADR-0007](adr/0007-hcs-as-source-of-truth.md).

## Where state lives

| State | Lives in | Verifiable by |
|---|---|---|
| Float | two account balances | Mirror Node, anyone |
| Every debit and credit | HCS receipt topic | replay the topic, anyone |
| Current ceiling + all inputs | HCS ceiling topic | recompute and check the hash, anyone |
| Net position | sum of the receipt topic | replay, anyone |
| Settlement history | HCS settlement topic + transfers | both, anyone |
| Counterparty graph | Postgres | rebuildable from Mirror Node |
| Available balance, holds | Redis | ephemeral by design |

## Why there is no smart contract

The agent holds nothing, so there is no unauthorised spend for a contract to prevent. A contract
here would be *recording*, not *enforcing* — and HCS records better: consensus-ordered, replayable
by anyone, no bytecode, no reentrancy surface, no upgrade key.

The enforcement is at the gateway because **the money is at the gateway**. Pretending otherwise with
a contract would be theatre.

The part that makes this an argument rather than an excuse is `tools/verify`. A contract would assert
the float invariant in a test only we run. `verify-tab` lets a stranger assert it themselves — which
is why that package is barred from importing our database, and why `@tab/scoring` and `@tab/graph`
are pure packages it can import directly.

## Correctness: the write-ahead order

**`reserve → pay → commit`.** Fixed, not convenient.

1. **Reserve** — the fast path issues a `hold_id` and available drops *immediately*. This is what
   defeats racing many spends before the ceiling updates. Holds expire after 60s.
2. **Pay** — `hold_id` is the idempotency key, so a retry never double-pays.
3. **Commit** — the hold becomes a debit and the receipt goes to HCS.

A crash between 2 and 3 leaves a transfer with no receipt. The reconciler diffs Mirror Node outbound
transfers against the receipt topic at every window close and writes a repair receipt. That diff is
the demo's proof of reconciliation and runs on camera.

## What research changed

Six findings from verifying dependencies against the live registry, in
[RESEARCH.md](RESEARCH.md). The three that changed the architecture:

- **The float is two accounts, not one.** The x402 exact scheme needs a signature per request from
  the paying account, so a threshold KeyList cannot sit in a 50ms path. Cold Treasury (KeyList) +
  Hot Float (single key, capped). [ADR-0003](adr/0003-two-account-float.md)
- **We self-facilitate the earn leg.** The facilitator class is exported, so this is configuration
  rather than a project. Removes a liveness dependency; makes us the fee payer when we earn.
  [ADR-0004](adr/0004-self-hosted-facilitator.md)
- **Agent Kit enforcement is a policy, not a hook.** Hooks return `void` and cannot block. The
  outer layer is `TabCeilingPolicy extends AbstractPolicy`.
  [ADR-0008](adr/0008-agentkit-policy-not-hook.md)

## Reading order for a new contributor

1. [README-TAB.md](../README-TAB.md) — what and why
2. [RESEARCH.md](RESEARCH.md) — what the dependencies actually do
3. This file
4. [PACKAGE_MAP.md](PACKAGE_MAP.md) + [`boundaries.json`](../boundaries.json) — the rules
5. [adr/](adr/) — the decisions, in order
6. The README of whichever package you own
