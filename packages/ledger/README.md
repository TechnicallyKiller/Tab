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

## Definition of done

Property-based tests over generated entry sequences, including out-of-order arrival, duplicate
delivery, and crash-shaped gaps (a payment with no commit). Then one hand-computed fixture with
an odd micro-USDC amount and a partial-window interest accrual, checked by two people
independently. That fixture is the thing that catches a rounding mistake.
