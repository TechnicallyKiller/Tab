# Package Map and Dependency Rules

The structure is a tier system. **A package may depend on lower tiers and never on higher ones.**
The machine-readable form is [`boundaries.json`](../boundaries.json); `pnpm guard:boundaries`
fails CI on violation. That file is the architecture — this document is why.

```
tier 5  leaf        probes · bootstrap · verify · honest-agent · loop-attacker
tier 4  apps        gateway · engine · settlement · cli · dashboard
tier 3  composed    fastpath · sdk · agentkit-plugin · mcp · testkit
tier 2  adapters    hedera · mirror · cache · db · x402 · observability
tier 1  domain      ledger · scoring · graph
tier 0  pure        money · protocol · params
```

---

## Two decisions that differ from the README's structure

### `apps/` holds deployables; `packages/` holds libraries

The README lists `gateway`, `engine` and `settlement` under `packages/`. They are three
separately deployable processes with their own Dockerfile, env schema, health check and scaling
profile. Publishable libraries and deployable services want different CI, different versioning
and different release cadence. Splitting them is standard practice and it costs nothing to do
now versus a painful move later.

### `engine` is split into `graph` + `scoring` (pure) and `apps/engine` (the worker)

The README nests `indexer/`, `graph/`, `scoring/` and `fastpath/` inside one `engine` package.
Those four have **incompatible dependency rules**, and collapsing them makes the README's own
architectural bans unenforceable:

- `fastpath` must never reach Mirror Node or Postgres. In one package with the indexer, the
  import is one keystroke away and nothing catches it.
- `scoring` and `graph` **must be pure** so that `tools/verify` can recompute a published
  ceiling from HCS plus Mirror Node alone. This is not a preference — it is the
  `verify-ceiling` product claim. A stranger has no access to our Postgres. If scoring can
  read the database, the claim quietly becomes false and nobody notices until a judge tries it.

So the split is not tidiness. Each boundary exists to make a promise in the README mechanically
true.

---

## The three bans, and what enforces each

| Ban | Stated in README as | Enforced by |
|---|---|---|
| Fast path never touches Mirror Node | "architectural ban, not a performance target" | `fastpath` cannot declare `mirror`, `db`, `hedera`, `x402`, `graph` or `scoring` |
| Ceiling is independently recomputable | `verify-ceiling` ships for exactly this | `verify` cannot declare `db`, `cache`, `fastpath` or `sdk` |
| No Solidity | "CI fails the build if one appears" | `guard:solidity` — no `.sol`, no EVM tooling deps |

Two more we add:

| Ban | Why | Enforced by |
|---|---|---|
| One Hedera SDK | two copies break `instanceof` and signing fails at request time | `guard:sdk` |
| No floating-point money | a ledger that does not reconcile to the cent has no product | `guard:money` |

---

## Package roster

### Tier 0 — pure

| Package | Responsibility | Depends on |
|---|---|---|
| `money` | branded fixed-point micro-USDC (`bigint`, 6dp), parse/format/compare. Zero dependencies. | — |
| `protocol` | zod schemas for every HCS message, version tags, canonical serializer for the ceiling input hash. Schema-only, no I/O. | `money` |
| `params` | versioned credit parameters — tier multiples, APRs, ramp steps, caps, `AGE_FULL_DAYS`, starter tab — behind a pinned `MODEL_VERSION`. | `money` |

### Tier 1 — domain logic (pure functions, caller supplies the data)

| Package | Responsibility | Depends on |
|---|---|---|
| `ledger` | holds, debits, credits, window netting, interest accrual, invariant assertions | `money`, `protocol` |
| `scoring` | effective revenue → tier → ceiling | `money`, `protocol`, `params` |
| `graph` | funding ancestry, control clusters, counterparty weights | `money`, `protocol`, `params` |

### Tier 2 — adapters (the only packages that do I/O)

| Package | Responsibility | Depends on |
|---|---|---|
| `hedera` | the only importer of `@hiero-ledger/sdk`. Client, HTS transfer, HCS submit/read, HIP-423 schedule builder | `money`, `protocol`, `observability` |
| `mirror` | Mirror Node REST client — typed, paginated, timestamp-ranged. Separate from `hedera` so the fast path can use consensus code without inheriting history calls | `money`, `protocol`, `observability` |
| `cache` | Redis: holds, ceiling snapshot, circuit breaker. Fails closed by contract | `money`, `protocol`, `observability` |
| `db` | Drizzle schema and migrations for the graph and read models. A rebuildable projection; HCS is truth | `money`, `protocol`, `observability` |
| `x402` | adapter over `@x402/core` + `@x402/hedera` for all three roles: client, resource server, facilitator | `money`, `protocol`, `hedera`, `observability` |
| `observability` | pino logger, trace context, metrics. Depends on nothing so anything may depend on it | — |

### Tier 3 — composed

| Package | Responsibility | Depends on |
|---|---|---|
| `fastpath` | the sub-50ms check. Cache and memory only | `money`, `protocol`, `params`, `ledger`, `cache`, `observability` |
| `sdk` | public TypeScript client. Thin, browser-safe, HTTP only | `money`, `protocol`, `params` |
| `agentkit-plugin` | Agent Kit v4 `Plugin` + `TabCeilingPolicy extends AbstractPolicy` | `money`, `protocol`, `sdk` |
| `mcp` | MCP server exposing the same verbs | `money`, `protocol`, `sdk` |
| `testkit` | fixtures, fake x402 seller, fake payer, deterministic clock, testcontainers helpers. Dev-only | tiers 0–2 |

### Tier 4 — deployable apps

| App | Responsibility |
|---|---|
| `gateway` | spend leg (x402 client), earn leg (resource server), self-hosted facilitator, receipt writer, hold manager |
| `engine` | slow path worker: index → graph → score → publish ceiling → write cache snapshot |
| `settlement` | window tick, HIP-423 schedule construction, reconciler |
| `cli` | operator surface |
| `web` | Next.js. Reads through `sdk` only |

### Tier 5 — leaf

| Tool | Responsibility |
|---|---|
| `probes` | Phase 0. Writes `docs/probes.md`. Runs before anything else exists |
| `bootstrap` | create topics, associate USDC, fund hot float, register demo sellers |
| `verify` | `verify-tab` and `verify-ceiling`. **The trust artifact** — must run for a stranger |
| `honest-agent` | demo agent. Cannot import the Hedera SDK, because holding no key is the claim |
| `loop-attacker` | demo adversary. **Does** get the SDK — standing up a controlled seller is the point |

---

## Why `honest-agent` is banned from the Hedera SDK

The demo's central claim is that the agent holds no key and signs nothing. If `honest-agent`
can import `@hiero-ledger/sdk`, that claim rests on us not having used it. With the import
banned in `boundaries.json`, the claim rests on a check anyone can run. Same reasoning as
`verify`: prefer a promise a stranger can confirm over a promise we assert.
