# @tab/settlement

**Deployable · BullMQ worker · exactly ONE instance · never two**

The window tick, the HIP-423 schedule that executes it, and the reconciler that proves the books.

## The tick

```
window closes
   └─ net = credits − debits − interest
        ├─ net > 0 → one USDC transfer, hot float → agent
        └─ net < 0 → carry as outstanding, accrue interest at tier APR
             │
             └─ settled clean? ── yes → ramp +15%
                               └─ no  → ramp −30%, ceiling collapses
                                          │
                                          └─ settlement record → HCS
```

Ten thousand calls become one transfer. Per-request settlement is netted per window, because the
economics of micropayment credit only work if the bookkeeping is free and the settlement is cheap.

## How the tick executes without a keeper

At window **open**, build a `ScheduleCreateTransaction` with `expiration_time` at window **close**
and `wait_for_expiry: true`. Consensus evaluates it at expiry rather than when signatures land.
No cron, no bot we run and pay for.

**Do not call this recurring billing.** A schedule fires once and expires; each window creates its
own. The README is right that claiming cron would be wrong and a judge would catch it.

The amount is not known at window open. Decide and document the approach — a schedule created at
open with a provisional amount and replaced at close, or created near close with a short expiry.
The second is simpler and still keeper-free. **Write down which one, and why, before building it.**

## The reconciler

Diff Mirror Node outbound transfers against the receipt topic on every window close. A crash
between *pay* and *commit* leaves a transfer with no receipt; the diff finds it and writes a repair
receipt.

**This diff is the demo's proof of reconciliation and runs on camera.** So its output is a
first-class artifact — a clean, readable report, not debug logging.

## Contents

| Path | Holds |
|---|---|
| `src/tick/window.ts` | window boundaries, close detection |
| `src/tick/net.ts` | netting via `@tab/ledger`. No math of its own |
| `src/tick/interest.ts` | accrual at tier APR on carried outstanding |
| `src/tick/ramp.ts` | ramp adjustment and publication |
| `src/schedule/build.ts` | the HIP-423 schedule |
| `src/reconcile/diff.ts` | Mirror outbound vs receipt topic |
| `src/reconcile/repair.ts` | repair receipts |
| `src/treasury/topup.ts` | hot-float refill request when below threshold |

## Invariants

- **One instance.** Two settlement workers can double-settle a window, which moves real money
  twice. Take a lock and refuse to start without it. This is not a scaling concern to solve later.
- **Settlement is idempotent per `(agent, window)`.** Even with the lock, a retry must be safe.
- **All arithmetic goes through `@tab/ledger`.** No money math in this app.
- **Interest and ramp rounding come from `@tab/params`.** Both compound, so two call sites
  rounding differently diverge slowly and break `verify-tab` in a way that is hard to trace.
- **A missed settlement carries and accrues; two consecutive misses collapse the tier to Unrated,
  the ceiling to zero, and freeze the agent.** Straight from the failure matrix.
- **Every settlement is published to HCS** with net, transfer id, ramp change and outstanding
  carried.
- **Treasury top-ups are a separate, human-timescale path.** Cold Treasury's KeyList signs those
  and never signs inside a request. See [ADR-0003](../../docs/adr/0003-two-account-float.md).
