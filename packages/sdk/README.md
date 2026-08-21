# @tab/sdk

**Tier 3 · PUBLISHED to npm · thin HTTP client · browser-safe**

The TypeScript client every other surface is built on: `agentkit-plugin`, `mcp`, `cli`,
`dashboard`, and both demo agents.

## Thin on purpose

`boundaries.json` forbids `@hiero-ledger/sdk`, `ioredis` and `drizzle-orm` here. This package
speaks HTTP to the gateway and nothing else.

That constraint carries the product claim. The agent holds no key and signs nothing — so the
library it installs should not even be *able* to sign. If the SDK bundled the Hedera SDK, the
claim would rest on us not having used it. This way it rests on a check anyone can run.

Browser-safe matters too: `apps/web` imports this, and a browser bundle must not be able to
reach a signing path or a database driver.

## Surface

`spend` · `quote` · `balance` · `ceiling` · `receipts` · `register`

The same five verbs appear in the Agent Kit plugin and the MCP server. Define them once here.

## Contents

| File | Holds |
|---|---|
| `src/client.ts` | constructor, auth, retry, timeouts |
| `src/spend.ts` | the spend call, including the refusal shape |
| `src/quote.ts` | pre-flight quote without reserving |
| `src/state.ts` | balance, ceiling, available, pending holds, window countdown |
| `src/receipts.ts` | receipt history and the SSE stream the dashboard consumes |
| `src/errors.ts` | typed errors — refusal, unavailable, invalid |
| `src/types.ts` | re-exported from `@tab/protocol`. One definition, not two |

## Invariants

- **A refusal is a value, not an exception.** `spend()` returns a discriminated result carrying
  the rule that fired. Throwing on refusal pushes every consumer into `try/catch` and makes the
  Refusals view harder to build — and refusal is the demo, so it deserves a first-class type.
  Throw only for transport and protocol failures.
- **Amounts cross the wire as decimal strings**, parsed to `MicroUsdc` on the way in. `bigint`
  does not survive `JSON.stringify`.
- **Types are re-exported from `@tab/protocol`, never redefined.** A second copy will drift.
- **Retries are safe.** `spend` carries an idempotency key so a network retry cannot double-spend.
- **No key material in the constructor.** If the SDK ever accepts a private key, the whole claim
  is gone.

## Publishing

Versioned with changesets. Once an agent depends on this, breaking changes cost someone a
redeploy — so treat exports as a contract from the first release.
