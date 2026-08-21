# apps/ — deployables

Five separately deployable processes. Each owns a Dockerfile-or-equivalent, an env schema, a
health check and a scaling profile. Libraries live in [`packages/`](../packages/).

The README's structure listed `gateway`, `engine` and `settlement` under `packages/`. They are
services, not libraries — different CI, different versioning, different release cadence from the
three packages we publish to npm. See [ADR-0001](../docs/adr/0001-monorepo-tiers.md).

| App | What it is | Scaling shape |
|---|---|---|
| [`gateway`](gateway/) | Fastify. Both x402 legs + self-hosted facilitator | latency-critical, horizontally scalable, stateless |
| [`engine`](engine/) | BullMQ worker. The slow path | throughput, one leader for ceiling publication |
| [`settlement`](settlement/) | BullMQ worker. Window tick + reconciler | one instance. Never two |
| [`cli`](cli/) | `npx @tab/cli`. Operator surface | n/a |
| [`web`](web/) | Next.js 16. **All three surfaces** — landing, console, docs | static-ish, read-only |

## Fast path and slow path never converge

The whole design rests on two paths at deliberately different speeds:

- **`gateway`** decides in under 50ms from a cache snapshot. It never computes a ceiling and
  never calls Mirror Node.
- **`engine`** computes ceilings in the background from Mirror Node and Postgres, then writes the
  snapshot the gateway reads.

They communicate through the Redis snapshot in one direction only. `boundaries.json` enforces the
half of this that is a dependency question; the rest is a review question.

## The asymmetry rule

`engine` may **shrink** a ceiling mid-window, instantly. It may **never grow** one mid-window.

Shrinking is a safety action. Growing is a trust action and waits for a clean settlement. Encode
it as a guarded transition with a test, not as a convention — it is the mechanism behind the
demo's central moment, where a ceiling collapses to zero mid-window and the next spend is refused.
