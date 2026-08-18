# @tab/protocol

**Tier 0 · schema only · no I/O**

Zod schemas for every message Tab publishes to HCS, the version tag on each, and the canonical
serializer used to produce the ceiling input hash.

## Why schema-only

If this package could make a network call, the wire format could drift from what we actually
publish and nothing would catch it. Keeping it pure means the schema *is* the format: the
gateway writes through it, the indexer reads through it, and `tools/verify` — which a stranger
runs without our infrastructure — validates against the same file.

## Contents

| File | Holds |
|---|---|
| `src/messages/receipt.ts` | debit and credit receipts, both legs |
| `src/messages/ceiling.ts` | ceiling update: value, every input, tier, ramp, `MODEL_VERSION`, input hash |
| `src/messages/settlement.ts` | window net, transfer id, ramp change, outstanding carried |
| `src/messages/registration.ts` | agent registration, starter tab issuance, seller allowlist |
| `src/messages/refusal.ts` | a refused spend and the exact rule that fired |
| `src/canonical.ts` | deterministic serialization for hashing |
| `src/version.ts` | schema version constants and the compatibility policy |

## Invariants

- **Every message carries a schema version.** A topic is append-only and immutable; a v1 message
  written in week one must still parse in week three. Version from the first message, not from
  the first time it breaks.
- **Amounts are decimal strings on the wire**, parsed to `MicroUsdc` on read. See
  [@tab/money](../money/).
- **Canonical serialization is byte-stable**: keys sorted, no insignificant whitespace, no
  floats, explicit field ordering. `verify-ceiling` recomputes a hash from published inputs and
  compares — if serialization is not deterministic, that check fails for reasons unrelated to
  correctness, which is worse than not shipping it.
- **A refusal is a first-class message, not a log line.** The Refusals dashboard view is the
  product demonstrating that it works, so the reason code is structured data with a stable
  enum — not a human-readable string we later regret parsing.

## Open question for whoever picks this up

`x402-hedera-receipts` on npm already defines verifiable receipts for x402 on Hedera. Read it
before finalising the receipt schema. Matching an existing convention is cheaper than inventing
one, and it is a better story than a bespoke format.
