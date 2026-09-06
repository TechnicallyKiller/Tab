# ADR-0009 — Schedule the settlement transfer at window close, not at window open

**Status:** Accepted · **Date:** 2026-09-06 · **Qualifies** a README claim

## Context

`apps/settlement/README.md` left this open deliberately:

> The amount is not known at window open. Decide and document the approach — a schedule created at
> open with a provisional amount and replaced at close, or created near close with a short expiry.
> **Write down which one, and why, before building it.**

The README's stronger claim is that "Scheduled Transactions execute the settlement tick **without a
keeper**." Probe 6 proved the execution half of that: a schedule with `wait_for_expiry: true` fired
at expiry with nothing submitted by us.

## The problem with the keeper-free framing

A window's net is only knowable once the window has closed. So:

**Create at open with a provisional amount.** The amount is wrong by construction, so something must
delete and replace the schedule at close — which needs a process alive at close. The keeper is back,
and now there is also a wrong number briefly committed on-chain.

**Create at close.** Something must be alive at close to compute the net and create the schedule.
That is also a keeper.

Neither option removes the keeper from *creation*. Pretending otherwise would be the kind of claim a
judge checks, so it should not be made.

## Decision

**Create the schedule at window close, once the net is known, with `wait_for_expiry: true` and a
short expiry.**

And restate the claim precisely: **the settlement transfer is executed by consensus, not submitted
by us.** That is narrower than "no keeper" and it is true.

## What the schedule actually buys, once framed honestly

Three things, none of which a direct `TransferTransaction` gives:

1. **Multi-party signing without an online coordinator.** The settlement transfer can require the
   cold Treasury `KeyList` ([ADR-0003](0003-two-account-float.md)). Signatures arrive
   asynchronously and consensus executes when the threshold is met or at expiry. This is the
   original purpose of the Schedule Service and it maps exactly onto a split float.
2. **The transfer is publicly committed before it executes.** A stranger can read the pending
   settlement from Mirror Node — amount, parties, expiry — *before* value moves. A direct transfer
   is only visible afterwards. For a custodial float, being able to see what the house is about to
   do is worth more than saving a keeper.
3. **It survives the worker dying.** Once created, the schedule executes even if the settlement
   process crashes a second later. That is the part of the keeper-free claim that genuinely holds,
   and it is the failure mode that matters — a worker that dies mid-tick must not leave a window
   unsettled.

## Consequences

**What we gain.** The honest version of the claim, plus a path to multi-party float control in v2
that needs no new mechanism. Point 3 also means a window is settled-or-not rather than
half-settled, which the reconciler depends on.

**What it costs.** The settlement worker must be alive at window close. That is a real operational
requirement, and it is why `apps/settlement` is documented as exactly one instance — two would
double-settle a window, which moves real money twice.

**Corrections owed.** `README-TAB.md` says "Scheduled Transactions execute the settlement tick
without a keeper" and `docs/ARCHITECTURE.md` echoes it. Both should read "executed by consensus
rather than submitted by us, and surviving the worker's death". The distinction is small in words
and large in whether the claim withstands a question.

**Not chosen and why.** Creating at open with a provisional amount was rejected outright: it puts a
knowingly wrong number on a public ledger, and still needs a keeper at close to fix it.
