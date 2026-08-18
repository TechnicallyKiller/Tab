# @tab/hedera

**Tier 2 · adapter · the ONLY package that may import `@hiero-ledger/sdk`**

Client construction, HTS transfers, HCS submit and read, and the HIP-423 scheduled-transaction
builder.

## The SDK rule

Use `@hiero-ledger/sdk` (2.87.0). **Never `@hashgraph/sdk`.** They are the same project after a
scope transfer, both still publish, and neither is marked deprecated — so nothing stops you
installing both, and installing both breaks signing at request time rather than at build time.
Two copies means two `Transaction` classes, `instanceof` returns false across the boundary, and a
partially-signed x402 transfer fails to serialize with an unhelpful error.

`pnpm guard:sdk` rejects the wrong scope in both dependencies and imports.
See [ADR-0002](../../docs/adr/0002-single-hedera-sdk.md).

## Contents

| File | Holds |
|---|---|
| `src/client.ts` | client construction, operator config, retry and timeout policy |
| `src/hts.ts` | USDC transfers, token association, balance reads |
| `src/hcs/submit.ts` | topic message submission with the `@tab/protocol` schema at the boundary |
| `src/hcs/read.ts` | topic subscription and replay via consensus node |
| `src/schedule.ts` | HIP-423 `ScheduleCreateTransaction` builder for the settlement tick |
| `src/topics.ts` | topic creation and the topic-id registry |

## HIP-423, precisely

Long-term scheduled transactions shipped in mainnet v0.57. Two fields matter:

- `expiration_time` — when the schedule expires. Defaults to 30 minutes, supported out to
  roughly two months.
- `wait_for_expiry` — when `true`, the transaction is evaluated **at expiry** rather than when
  the last required signature arrives.

Tab creates the window's settlement transfer at window **open** with `wait_for_expiry: true` and
an expiry at window **close**. Consensus executes it. No keeper, no cron, no bot we pay for.

**Do not describe this as recurring billing.** A schedule fires once and expires; each window
creates its own. The README is right that claiming cron would be wrong and a judge would catch it.

## Invariants

- **Nothing outside this package imports the SDK.** Two exceptions, both deliberate and both
  declared in `boundaries.json`: `@tab/x402` (it wraps `@x402/hedera`, which builds transactions)
  and `agents/loop-attacker` (standing up a controlled seller is the attack).
- **Amounts crossing this boundary are `MicroUsdc`**, converted to SDK units at the last moment.
- **Every HCS submit validates against `@tab/protocol` first.** A topic is append-only: a
  malformed message is permanent.
- **Two accounts, two roles.** Hot Float signs per-request payments and the settlement tick. Cold
  Treasury signs only top-ups. Do not add a code path where Treasury signs inside a request.
  See [ADR-0003](../../docs/adr/0003-two-account-float.md).
- **HBAR balance is monitored separately from USDC.** We are the fee payer on the earn leg
  because we self-facilitate; running out of HBAR stops inbound payments while the USDC float
  looks healthy.
