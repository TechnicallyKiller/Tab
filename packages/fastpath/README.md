# @tab/fastpath

**Tier 3 · THE HOT PATH · target under 50ms · cache and memory ONLY**

The check that runs on every spend request before any money moves.

## The ban, and why it is a package boundary

`boundaries.json` forbids this package from depending on `mirror`, `db`, `hedera`, `x402`, `graph`
or `scoring`. Not by convention — the dependency is undeclarable and CI rejects it.

The README calls the no-Mirror-Node rule "a hard rule, not a performance target". One accidental
history call in the hot path and the latency budget is gone, and it will be gone in production
under load rather than in a test. A comment cannot prevent that; a dependency graph can.

It cannot reach the scoring code either. The fast path **reads a precomputed snapshot and
decides.** It never computes a ceiling.

## The six checks, in order

```
1  available = ceiling − outstanding − pending_holds
2  price ≤ available
3  price ≤ per_call_cap   AND   window_spend + price ≤ window_cap
4  seller not in the agent's control cluster        (precomputed — a set membership test)
5  spend_to_seller + price ≤ 0.4 × ceiling          (concentration)
6  global circuit breaker off
```

Order matters: cheapest and most-likely-to-refuse first. Check 4 is a set lookup against a
cluster the engine already computed — this package does not traverse a graph.

## Contents

| File | Holds |
|---|---|
| `src/check.ts` | the six checks and the reserve-on-allow path |
| `src/snapshot.ts` | reading and validating the cached snapshot, including staleness |
| `src/refusal.ts` | typed refusal with the exact rule that fired |
| `src/timing.ts` | per-stage latency instrumentation |

## Invariants

- **Fails closed.** Redis unreachable, snapshot missing, or snapshot too old → refuse. There must
  be no code path where an error becomes an allow. A refused spend costs the agent a job; an
  allowed spend past a ceiling costs the house real money.
- **A reservation happens atomically on allow.** Available drops at *reserve* time, not at commit.
  This is what defeats the race of many spends issued before the ceiling updates — the attack the
  README lists as caught.
- **Every refusal names one rule.** Not "insufficient credit" — the specific check, from the
  published enum. The demo puts this on screen.
- **A snapshot older than its max age is a refusal, not a warning.** Trusting an unbounded stale
  snapshot is how a collapsed ceiling keeps allowing spends.
- **No `await` on anything but Redis**, and only after the in-process LRU misses.

## Definition of done

A latency test that fails the build over budget — the number is a claim in the README, so it
belongs in CI, measured against real managed Redis in-region rather than a local instance that
flatters it. Plus a concurrency test: N simultaneous spends against an available balance that
only covers N−1 must refuse exactly one.
