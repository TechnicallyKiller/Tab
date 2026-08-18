# ADR-0002 — One Hedera SDK: `@hiero-ledger/sdk`

**Status:** Accepted · **Date:** 2026-08-18

## Context

`@hashgraph/sdk` was transferred to the Hiero project and republished as `@hiero-ledger/sdk`.
As of 2026-08-18 both scopes still publish and **neither is marked deprecated on npm**, so
nothing in the tooling prevents installing both:

| Package | Latest | Last publish |
|---|---|---|
| `@hiero-ledger/sdk` | 2.87.0 | 2026-08-12 |
| `@hashgraph/sdk` | 2.81.0 | 2026-03-13 |

Both of our load-bearing dependencies already resolve the Hiero scope: `@x402/hedera@2.22.0`
depends on `@hiero-ledger/sdk@2.85.0`, and Agent Kit v4's plugin documentation imports `Client`
from `@hiero-ledger/sdk`. The README's tech stack lists `@hashgraph/sdk`.

## Decision

`@hiero-ledger/sdk` only, pinned via the pnpm catalog and root `overrides` to a single version.
`@hashgraph/sdk` is banned in CI by `guard:sdk`, at the same severity as the `.sol` ban — the
check rejects both a declared dependency and a source-level import.

Only `packages/hedera` may import it. Everything else goes through that adapter.

## Consequences

**Why the ban is this strict.** Two copies of the SDK in the dependency graph means two
distinct `Transaction`, `AccountId` and `PrivateKey` classes. `instanceof` returns false across
the boundary. A partially-signed transfer that our code hands to `@x402/hedera` then fails to
serialize, and the failure surfaces at request time with an unhelpful error — not at build time,
and not in a unit test that stays inside one copy. This is the kind of bug that eats an evening
of a hackathon and cannot be reasoned about from the stack trace.

**Cost.** Documentation and older tutorials say `@hashgraph/sdk`, so copy-pasted example code
will trip the guard. That is the guard working. The error message points here.

**Watch item.** If `@x402/hedera` or Agent Kit ever bump to a Hiero SDK major we have not
pinned, the override becomes a lie and resolution will need revisiting. The pin is in one place
so this is a one-line change.
