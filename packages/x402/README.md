# @tab/x402

**Tier 2 · adapter over `@x402/core` and `@x402/hedera` · all three protocol roles**

## Use the scoped v2 packages

| Use | Do not use |
|---|---|
| `@x402/core`, `@x402/hedera` — **2.22.0** (2026-08-11) | `x402` unscoped — 1.2.0, older single-package line |

`@x402/hedera` exports exactly three entry points, and Tab plays **all three roles** — which is
why this is one adapter package rather than logic scattered across the gateway:

| Entry point | Tab's role | Which leg |
|---|---|---|
| `@x402/hedera/exact/client` | buyer | **spend** — gateway pays the seller from hot float |
| `@x402/hedera/exact/server` | resource server | **earn** — gateway fronts the agent's endpoint |
| `@x402/hedera/exact/facilitator` | facilitator | **earn** — we verify and settle inbound ourselves |

## How the Hedera exact scheme actually works

This is the single most important thing to understand before writing gateway code, and it has
consequences the README did not account for.

1. The **client** builds a `TransferTransaction` debiting itself, signs it, and base64-encodes it
   as `ExactHederaPayloadV2 = { transaction: string }`.
2. The **facilitator** decodes it, verifies transfer semantics via `inspectHederaTransaction`,
   and **submits it as fee payer** — `getExtra()` returns `feePayer`.

Two consequences:

**The paying account signs per request, inside the request.** This is why the float is split into
a single-key Hot Float and a KeyList Cold Treasury: an m-of-n signature collection cannot live in
a path budgeted under 50ms. See [ADR-0003](../../docs/adr/0003-two-account-float.md).

**Gas responsibility is asymmetric.** We pay HBAR fees when we *earn* (we facilitate inbound);
the seller's facilitator pays when we *spend*. Monitor the gateway's HBAR balance separately from
the USDC float. See [ADR-0004](../../docs/adr/0004-self-hosted-facilitator.md).

## Constants to import, not redeclare

`@x402/hedera` exports these. Do not put them in `.env`:

```
HEDERA_TESTNET_CAIP2 = "hedera:testnet"     HEDERA_TESTNET_USDC = "0.0.429274"
HEDERA_MAINNET_CAIP2 = "hedera:mainnet"     HEDERA_MAINNET_USDC = "0.0.456858"
HEDERA_USDC_DECIMALS = 6                    HBAR_ASSET_ID       = "0.0.0"
HEDERA_TESTNET_MIRROR_NODE_URL              HEDERA_MAINNET_MIRROR_NODE_URL
```

Also exported and worth using: `createHederaPreflightTransfer()`, which checks via Mirror Node
that the payer holds enough of the asset and that `payTo` is associated with it or has a free
auto-association slot. A seller that forgot to associate then fails preflight with a reason
instead of silently.

## Contents

| File | Holds |
|---|---|
| `src/client.ts` | spend leg: 402 handling, payload construction, `hold_id` as idempotency key |
| `src/server.ts` | earn leg: payment requirements, price parsing, 402 responses |
| `src/facilitator.ts` | self-hosted verify + settle for inbound payments |
| `src/signer.ts` | hot-float signer wiring for client and facilitator roles |
| `src/errors.ts` | typed errors — a facilitator failure must be distinguishable from a refusal |

## Invariants

- **`hold_id` is the idempotency key on every spend-leg payment.** A retry with the same key must
  never double-pay. This is the `reserve → pay → commit` order in
  [@tab/ledger](../ledger/) and the reason a crash is recoverable.
- **The seller never learns Tab exists.** Any change requiring seller cooperation breaks the
  strongest property in the design: *works with any unmodified x402 endpoint*. The README says
  this must not be traded away. Nothing in this package may send a Tab-specific header or
  credential to a seller.
- **A facilitator failure refuses cleanly with a typed error.** It is not a ceiling refusal and
  must not be reported as one — the Refusals view is a correctness demonstration and polluting it
  with infrastructure errors ruins that.
- **Both legs speak stock x402.** No Tab-specific extension on the wire.

## Open for Phase 0

Which public facilitator advertises `hedera:testnet` in `/supported`, and whether our chosen demo
sellers accept HTS USDC or only HBAR. Self-facilitating does not answer this — on the spend leg we
are the client and must use whatever the seller advertises. See [docs/probes.md](../../docs/probes.md).
