# @tab/agentkit-plugin

**Tier 3 · PUBLISHED to npm · Hedera Agent Kit v4 plugin + policy**

The distribution play. Any agent already built on Agent Kit gains a tab by installing this:
`spend`, `quote`, `balance` and `ceiling` appear as tools, with no wallet provisioning and no
funding step.

## Use the v4 scoped package

| Use | Do not use |
|---|---|
| `@hashgraph/hedera-agent-kit` — **4.1.0** (2026-08-04) | `hedera-agent-kit` unscoped — 3.8.2, v3 line |

v4 moved to the `@hashgraph` scope, split framework adapters into separate packages
(`-langchain`, `-ai-sdk`, `-elizaos`, `-adk`, `-mcp`), and requires plugins to be imported
explicitly — empty plugins means zero tools.

## Enforcement is a POLICY, not a hook

This is the correction that matters most, and the README currently gets it wrong.

In v4 these are different things:

| | Extends | Returns | Can block? |
|---|---|---|---|
| **Hook** | `AbstractHook` | `Promise<void>` | **No.** It observes |
| **Policy** | `AbstractPolicy` | `boolean` from `shouldBlock*` | **Yes.** Base class throws and halts the lifecycle |

Both register through the **same `context.hooks` array**. There is no separate `policies` field.

So Tab's outer enforcement layer is `TabCeilingPolicy extends AbstractPolicy`, implementing
`shouldBlockPostParamsNormalization` so it sees the normalised amount and seller.
See [ADR-0008](../../docs/adr/0008-agentkit-policy-not-hook.md).

## Two rules from the v4 docs that will bite

- **Every hook and policy method must open with `if (!this.appliesToMethod(method)) return`**, or
  `relevantTools` is ignored and the policy applies to every tool.
- **Only `BaseTool`-derived tools support hooks and policies.** A v3-style object-literal tool
  silently opts out of enforcement. All four Tab tools must extend `BaseTool` or
  `BaseTransactionTool`.

Tools implement three of seven lifecycle stages — `normalizeParams`, `coreAction`,
`secondaryAction` — and return `{ raw, humanMessage }`. A plugin is a plain object:
`{ name, version, description, tools: (context) => Tool[] }`.

## Contents

| File | Holds |
|---|---|
| `src/plugin.ts` | the `Plugin` object |
| `src/tools/spend.ts` | `BaseTool` subclass |
| `src/tools/quote.ts` | `BaseTool` subclass |
| `src/tools/balance.ts` | `BaseQueryTool` subclass |
| `src/tools/ceiling.ts` | `BaseQueryTool` subclass |
| `src/policies/ceiling-policy.ts` | `TabCeilingPolicy extends AbstractPolicy` |
| `src/hooks/audit-hook.ts` | observation only — **evaluate the built-in first** |

## Evaluate before building

Agent Kit ships `HcsAuditTrailHook(tools, topicId)`, which writes tool executions to an HCS topic,
and `HolAuditTrailHook` for HCS-2 registries. One of those may replace `audit-hook.ts` entirely.
Check first — using the ecosystem's own hook is a better story than writing our own, and this
package exists partly to be a good ecosystem citizen.

## Invariants

- **Two layers that do not trust each other.** A prompt-injected agent is refused by this policy
  with no network call. A bypassed or misconfigured policy is refused again by the gateway fast
  path. Neither is the only line of defence, and the tests should demonstrate both independently.
- **Built on `@tab/sdk`, never on internals.** It is published; it cannot reach into `fastpath`
  or `db`.
- **The policy refuses fast and locally.** It exists to avoid a network round trip, so it must not
  make one.
