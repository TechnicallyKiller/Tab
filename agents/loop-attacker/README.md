# loop-attacker

**Demo adversary · operated by a second party · gets the Hedera SDK, deliberately**

The agent that breaks our own design on camera at 1:10.

## The attack

A second operator stands up a seller **it controls**, points a buyer at it, and manufactures
revenue by paying itself for real served requests.

1. The first few calls clear. Nothing is visibly wrong.
2. The indexer picks up the new funding edge.
3. `@tab/graph` finds funding ancestry within 3 hops → **hard block**.
4. The ceiling collapses to zero **mid-window**.
5. The next spend is **refused**, and the exact rule that fired is on screen.
6. The float is untouched.

## Why this runs at 1:10 and not 3:30

Judges watch dozens of these. Nothing surprising in the first ninety seconds and the submission is
remembered as competent rather than as interesting. Break your own design early, then show it
working.

Almost nobody demos the attack that breaks their own design. That is the differentiated move, and
it only lands if it is early.

## Contents

| Path | Holds |
|---|---|
| `src/seller.ts` | the controlled seller — stock x402, funded by the attacker |
| `src/attacker.ts` | the buying agent |
| `src/run.ts` | the timed sequence: clear a few, then get caught |

## Invariants

- **It uses only public surfaces.** No test hooks, no privileged endpoint, no seeded database row.
  If the attack needs help from us to be caught, it proves nothing. This is the single most
  important rule in this package.
- **The refusal comes from the real fast path**, reading a real snapshot the real engine wrote.
- **Timing is reproducible.** The demo depends on the catch happening on cue, so the run script
  waits on the indexer having processed the edge rather than on a fixed sleep. A `sleep(10)` will
  fail on stage exactly once.

## Also worth demonstrating, if there is time

The README's attack catalogue lists three **OPEN** items: a non-reciprocal collusion ring, gateway
operator misbehaviour, and a seller taking payment without delivering. The README says these lines
are the ones that win points, and it is right.

Consider a second script that mounts the ring attack and **succeeds**, shown at 4:30 alongside the
what-is-not-solved section. Demonstrating a real gap is a stronger credibility signal than
claiming one, and it removes any suspicion that the caught attacks were chosen because they were
the easy ones.
