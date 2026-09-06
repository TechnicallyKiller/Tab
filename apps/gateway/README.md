# @tab/gateway

**Deployable · Fastify · the piece that makes a tab a tab**

The service that sits in front of the agent on **both legs** of its economic life. Both work end
to end on Hedera testnet.

```bash
pnpm seller                                   # unmodified x402 seller
pnpm agent:endpoint                           # the agent's own paid endpoint
AGENT_ENDPOINT_URL=http://localhost:4066 \
  pnpm start:gateway
pnpm demo:honest                              # spend leg — tab goes negative
pnpm demo:earn                                # earn leg  — tab goes positive
```

## What runs today

| Endpoint | Does |
|---|---|
| `POST /v1/spend` | the spend leg: check → reserve → pay → commit |
| `GET /v1/earn` | the earn leg: 402 → collect → forward → attested credit |
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

## The earn leg

x402 answers the 402, verifies and settles the inbound payment into the **hot float** — never into
the agent's hands — and only then does the handler forward upstream to the agent's endpoint.

**Attestation means one specific thing**: an inbound payment corresponded to a request the gateway
actually served. Because we self-facilitate, settlement and receipt-writing happen in the same code
path, which is what makes that tight rather than inferred. It does **not** prove the payer was
independent — that is `@tab/graph`'s job, and conflating the two would be the easiest way to
overstate the design.

The ordering is the mirror image of the spend leg, and deliberately so. On the spend leg we reserve
before paying. Here the money has **already moved** by the time the handler runs, so the request is
forwarded even if the receipt write fails: refusing to serve a request the payer paid for would be
theft, while a missing receipt is repairable by the reconciler. A payment we took but could not
serve is recorded with `attested: false` — real money that must not claim to be earned revenue.

**Three accounts must be distinct.** x402 rejects a transfer the facilitator's fee payer is a party
to (`invalid_exact_hedera_payload_fee_payer_transferring_funds`), so payer, `payTo` and fee payer
are three separate accounts. `pnpm payer:create` makes an independent one.

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
- **No settlement.** Windows are wall-clock buckets; nothing nets or transfers. `@tab/ledger` has
  `planSettlement` ready and unused.
- **`@tab/fastpath` is bypassed.** The checks are inline in `spend.ts`. They belong in the package
  that `boundaries.json` bans from reaching Mirror Node.
- **The seller account is read from a `payTo` query parameter.** A real deployment resolves it from
  the 402 challenge.
