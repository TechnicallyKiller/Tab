# @tab/gateway

**Deployable · Fastify · the piece that makes a tab a tab**

The service that sits in front of the agent. **The spend leg works end to end on Hedera testnet.**

```bash
pnpm seller        # unmodified x402 seller
pnpm dev:gateway
pnpm demo:honest
```

## What runs today

| Endpoint | Does |
|---|---|
| `POST /v1/spend` | the spend leg: check → reserve → pay → commit |
| `GET /v1/tabs/:tab` | balance, outstanding, holds, available, ceiling |
| `GET /v1/tabs/:tab/holds` | every hold with its state |
| `GET /v1/tabs/:tab/entries` | the ledger, as replayed from HCS |
| `GET /health` | network, token, window |

## The order is enforced, not described

```
1. RESERVE   hold id issued, available drops IMMEDIATELY
2. PAY       x402 pays the seller, hold id as idempotency key
3. COMMIT    hold becomes a debit, receipt written to HCS
```

A crash between 1 and 2 is harmless — the hold expires and releases exactly what it reserved. A
crash between 2 and 3 leaves a transfer with no receipt, which the reconciler repairs from a Mirror
Node diff. **The hold is never released on a payment failure**: we cannot know whether the seller
was paid, and releasing would let the agent spend the same headroom twice.

## HCS is the source of truth, and the gateway proves it

On boot it replays the receipt topic and rebuilds its position:

```
replaying HCS   4 entries · 2 skipped · 1 tab(s)
  0.0.8812188   balance −0.1600 · outstanding 0.1600 · available 0.8400 · ceiling 1.0000
```

The two skipped are `bootstrap.hello` messages written before the schema existed. A replay must
survive them, and it does. Restart the gateway and it lands on the same position — the in-memory
projection is exactly what `@tab/db` will also be (ADR-0007).

## Three HTTP status decisions

- **A refusal is `200`** with a discriminated body. Handling refusal is the agent developer's main
  job; forcing every consumer into a `try/catch` to read the rule would make the Refusals view
  harder to build. Refusal is the product working.
- **A transport failure is `502`**, deliberately distinct. It must never pollute the Refusals view,
  which is a correctness demonstration.
- **A malformed request is `400`** with an example, not a schema dump.

## Known gaps, honestly

- **SINGLE INSTANCE ONLY.** Holds live in process memory, so two gateways would each allow up to the
  ceiling. `@tab/cache` fixes this, and Probe 5 explains why that hop cannot be optimised away — a
  hold reserve must be atomic across instances.
- **~31s per spend**, almost all of it the seller's facilitator doing Mirror Node preflight and
  signature verification from a high-latency link. The ceiling check itself is in-memory arithmetic.
- **The ceiling is a fixed config value.** `@tab/scoring` and `@tab/graph` do not exist, so there is
  no attested revenue, no tier, no ramp and no control-cluster check. Two of the six fast-path
  checks are implemented: per-call cap and ceiling headroom.
- **The earn leg is not built.** No 402 challenge, no forwarding, no attested credit receipts — so a
  tab can only go more negative. `@tab/x402` already has `createEarnServer`; nothing calls it here.
- **No settlement.** Windows are wall-clock buckets; nothing nets or transfers. `@tab/ledger` has
  `planSettlement` ready and unused.
- **`@tab/fastpath` is bypassed.** The checks are inline in `spend.ts`. They belong in the package
  that `boundaries.json` bans from reaching Mirror Node.
- **The seller account is read from a `payTo` query parameter.** A real deployment resolves it from
  the 402 challenge.
