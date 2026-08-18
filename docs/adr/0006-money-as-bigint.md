# ADR-0006 — All money is `bigint` micro-USDC behind a branded type

**Status:** Accepted · **Date:** 2026-08-18

## Context

USDC on Hedera has 6 decimals — confirmed by `HEDERA_USDC_DECIMALS = 6` exported from
`@x402/hedera`. Tab's headline correctness claim is that `verify-tab` replays HCS and
**reconciles to the cent**. It also accrues interest, applies weight multipliers (0.6 for
unattested revenue, tier multiples of 1.0/2.0/3.0, a ramp factor stepping by ±15%/30%), and
nets thousands of small amounts into one transfer per window.

That combination — many small numbers, repeated multiplication by fractions, and an exact
reconciliation requirement — is precisely where IEEE-754 doubles produce a ledger that is off by
a few micro-USDC and cannot be explained.

## Decision

Every monetary amount is a `bigint` count of micro-USDC, carried in a branded type
(`type MicroUsdc = bigint & { readonly __brand: 'MicroUsdc' }`) defined in `@tab/money`.
`@tab/money` has **zero dependencies** and holds all parsing, formatting, comparison and
rounding.

Rates and multipliers are integer basis points, not decimals: a 0.6 weight is `6000` bp,
a 6% APR is `600` bp. Multiplication is `(amount * bp) / 10000n` with **the rounding direction
stated explicitly at every call site**, because "round half up" is a decision, not a default.

`pnpm guard:money` rejects `parseFloat`, `Number.parseFloat`, `toFixed`, and `* 1e6` / `/ 1e6`
in `money`, `ledger`, `scoring`, `fastpath`, `gateway`, `settlement` and `engine`. Presentation
formatting inside `@tab/money` is exempt, and a line may opt out with `// allow-float` plus a
reason.

## Consequences

**What we gain.** The reconciliation claim is achievable rather than aspirational, and rounding
becomes a reviewable decision at each site instead of an accumulated accident. The branded type
means a raw `bigint` — a timestamp, a sequence number, a hop count — cannot be passed where an
amount belongs.

**What it costs.** More verbose arithmetic, and `JSON.stringify` does not handle `bigint`, so
`@tab/protocol` must serialize amounts as decimal strings on the wire and at every API boundary.
This is a feature for HCS messages, where the canonical form must be byte-stable so the ceiling
input hash is reproducible.

**Where rounding must be pinned first.** Interest accrual on a partial window, and the ramp
factor applied to a ceiling. Both are compounding, so a rounding choice made twice differently
diverges. Fix the direction in `@tab/params` alongside `MODEL_VERSION`, and write the test
before the implementation.
