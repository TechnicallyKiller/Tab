# @tab/gateway

**Deployable · Fastify · latency-critical · stateless**

The service that sits in front of the agent on both legs of its economic life. Three roles in one
process, because they share the hot float signer and the receipt writer.

| Role | Leg | Uses |
|---|---|---|
| x402 **client** | spend — pays sellers from hot float | `@x402/hedera/exact/client` |
| x402 **resource server** | earn — fronts the agent's endpoint | `@x402/hedera/exact/server` |
| x402 **facilitator** | earn — verifies and settles inbound | `@x402/hedera/exact/facilitator` |

## Spend leg

```
agent → gateway → fastpath.check(price, seller)  [cache only, <50ms]
                    ↓ ALLOW + hold_id
                  HTTP request to seller
                    ↓ 402 Payment Required
                  pay USDC from hot float        [signs per request]
                    ↓ 200 + content
                  debit receipt → HCS
                    ↓
                  content → agent
```

The seller sees an ordinary x402 customer and does not know Tab exists. **Nothing on the seller
side changes.** The README calls this the strongest line in the project and says it must not be
traded away — so no Tab-specific header, no credential, no negotiation reaches a seller. Ever.

## Earn leg

The gateway returns a 402, the payer pays into the hot float, the request is forwarded to the
agent's endpoint, and an **attested** credit receipt goes to HCS — carrying the request hash,
payer and amount.

Attestation means one specific thing: an inbound payment corresponded to a request the gateway
actually served. Because we self-facilitate, settlement and receipt-writing happen in the same
code path, which is what makes the claim tight. It does **not** prove the payer was independent —
that is [@tab/graph](../../packages/graph/)'s job, and the README is right to state both limits.

## Contents

| Path | Holds |
|---|---|
| `src/routes/spend.ts` | spend leg |
| `src/routes/earn/*.ts` | earn leg: 402, forward, respond |
| `src/routes/facilitator/*.ts` | `/verify`, `/settle`, `/supported` |
| `src/routes/state.ts` | balance, ceiling, receipts, refusals for the SDK |
| `src/routes/stream.ts` | SSE receipt stream for the dashboard |
| `src/holds.ts` | reserve → pay → commit, and hold expiry |
| `src/receipts.ts` | HCS receipt writer |
| `src/env.ts` | env schema, validated at boot. Refuse to start on a missing value |

## Invariants

- **`reserve → pay → commit`, in that order, always.** Never pay without a reservation; never
  record a debit without a payment. A crash between pay and commit is repaired by the reconciler
  from a Mirror Node diff — which is why the order is fixed rather than convenient.
- **`hold_id` is the idempotency key on the payment.** A retry with the same key must not double-pay.
- **Fails closed.** Redis down, snapshot stale, breaker on → refuse. No path turns an error into
  an allow.
- **Every refusal is published to HCS with the rule that fired.** Refusals are the product
  demonstrating that it works, not an error log.
- **Only the hot float key lives here.** Cold Treasury signs nothing inside a request.
  See [ADR-0003](../../docs/adr/0003-two-account-float.md).
- **HBAR balance is monitored.** We pay gas on the earn leg because we facilitate it. Running out
  stops inbound payments while the USDC float still looks healthy.
- **Never log an earn-leg request body.** We front someone's endpoint; those are its customers'
  data. Log the hash.

## Failure behaviour

Each row is a claim in the README's failure matrix and must actually behave this way:

| Failure | Behaviour |
|---|---|
| Seller takes payment, never delivers | Debit stands, dispute flagged to HCS. v1 does not arbitrate |
| Crash mid-spend | Hold expires by TTL; reconciler repairs from the Mirror diff |
| Redis lost | Refuse all spends. **Never fails open** |
| Facilitator down (spend leg) | Clean refusal, typed error, distinct from a ceiling refusal |
| Mirror Node lagging | No effect. The fast path never reads it |
