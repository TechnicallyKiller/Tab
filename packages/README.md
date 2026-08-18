# packages/ — libraries

Everything here is a library. Nothing here is deployed on its own. Deployables live in
[`apps/`](../apps/).

Three of these are published to npm and are therefore public API — `sdk`, `agentkit-plugin`,
`mcp`. Treat their exports as a contract and version them with changesets. The rest are
internal and can be refactored freely.

| Package | Tier | One line |
|---|---|---|
| [`money`](money/) | 0 | fixed-point micro-USDC. Zero dependencies |
| [`protocol`](protocol/) | 0 | HCS message schemas + canonical hashing |
| [`params`](params/) | 0 | versioned credit parameters behind `MODEL_VERSION` |
| [`ledger`](ledger/) | 1 | holds, entries, netting, interest, invariants — pure |
| [`scoring`](scoring/) | 1 | effective revenue → tier → ceiling — pure |
| [`graph`](graph/) | 1 | funding ancestry, control clusters — pure |
| [`hedera`](hedera/) | 2 | the only importer of `@hiero-ledger/sdk` |
| [`mirror`](mirror/) | 2 | Mirror Node REST client. Background only |
| [`cache`](cache/) | 2 | Redis: holds, snapshot, breaker. Fails closed |
| [`db`](db/) | 2 | Drizzle schema. A rebuildable projection |
| [`x402`](x402/) | 2 | adapter for client, server and facilitator roles |
| [`observability`](observability/) | 2 | logger, traces, metrics. Depends on nothing |
| [`fastpath`](fastpath/) | 3 | the sub-50ms check. Cache and memory only |
| [`sdk`](sdk/) | 3 | **published.** Thin HTTP client |
| [`agentkit-plugin`](agentkit-plugin/) | 3 | **published.** Agent Kit v4 plugin + policy |
| [`mcp`](mcp/) | 3 | **published.** MCP server |
| [`testkit`](testkit/) | 3 | fixtures, fake seller, fake payer. Dev-only |

Dependency rules are in [`boundaries.json`](../boundaries.json) and explained in
[docs/PACKAGE_MAP.md](../docs/PACKAGE_MAP.md). Adding a workspace dependency that is not in a
package's `allow` list fails CI.

## Before adding a package

A new package needs a **dependency rule that differs from its neighbours**. If it would have the
same allow list as an existing package, it is a directory inside that package, not a new one.
A package per file is a smell.
