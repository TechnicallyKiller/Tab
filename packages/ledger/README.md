# @tab/ledger

**Tier 1 · pure functions · no database**

Double-entry accounting for a tab: holds, debits, credits, window netting, interest accrual, and
the invariant assertions that `verify-tab` runs.

## Why pure

Money math tested as functions is money math you can trust. If netting lived in the settlement
worker, testing it would mean standing up Postgres, Redis and a Hedera client — so it would be
tested less, and the one thing that must be exactly right would be the least covered code in the
repo.

The caller fetches the entries. This package turns them into balances.

## Contents

| File | Holds |
|---|---|
| `src/entries.ts` | the entry types: hold, debit, credit, interest, repair |
| `src/holds.ts` | reserve, commit, expire. Available-balance arithmetic |
| `src/netting.ts` | fold a window's entries into `net = credits − debits − interest` |
| `src/interest.ts` | accrual on outstanding at the tier APR, for whole and partial windows |
| `src/invariants.ts` | the assertions `verify-tab` runs, as pure predicates over entry lists |

## The write-ahead order this package encodes

The README fixes the order and it is not negotiable: **reserve → pay → commit.**

1. **Reserve.** A `hold_id` is issued and available drops *immediately*, before any payment.
   This is what defeats the race where many spends are issued before the ceiling updates.
2. **Pay.** The gateway pays the seller. `hold_id` is the idempotency key, so a retry never
   double-pays.
3. **Commit.** The hold converts to a debit and the receipt goes to HCS.

A crash between 2 and 3 leaves a transfer with no receipt. The reconciler in
[`apps/settlement`](../../apps/settlement/) catches it by diffing Mirror Node outbound transfers
against the receipt topic, and writes a repair entry. `repair` is therefore a first-class entry
type here, not an afterthought — and the diff is on camera in the demo.

## Invariants

These are the assertions, stated as the properties they protect:

- `available = ceiling − outstanding − pending_holds`, and never negative.
- A hold is committed at most once. Committing twice is a bug that double-counts a debit.
- An expired hold releases exactly what it reserved — no more, no less.
- `treasury_balance + hot_float_balance == float_total + outstanding` across all agents. Note
  this spans two accounts; see [ADR-0003](../../docs/adr/0003-two-account-float.md).
- Replaying the receipt topic in consensus order reproduces the current net position exactly.
  Order by HCS consensus timestamp, never by our own sequence numbers.

## Two decisions worth knowing

**`now` is an argument, never a clock read.** Every function that cares about hold expiry takes the
current consensus timestamp from the caller. A replay of the same entries must always produce the
same answer, and a function that reads `Date.now()` cannot promise that.

**Rounding on interest is DOWN, fixed here once.** Interest compounds across windows, so a
direction chosen differently at two call sites diverges slowly and breaks `verify-tab` in a way
that is very hard to trace. Down means an inexact accrual resolves in the agent's favour — the
house can afford to under-charge by a micro-USDC; over-charging is a number the operator cannot
explain.

## Settlement outcomes

| Net | Float can pay? | Outcome | Moves | Ramp |
|---|---|---|---|---|
| positive | yes | `clean` | the net, to the agent | **+15%** |
| positive | no | `missed` | nothing | **−30%**, immediately |
| negative | — | `carried` | nothing | unchanged |

A negative net is **carried, not demanded**. The agent has no wallet to pay from — that is the whole
premise — so the balance rolls forward and accrues.

## Tested

**25 tests, `pnpm --filter @tab/ledger test:unit`.** Covering what the spec asked for:

- the write-ahead order — a hold reduces available *before* any debit exists
- crash-shaped gaps: paid but never committed, so the hold keeps protecting the ceiling
- replay determinism: position is identical forward, reversed and shuffled
- duplicate delivery: a redelivered hold reserves once, not twice
- nanosecond-precision ordering, compared as bigints
- a hand-computed window with deliberately awkward micro-amounts (`+0.194208` exactly)
- every invariant, each with a case that trips it

## Not done yet

- **No generative property tests.** The spec asked for them; these are example-based. The
  properties worth generating over are order-independence and `available >= 0` across arbitrary
  interleavings.
- **The hand-computed fixture has been checked by one person, not two.** The spec asks for two, and
  that is the test most likely to hide a rounding mistake.
- `TIER_APR_BP` lives here temporarily. It belongs in `@tab/params` behind a pinned `MODEL_VERSION`
  once that package exists, so a historical accrual stays reproducible.
- Nothing consumes this yet — the gateway is the first caller.
