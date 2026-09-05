# @tab/x402

**Tier 2 · adapter over `@x402/core` + `@x402/hedera` · all three protocol roles**

Tab plays every role in the protocol, which is why they live in one package rather than scattered
across the gateway:

| Role | Leg | File |
|---|---|---|
| **client** | spend — pays unmodified sellers from the hot float | `client.ts` |
| **resource server** | earn — fronts the agent's endpoint, returns 402 | `server.ts` |
| **facilitator** | earn — verifies and settles inbound ourselves | `facilitator.ts` |

Proven end to end on Hedera testnet: `pnpm probe:adapter` (HBAR, ~2.2s) and
`pnpm probe:adapter:hts` (6-decimal token, ~39s). Both settle real value.

## The finding that cost the most to trace

**Node's `fetch` has a 10-second connect timeout that no `AbortController` can extend.** An abort
signal bounds the whole request; the connect phase fails first and independently.

Mirror Node from a high-latency link takes **5–15 seconds to connect**, so roughly half of all
requests die on undici's default. Inside x402 that surfaces as:

```
invalid_exact_hedera_payload_signature_invalid
invalidMessage: "fetch failed"
```

The facilitator's `verifyPayerSignature` fetches the payer's on-chain key from Mirror Node. When
that fetch dies, the scheme fails closed and reports a **signature** error for a **network**
problem. It presents as intermittent — the same code passing and failing minutes apart — which
sends you looking for a race in your own wiring. I bisected through four wrong hypotheses before
checking whether Node could reach Mirror Node at all.

**Every app and tool must call `configureGlobalHttp()` from `@tab/mirror` at boot**, before any
HTTP. It is process-global, so once is enough and library code must never call it.

The HTS path needs more headroom than HBAR: the facilitator's preflight checks payer balance *and*
`payTo` association, and each token query runs 5–15s. `probe:adapter:hts` uses 90s.

## Other things worth knowing

**Two decimal systems, and mixing them is a 100× error.** HBAR is 8 decimals (tinybars), a dollar
token is 6 (micro-units). Every amount crossing this package is atomic units of a **named** asset
(`hbarAsset()` / `tokenAsset(id)`), never a bare number.

**x402 ships its own client-side spend controls, and they default to USD-pegged assets only.**
`findDefaultAsset` knows USDC, not HBAR, capped at `$1`. A non-default asset needs an explicit
`allowedAssets` entry with an **atomic** cap.

That control is worth understanding rather than just satisfying: it is x402's version of a per-call
cap, and it is **client-side and advisory** — whoever configures the client can raise it. Tab's real
cap lives in the gateway fast path where the agent cannot reach it. Defence in depth, not the
defence.

**The facilitator fee payer must be a funded ECDSA account, separate from the seller.** Same account
for both nets to price-minus-fee, which reads like a wrong price.

**Gas is asymmetric, and it is measured.** The buyer moves exactly the price and no fee; the
facilitator's fee payer absorbs it. So the seller's facilitator pays gas when Tab **spends**, and Tab
pays gas when it **earns** and self-facilitates. The gateway needs an HBAR balance monitored
separately from its token float.

## Invariants

- **The seller never learns Tab exists.** No Tab-specific header, credential or negotiation may
  reach a seller. The moment one does, we lose *works with any unmodified x402 endpoint*, which is
  the strongest property in the design.
- **`hold_id` is the idempotency key on every spend-leg payment** once the gateway wires it in.
- **A facilitator failure is a typed error, distinguishable from a ceiling refusal.** The Refusals
  view is a correctness demonstration; polluting it with infrastructure errors ruins that.
- **`payTo` is a Hedera account id string**, never an EVM address.

## Not done yet

- `hold_id` is not threaded through as the idempotency key — that arrives with the gateway.
- Settlement receipts are not written to HCS here; that is the gateway's job via `@tab/protocol`.
- No unit tests. The probes cover behaviour but need the network and real testnet accounts.
- Never tested against a **third-party public seller** — ours is stock `@x402/hedera`, which is the
  right test of "unmodified", but does not prove a public facilitator accepts HTS tokens.
