# ADR-0001 — pnpm + Turborepo monorepo with machine-checked dependency tiers

**Status:** Accepted · **Date:** 2026-08-18

## Context

Tab is not one service. It is a gateway in a request path with a hard latency budget, two
background workers, a dashboard, a CLI, three publishable libraries (`sdk`, `agentkit-plugin`,
`mcp`), two demo agents, and a verification tool that must run for someone who does not have
our infrastructure. These share money types, HCS message schemas, and credit parameters, and
they must share them *exactly* — a ceiling recomputed with different parameters is not a
verification.

The README documents several architectural rules as prose: the fast path never touches Mirror
Node, the ceiling must be independently recomputable, no Solidity anywhere. Prose rules survive
until the first tired commit.

## Decision

A pnpm workspace with Turborepo, organised into six tiers where **a package may depend on lower
tiers and never on higher ones**. The tier assignments and the per-package allow lists live in
[`boundaries.json`](../../boundaries.json), and `pnpm guard:boundaries` fails CI on violation.

Deployable processes live in `apps/`. Libraries live in `packages/`. One-shot operational
scripts live in `tools/`. Demo actors live in `agents/`.

## Consequences

**What this buys.** Every architectural ban in the README becomes a check anyone can run. The
fast path cannot import Mirror Node because the dependency is not declared and CI rejects it.
`verify` cannot read Postgres, so the claim that a stranger can recompute a ceiling stays true
by construction. Turborepo caches builds and typechecks per package, so touching the dashboard
does not retest the ledger.

**What it costs.** More `package.json` files than a single service needs, and a real chance of
over-fragmenting — a package per file is a smell, not an architecture. Every package in the
roster earns its place by having a dependency rule that differs from its neighbours; if a new
one does not, it belongs inside an existing package.

**What we rejected.** A single package with directory conventions — cheaper to start, but the
bans are then unenforceable, which is the entire reason for the structure. Nx — more capable
than we need, and its generators encode opinions we would spend time overriding.
