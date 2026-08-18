# Tab — monorepo

**Agents shouldn't need a wallet to do business.**

The product argument, the pitch, and the demo script live in **[README-TAB.md](README-TAB.md)**.
This file is the map of the repository.

Built for ETHOnline 2026 · Hedera Testnet · **Zero Solidity**

---

## Start here

| If you are… | Read |
|---|---|
| new to the project | [README-TAB.md](README-TAB.md), then [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| about to write code | [docs/RESEARCH.md](docs/RESEARCH.md) — six findings change what several packages do |
| picking up a package | [docs/PACKAGE_MAP.md](docs/PACKAGE_MAP.md), then that package's own README |
| wondering why something is shaped oddly | [docs/adr/](docs/adr/) |
| setting up | [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md) |
| splitting the work | [docs/BUILD_ORDER.md](docs/BUILD_ORDER.md) |
| sitting down to work, any day | **[HANDOFF.md](HANDOFF.md)** — the living log. Read it first, update it before you push |

## Layout

```
apps/          deployable processes — gateway, engine, settlement, cli, dashboard
packages/      libraries, in dependency tiers. Three are published to npm
agents/        demo actors — honest-agent, loop-attacker
tools/         probes, bootstrap, verify, guards
docs/          architecture, ADRs, research, probes, keys
HANDOFF.md        living log — updated on every change
infra/         managed-service setup. No Docker
boundaries.json   THE ARCHITECTURE, machine-checked in CI
```

Every directory has a README stating what belongs in it, what must never go in it, its dependency
rules, and its invariants. Those READMEs are the specification — start from the one for the package
you own.

## The rules that are enforced, not just documented

`boundaries.json` declares each package's allowed dependencies. `pnpm guard` fails CI on violation.
Five bans, each protecting a claim in [README-TAB.md](README-TAB.md):

| Ban | Protects |
|---|---|
| the fast path cannot reach Mirror Node, Postgres or the scoring code | the sub-50ms budget |
| `tools/verify` cannot reach Postgres or Redis | "a stranger can recompute a ceiling" — the no-contract argument |
| `honest-agent` cannot import the Hedera SDK | "the agent holds no key and signs nothing" |
| no `.sol` file, no EVM tooling | the No Solidity Allowed track |
| no floating-point arithmetic in money paths | "reconciles to the cent" |

A rule in prose survives until the first tired commit. See [tools/guards/](tools/guards/).

## Commands

```bash
pnpm install
cp .env.example .env

pnpm probe          # Phase 0 — run FIRST. Nothing else starts until it is green
pnpm db:migrate     # Supabase schema
pnpm bootstrap      # create HCS topics + float accounts, associate USDC

pnpm dev            # gateway + engine + settlement + dashboard
pnpm guard          # the architectural bans
pnpm test

pnpm demo:honest    # 40 paid calls from an agent with no wallet
pnpm demo:attack    # the loop attacker, refused mid-window
pnpm verify-tab     # replay HCS, assert the float invariant
pnpm verify-ceiling --seq 42
```

## Stack

Verified against the live npm registry on 2026-08-18 — see [docs/RESEARCH.md](docs/RESEARCH.md) for
why each choice, and which of them corrects [README-TAB.md](README-TAB.md).

| | |
|---|---|
| Chain | Hedera Testnet — HCS, HTS, Schedule Service (HIP-423), Mirror Node |
| SDK | **`@hiero-ledger/sdk` 2.87.0** — never `@hashgraph/sdk` |
| Payments | **`@x402/core` + `@x402/hedera` 2.22.0** on `hedera:testnet` |
| Agent surface | **`@hashgraph/hedera-agent-kit` 4.1.0** — plugin + policy |
| Backend | Node 22, TypeScript strict, Fastify, BullMQ, Drizzle |
| Frontend | Next.js 15, Tailwind, shadcn/ui, TanStack Query, SSE |
| Infra | Supabase (Postgres) + Upstash (Redis). **No Docker** |
| Tooling | pnpm workspaces, Turborepo, Biome, Vitest, changesets |
| Not used | Solidity, Foundry, Hardhat, any EVM tooling |

## Status

**Structure and design complete. No implementation yet.** Phase 0 probes are the next action —
see [docs/probes.md](docs/probes.md).
