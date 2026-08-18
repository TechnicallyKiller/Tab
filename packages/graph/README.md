# @tab/graph

**Tier 1 · pure functions over edge lists · MUST NOT touch the database**

Funding ancestry, control-cluster detection, and counterparty weights. The independence engine.

Same purity rule and same reason as [@tab/scoring](../scoring/): `tools/verify` must reproduce a
decision from Mirror Node data alone. The caller supplies the edges; this package traverses them.

## What makes this different from a lending protocol's version

A lender asks one question: *is this payer independent of the borrower?* Tab asks it in **both
directions** — on the earn leg (*is this payer independent?*) and on the spend leg (*is this
seller independent?*). Same graph, same math, applied twice. The spend-leg direction is the one
almost nobody implements, and it is what catches the loop attacker.

## Rules being implemented

**Hard block — contribution 0, spend refused**

- the agent funded the seller within 3 hops
- the seller's only counterparty is the agent

**Discount — weight below 1**

- seller account younger than `AGE_FULL_DAYS`
- the seller pays value back toward the agent
- shared funding root within 2 hops
- one seller takes over 40% of the agent's spend

## Contents

| File | Holds |
|---|---|
| `src/ancestry.ts` | funding-ancestry traversal with an explicit hop limit |
| `src/clusters.ts` | control-cluster detection, both directions |
| `src/weights.ts` | per-counterparty weight, and the **reason** it was assigned |
| `src/concentration.ts` | the 40% single-counterparty share check |
| `src/types.ts` | the edge and node shapes the caller must provide |

## Invariants

- **Every weight carries a machine-readable reason.** The Counterparties dashboard view shows
  *why counted, why discounted, why rejected*, and the Refusals view names the exact rule that
  fired. A weight of `0.4` with no reason is useless in the demo and useless in a dispute. Return
  a reason code from the same enum `@tab/protocol` publishes.
- **Hop limits come from `@tab/params`.** Never a literal `3` in the traversal.
- **Traversal is deterministic and terminates.** Funding graphs contain cycles. Bound by hops
  and by visited-set, and test the cycle case explicitly — an unbounded traversal in the engine
  is a hang, and a hang during the demo looks identical to a crash.
- **Age discounting is calibrated for testnet and said out loud.** Use `created_timestamp` from
  the Mirror Node accounts endpoint for exact account age rather than a first-operation
  heuristic. On testnet every account is young, so `AGE_FULL_DAYS` is tuned down; the value
  appears in the config dump and in the video.

## The gap to state, not hide

A **non-reciprocal collusion ring** — value never flows back and funding roots are genuinely
separate — defeats this engine. It is listed OPEN in the README's attack catalogue and it should
stay listed. Do not let the implementation imply a guarantee the math does not provide. The
honest claim is that attestation plus independence raises the cost of faking revenue; it does not
reduce it to zero.
