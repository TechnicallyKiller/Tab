# @tab/scoring

**Tier 1 · pure functions · MUST NOT touch the database**

Effective revenue → tier → ceiling. The novel engineering in the project, and the part a judge
will actually interrogate.

## Purity is a product requirement here, not a preference

`verify-ceiling` claims a stranger can recompute a published ceiling and check the hash. A
stranger has HCS, the public Mirror Node, and this repo. **They do not have our Postgres.**

So if this package could read the database, the claim would quietly become false, and nobody
would find out until someone tried it — which, at a hackathon, is a judge. `boundaries.json`
bars `scoring` from `db`, `cache`, `mirror` and `hedera` for exactly this reason. The caller
gathers inputs; this package computes.

This is also why `scoring` and `graph` are separate packages from `apps/engine` rather than
directories inside it, as the README's structure had them. See
[docs/PACKAGE_MAP.md](../../docs/PACKAGE_MAP.md).

## The formula being implemented

```
ceiling = trailing_attested_revenue_per_window
        × tier_multiple
        × ramp_factor
        , clamped by hard_cap[tier]

  tier_multiple   A 3.0 · B 2.0 · C 1.0 · Unrated 0
  base APR        A 6%  · B 8.5% · C 12% · Unrated n/a
  ramp_factor     starts 15%, +15% per clean settlement, −30% per missed, clamped [0, 100%]
```

`trailing_attested_revenue_per_window` counts only inflows with a matching HCS gateway receipt,
averaged over the last N windows. Unattested inflows count at a **0.6 discount** — money arrived,
but nobody can prove a purchase happened.

**Any default collapses the agent to Unrated**, which sets `tier_multiple = 0` and therefore the
ceiling to zero. There is no partial credit for a default.

## Contents

| File | Holds |
|---|---|
| `src/effective-revenue.ts` | attested vs unattested weighting, trailing window average |
| `src/tier.ts` | revenue bands + counterparty diversity bonus + settlement history → tier |
| `src/ramp.ts` | ramp factor state machine: +15% clean, −30% missed, clamp `[0, 100%]` |
| `src/ceiling.ts` | assemble the formula, apply the tier hard cap |
| `src/inputs.ts` | the input record — exactly what gets published to HCS and hashed |

## Invariants

- **Every input to a ceiling is published.** If a number influences the result and is not in the
  HCS ceiling message, `verify-ceiling` cannot reproduce it and the transparency claim fails.
  `src/inputs.ts` is the contract: if it is not in that type, it may not affect the output.
- **Deterministic.** Same inputs, same `MODEL_VERSION`, same output, byte for byte. No clock
  reads, no randomness, no map-iteration-order dependence.
- **The asymmetry rule.** This package computes a value; it does not decide when to apply it.
  The slow path in `apps/engine` may **shrink** a ceiling mid-window instantly, and may
  **never grow** one mid-window. Shrinking is a safety action, growing is a trust action and
  waits for a clean settlement. Encode that as a guarded transition in the engine, and test it.
- **`MODEL_VERSION` accompanies every result.** A ceiling without the version it was computed
  under is unverifiable.

## Definition of done

Table-driven tests straight off the formula, plus these specific cases because they are the ones
that get argued about:

- an agent with revenue but a default → Unrated, ceiling exactly zero
- ramp at the `[0, 100%]` clamp boundaries in both directions
- an agent whose entire revenue is unattested → ceiling reflects the 0.6 discount and nothing else
- the tier hard cap binding before the formula result does
- a ceiling recomputed from a published HCS input record, hash-matching the published hash
