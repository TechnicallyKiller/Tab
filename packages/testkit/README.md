# @tab/testkit

**Tier 3 · dev-only · never a runtime dependency of an app**

Fixtures and fakes so the domain packages can be tested without network access, and the apps can
be tested without a real seller.

## Why a fake seller is the important part

The strongest property in the design is *works with any unmodified x402 endpoint*. The way to
keep that true is to test against a seller built from stock `@x402/hedera/exact/server` that
knows nothing about Tab. If our tests only ever hit a seller we wrote with Tab in mind, we will
discover the coupling at demo time.

Build the fake seller from the published package, not from our adapter.

## Contents

| File | Holds |
|---|---|
| `src/fake-seller.ts` | stock x402 seller. **Zero Tab awareness** |
| `src/fake-payer.ts` | pays the agent's endpoint, for earn-leg tests |
| `src/fixtures/graph.ts` | graph shapes: the control loop, the shared funding root, the honest set |
| `src/fixtures/entries.ts` | ledger entry sequences, including crash-shaped gaps |
| `src/fixtures/ceilings.ts` | published ceiling records with known-good input hashes |
| `src/clock.ts` | deterministic clock — window boundaries and interest must not depend on wall time |
| `src/testcontainers.ts` | ephemeral Postgres and Redis for integration tests |

## Invariants

- **No app depends on this at runtime.** `devDependencies` only.
- **Fixtures are deterministic.** No `Date.now()`, no `Math.random()`. A flaky money test is
  worse than no test, because it trains people to rerun instead of read.
- **The graph fixtures encode the attack catalogue.** Each caught attack in the README should have
  a fixture proving it is caught, and the OPEN ones should have a fixture demonstrating they are
  *not* — labelled as such. That is the honest version, and it also stops someone later assuming
  the ring attack is handled.
