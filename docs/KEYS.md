# Keys and Custody

The float is custodial. That is inherent to the design, not a v1 shortcut — removing the wallet
from the agent means somebody else holds it. What we can offer instead of decentralisation is
**non-repudiable books**: every movement published to HCS, with an invariant a stranger can verify.

This document is the honest version of who holds what.

## The accounts

| Account | Key | Holds | Signs | Exposure if compromised |
|---|---|---|---|---|
| **Cold Treasury** | threshold `KeyList` (m-of-n) | the bulk of the float | top-ups to Hot Float only | requires m signers |
| **Hot Float** | single key, in the gateway | a capped working balance | every spend-leg x402 payment; the settlement tick | **the cap.** A published number |
| **Operator** | single key | HBAR for fees | topic creation, bootstrap | operational, not custodial |

## Why Hot Float is single-key, and why that is an improvement over the README

The README puts the whole float on a threshold `KeyList` and presents that as the custody answer.
The published types for `@x402/hedera@2.22.0` show why that cannot hold: in the Hedera `exact`
scheme the client builds a `TransferTransaction` debiting itself, signs it, and hands it to the
facilitator to submit. On the spend leg Tab is the client — so **the paying account must sign per
request, inside the request.**

A threshold KeyList there means m-of-n signature collection inside a path budgeted under 50ms.
Either the budget goes or the KeyList is decorative.

Splitting the accounts makes the claim both true and quantified. The blast radius of a compromised
gateway is the Hot Float cap — a number we publish — rather than the whole float. That is a weaker
claim than "multi-sig protects the money" and a stronger one than a KeyList that cannot be used as
described. See [ADR-0003](adr/0003-two-account-float.md).

## Correction owed to the README

The Trust and Security Model section says "Single signer in v1. The float account uses a threshold
`KeyList`, which is a real improvement over one key." Both halves cannot be true of the same
account. Restate as:

> The account that pays sellers is single-signer, because the x402 exact scheme requires a
> signature per request. Its balance is capped at a published amount, so the exposure of the hot
> key is bounded and stated. The reserve behind it sits in a separate account under a threshold
> `KeyList` that signs only top-ups, on a human timescale. This is not a multi-party custody
> solution and we do not claim it is.

A judge who reads `@x402/hedera`'s types can disprove the original wording. Better to say this.

## Top-up flow

The settlement service watches Hot Float against a refill threshold. Below it, it requests a
top-up from Treasury — an m-of-n signature event on a human timescale, where a KeyList is genuinely
the right tool.

Both balances are readable from Mirror Node, so `verify-tab`'s invariant spans both accounts and
stays checkable by a stranger:

```
treasury_balance + hot_float_balance == float_total + outstanding
```

## HBAR, separately

We self-facilitate the earn leg ([ADR-0004](adr/0004-self-hosted-facilitator.md)), and the
facilitator submits the transaction as fee payer. So **Tab pays gas when it earns**, while the
seller's facilitator pays when Tab spends.

That asymmetry means the fee-paying account's HBAR balance must be monitored **separately from
USDC**. If it empties, inbound payments stop while the USDC float still looks healthy — which is a
confusing way to lose a demo. Put it in `verify-tab`'s output and in the metrics.

## Rules

- **No key in the repo.** `guard:secrets` rejects DER prefixes (`302e`, `302a`) in tracked files
  and any `.env` other than `.env.example`.
- **No key in a log.** `@tab/observability` redacts by pino path and by DER-shape serializer.
  Someone will eventually log a config object.
- **No key in `@tab/sdk`.** If the SDK ever accepts a private key, the agent-holds-nothing claim is
  gone. `boundaries.json` bans the Hedera SDK there.
- **`tab config` prints parameters, never secrets.**
- **Cold Treasury never signs inside a request.** Not as a fallback, not "just for the demo".
  Adding that code path removes the only thing making the split meaningful.

## Not in scope for v1

Mainnet, real liquidity, KYC/AML, dispute arbitration, multi-party custody, or exit proofs that let
an operator withdraw against published receipts without gateway cooperation. That last one is v2 and
is the honest fix for the custodial gap — worth naming as the direction, not claiming as a feature.
