# @tab/verify

**THE TRUST ARTIFACT. This is what replaces a smart contract.**

Two commands, both runnable by a stranger who has this repo and network access — and **nothing
else**. No Postgres, no Redis, no gateway, no cooperation from us.

| Command | Asserts |
|---|---|
| `pnpm verify-tab` | replay HCS receipts, assert the float invariant. Reconciles to the cent |
| `pnpm verify-ceiling --seq N` | recompute ceiling N from its published inputs, check the hash |

## Why the deny list on this package is the most important line in `boundaries.json`

`boundaries.json` bars this package from `db`, `cache`, `fastpath` and `sdk`.

The no-contract argument in the README is: *a smart contract would assert the same invariant in a
test only we run; HCS plus this tool lets a stranger assert it themselves.* That argument holds
only if this tool genuinely does not need our infrastructure.

Without the deny list, someone adds a convenient `@tab/db` import, the tool still passes on our
machines, and the claim becomes false without anyone noticing — until a judge runs it. This is also
why [@tab/scoring](../../packages/scoring/) and [@tab/graph](../../packages/graph/) are pure
packages rather than directories inside `apps/engine`: `verify-ceiling` has to import the real
scoring code, not a reimplementation.

**A reimplementation here would be worthless.** It would prove the two copies agree, not that the
published ceiling is right.

## What each command does

**`verify-tab`** — replay the receipt topic in consensus-timestamp order, fold it through
`@tab/ledger`, then read both float account balances from Mirror Node and assert:

```
treasury_balance + hot_float_balance == float_total + outstanding
```

Note this now spans two accounts. Both are readable from Mirror Node, so the invariant stays
checkable by a stranger. Also report the HBAR balance on the fee-paying account.

**`verify-ceiling --seq N`** — read ceiling message N, take its published inputs and
`MODEL_VERSION`, recompute through `@tab/scoring` and `@tab/graph` with the matching frozen
parameter set from `@tab/params`, canonically serialize, and compare hashes.

This is why parameter sets are frozen once published: a ceiling from week one must stay verifiable
in week three.

## Contents

| Path | Holds |
|---|---|
| `src/verify-tab.ts` | replay and the float invariant |
| `src/verify-ceiling.ts` | recompute and hash-compare |
| `src/replay.ts` | topic replay via Mirror Node, ordered and paginated |
| `src/report.ts` | human-readable output. **This appears on camera** |

## Invariants

- **No `@tab/db`, no `@tab/cache`, no gateway call.** Enforced by `boundaries.json`.
- **Imports the real `@tab/scoring` and `@tab/graph`.** Never a second implementation.
- **Exits non-zero on failure** and runs in CI on a seeded topic.
- **Output is designed to be read on camera.** It reconciles to the cent in the demo at 3:50, so
  the report is a deliverable with a designed layout, not `console.log` debugging.
- **A stranger can run it.** The acceptance test for this package: a fresh clone, `pnpm install`,
  three topic ids, and no other configuration.
