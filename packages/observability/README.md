# @tab/observability

**Tier 2 · zero workspace dependencies · so every layer may depend on it**

Structured logging (pino), trace context, and metrics.

## What must be measured

The README makes two numeric claims. Both need to be observable, or they are assertions.

**Fast-path latency.** The budget is under 50ms. Record a histogram per stage of the six-step
check, not one total — when it regresses you need to know which step, and "the fast path got
slow" is not actionable. Alert on p99, not the mean.

**Refusal reasons.** Every refusal is counted by rule. The Refusals view is the product
demonstrating that it works, so the reason code must come from the same enum `@tab/protocol`
publishes — dashboard, HCS message, and metric label all agreeing.

Also track: HBAR balance on the fee-paying account (we facilitate the earn leg, so this stops
inbound payments if it empties while USDC looks healthy), hot float balance against its cap,
Mirror Node lag, indexer cursor age, and hold expiry rate.

## Contents

| File | Holds |
|---|---|
| `src/logger.ts` | pino, with redaction |
| `src/metrics.ts` | counters and histograms, with the label conventions |
| `src/trace.ts` | request id and correlation across gateway → engine → settlement |

## Invariants

- **Redact keys, always.** A Hedera private key is a DER string starting `302e` or `302a`. Add a
  pino redaction path and a serializer that refuses to print anything matching that shape.
  Someone will eventually log a config object.
- **Never log a full request body on the earn leg.** We front the agent's endpoint, so bodies are
  its customers' data.
- **Log the request hash, not the request.** The receipt schema carries a hash for exactly this
  reason.
- **No `console.log` outside `tools/` and `agents/`.** Enforced by biome.
