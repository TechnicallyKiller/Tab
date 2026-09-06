# Architecture Decision Records

One file per decision that was expensive to make and would be expensive to reverse. Each states
the decision, what forced it, and what it costs — including what we gave up.

An ADR is not documentation of the code. It is the reason the code is shaped the way it is, so
nobody spends a day rediscovering a tradeoff we already made. If you disagree with one, open a
new ADR that supersedes it rather than editing the old one.

| # | Decision | Status |
|---|---|---|
| [0001](0001-monorepo-tiers.md) | pnpm + Turborepo monorepo with machine-checked dependency tiers | Accepted |
| [0002](0002-single-hedera-sdk.md) | One Hedera SDK: `@hiero-ledger/sdk`, `@hashgraph/sdk` banned | Accepted |
| [0003](0003-two-account-float.md) | Two-account float: cold Treasury (KeyList) + hot Float (single key) | Accepted |
| [0004](0004-self-hosted-facilitator.md) | Self-host the x402 facilitator for the earn leg | Accepted |
| [0005](0005-managed-infrastructure.md) | Supabase + Upstash; no Docker, no self-hosting | Accepted |
| [0006](0006-money-as-bigint.md) | All money is `bigint` micro-USDC behind a branded type | Accepted |
| [0007](0007-hcs-as-source-of-truth.md) | HCS is the ledger; Postgres is a rebuildable projection | Accepted |
| [0008](0008-agentkit-policy-not-hook.md) | Outer enforcement is an Agent Kit **policy**, not a hook | Accepted |
| [0009](0009-settlement-schedule-timing.md) | Schedule the settlement transfer at window **close**; the tick is consensus-executed, not keeper-free | Accepted |
