# @tab/hedera

**Tier 2 · adapter · the ONLY package that may import `@hiero-ledger/sdk`**

Client construction, HCS topic creation and submission. HTS transfers and the HIP-423 schedule
builder are next.

## The SDK rule

Use `@hiero-ledger/sdk` (2.87.0). **Never `@hashgraph/sdk`.** Same project after a scope transfer,
both still publish, neither deprecated — so nothing stops you installing both, and installing both
breaks signing at request time rather than build time. `pnpm guard:sdk` rejects the wrong scope in
both dependencies and imports. See [ADR-0002](../../docs/adr/0002-single-hedera-sdk.md).

## Contents

| File | Holds |
|---|---|
| `src/client.ts` | client construction, key parsing, env validation |
| `src/topics.ts` | topic creation with a submit key, message submission |

## Working, verified on live testnet

`pnpm bootstrap` created three real topics on Hedera testnet and round-tripped a message through
consensus and back out via Mirror Node in ~2s.

**Topics carry a submit key.** Without one, anyone can write to the topic and a naive replay would
count their message as a receipt. The topic is an append-only log *Tab owns*.

## Two things that will cost you time

**Key formats.** The portal hands out DER (`302e…`); other tools hand out raw hex, with or without
`0x`. Getting it wrong produces `INVALID_SIGNATURE` at submit time, not a parse error at startup.
`parsePrivateKey()` accepts all of them for both ED25519 and ECDSA.

**No TypeScript parameter properties anywhere in this repo.** Packages are consumed as TS source and
tested under `node --experimental-strip-types`, which cannot handle them. `erasableSyntaxOnly` is on
in `tsconfig.base.json` so the compiler catches it instead of the runtime.

## Invariants

- **Nothing outside this package imports the SDK.** Two declared exceptions: `@tab/x402` (it wraps
  `@x402/hedera`, which builds transactions) and `agents/loop-attacker` (standing up a controlled
  seller is the attack).
- **Amounts crossing this boundary are `MicroUsdc`**, converted to SDK units at the last moment.
- **Every request is timeout-bounded.** A hung consensus call inside a spend is worse than a clean
  refusal, because the caller cannot tell it from a hang.
- **`clientFromEnv` refuses to start on a missing value** rather than dying on the first write.
- **Two accounts, two roles** — Hot Float signs per-request payments, Cold Treasury signs only
  top-ups. Do not add a path where Treasury signs inside a request.
  See [ADR-0003](../../docs/adr/0003-two-account-float.md).

## Not written yet

- **HTS transfers** — the spend leg and the settlement tick both need them.
- **HIP-423 schedule builder** — `expiration_time` + `wait_for_expiry` for the keeper-free tick.
- **Two-account float** — bootstrap still uses the operator for everything; Treasury and Hot Float
  are placeholders in `.env`.
- **HBAR balance monitoring** — we are the fee payer on the earn leg, so running out stops inbound
  payments while USDC still looks healthy.
