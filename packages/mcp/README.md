# @tab/mcp

**Tier 3 · PUBLISHED to npm · MCP server**

`spend`, `quote`, `balance`, `ceiling` and `receipts` as MCP tools, so an agent in any
MCP-capable runtime can transact on a tab with no bespoke code.

## Scope check before building

`@hashgraph/hedera-agent-kit-mcp@1.1.0` already exists and exposes Agent Kit tools over MCP. If
`@tab/agentkit-plugin` is loaded into it, Tab's tools may appear over MCP with no separate server
from us.

**Decide which of these we are shipping, and write it down here:**

1. A standalone Tab MCP server (this package as described) — one install, no Agent Kit dependency
   for MCP users.
2. Documentation for loading our plugin into the official Agent Kit MCP server — less code, less
   surface, and a better ecosystem story.

Option 2 may be the better answer, and finding that out costs an hour. Do that before writing a
server. Record the decision as an ADR.

## Contents (if we ship option 1)

| File | Holds |
|---|---|
| `src/server.ts` | MCP server, stdio and HTTP transports |
| `src/tools/*.ts` | one file per verb, thin wrappers over `@tab/sdk` |
| `src/resources.ts` | receipts and refusals exposed as MCP resources |

## Invariants

- **Same verbs, same semantics as `@tab/sdk` and the Agent Kit plugin.** Three surfaces, one
  behaviour. Divergence between them is a support burden and a demo risk.
- **A refusal is a structured tool result, not an error.** An MCP client should be able to show
  the agent *why* it was refused so it can choose different work — which is the point of refusing
  instead of failing.
- **No key material anywhere in this package.** Same rule as the SDK.
