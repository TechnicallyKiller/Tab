# @tab/protocol

**Tier 0 · schema only · no I/O**

Zod schemas for every message Tab publishes to HCS, the canonical serializer behind the ceiling
input hash, and the refusal-code enum.

## Why schema-only

If this package could make a network call, the schema could drift from what we actually publish and
nothing would catch it. Keeping it pure means the schema *is* the format: the gateway writes through
it, the indexer reads through it, and `tools/verify` — which a stranger runs with no access to our
infrastructure — validates against the same file.

Proven on testnet: `pnpm probe:protocol` writes a typed receipt to the real receipt topic, reads it
back through Mirror Node, and replays the whole topic.

## Two measured constraints shaped this

**Keep a message under 1KB.** Above roughly that, HCS splits the payload across chunks with their
own sequence numbers, and a lone chunk parses as truncated JSON — loud if you are lucky, silent if
you are not. So field names are short, nothing carries prose, and receipts hold **hashes and ids,
never payloads**. `encode()` refuses an oversized message rather than letting HCS chunk it, because
a topic is append-only and there is no migration for consensus. A realistic debit receipt is
**166 bytes**.

**Amounts are decimal strings with exactly six places.** `JSON.stringify` cannot serialise a bigint,
and a float would defeat `@tab/money` entirely. Rates are integer basis points for the same reason.
`canonicalize()` throws on a float rather than hashing something whose decimal form depends on the
writer.

## `decode()` returns a result, it does not throw

A replay walks an entire topic. One unrecognised message must not abort the reconstruction of
everything after it — and this is not hypothetical: the receipt topic already holds two
`bootstrap.hello` messages written before the schema existed. The replay skips them and reports the
count.

## Contents

| File | Holds |
|---|---|
| `common.ts` | shared field shapes, `SCHEMA_VERSION` |
| `messages.ts` | debit · credit · refusal · repair · ceiling · settlement · registration |
| `refusal-codes.ts` | the six codes, guidance, and which are retryable |
| `canonical.ts` | byte-stable serialization and the SHA-256 input hash |
| `wire.ts` | `encode` / `decode`, with the size limit enforced |

## Pinned by things outside this package

- **The six refusal codes** are rendered by `apps/web` and documented on the docs page. Changing one
  means changing the console, the docs and the topic together.
- **`ceilingInputs`** is what the CEILING view renders row by row, and what `verify-ceiling`
  recomputes. If a number affects the ceiling and is not in that object, the transparency claim is
  decoration.
- **`canonicalHash`** must stay reproducible forever. Key order is sorted, floats are rejected, and
  the model version travels with every ceiling so a historical one stays verifiable after the
  parameters change.

## Still to do

- `@tab/params` does not exist yet, so `model` is a free string rather than a pinned version.
- No `sequence` or `prev` field linking receipts — replay relies on consensus order, which is
  correct, but a gap-detection scheme may be wanted later.
- Registration and settlement schemas are written but never yet published by anything.
