# @tab/engine

**Deployable · BullMQ worker · the slow path · one leader for ceiling publication**

Mirror Node → Postgres → graph → scoring → publish ceiling to HCS → write the cache snapshot the
gateway reads.

```
Mirror Node ──▶ indexer ──▶ Postgres graph
                              │
                              ▼
                      recompute counterparty weights
                              │
                              ▼
                      recompute control clusters
                              │
                              ▼
              recompute effective revenue, score, tier
                              │
                              ▼
                    recompute ceiling ──▶ HCS
                              │
                              ▼
                       Redis snapshot ──▶ gateway fast path
```

Runs per window and on a new graph edge. It is allowed to be slow — that is the point of splitting
the paths.

## The asymmetry rule

**May shrink a ceiling mid-window, instantly. May never grow one mid-window.**

Shrinking is a safety action; growing is a trust action and waits for a clean settlement. Encode
it as a guarded state transition with its own test, not as a convention someone maintains.

This is the mechanism behind the demo's central moment: the graph catches a control edge, the
ceiling collapses to zero mid-window, and the very next spend is refused. If growth were also
immediate, the collapse would be one behaviour among many rather than a deliberate safety
property.

## Contents

| Path | Holds |
|---|---|
| `src/indexer/*.ts` | Mirror Node → Postgres, cursor management, idempotent writes |
| `src/jobs/window-tick.ts` | per-window recompute |
| `src/jobs/edge-discovered.ts` | incremental recompute on a new edge |
| `src/publish/ceiling.ts` | HCS ceiling message with every input + hash + `MODEL_VERSION` |
| `src/publish/snapshot.ts` | Redis snapshot write |
| `src/guards/asymmetry.ts` | the shrink-now / grow-later transition |

## Invariants

- **This is the only writer of the ceiling snapshot.** One writer, many readers.
- **Every input that influenced a ceiling is published to HCS**, plus the canonical input hash and
  `MODEL_VERSION`. If a number affected the output and is not in the message, `verify-ceiling`
  cannot reproduce it — and then the transparency claim is decoration.
- **A reason is published even when the ceiling does not change.** "Stayed capped because
  concentration" is information the operator needs; silence looks like a stuck engine.
- **Indexer writes are idempotent on `(topic, consensus_timestamp)`** and ordered by consensus
  timestamp, never by our own sequence numbers. A replay will happen.
- **Mirror Node lag is normal.** When it lags or pages out, the ceiling holds at its last computed
  value and the fast path is unaffected. Do not retry-loop waiting for history to catch up.
- **Ceiling computation delegates to `@tab/scoring` and `@tab/graph`** and adds no math of its own.
  Those packages are pure so a stranger can rerun them; logic that leaks into this app is logic
  nobody outside can verify.

## Scaling note

Indexing parallelises. **Ceiling publication must not run concurrently** — two workers publishing
for one agent produces two ceilings with the same inputs and different sequence numbers, which
makes the topic ambiguous. Use a BullMQ job key per agent so publication is serialised.
