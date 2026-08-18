# ADR-0008 — The outer enforcement layer is an Agent Kit policy, not a hook

**Status:** Accepted · **Date:** 2026-08-18 · **Corrects** the README's "Agent Kit hooks" section

## Context

The README describes "Agent Kit hooks — the second enforcement layer", with a hook blocking a
spend at the tool boundary before it reaches the gateway.

Agent Kit v4's actual API, per its `HOOKS_AND_POLICIES.md`, separates the two:

- **Hooks** extend `AbstractHook` and their methods return `Promise<void>`. They observe. They
  **cannot block**.
- **Policies** extend `AbstractPolicy` and implement `shouldBlockPreToolExecution`,
  `shouldBlockPostParamsNormalization`, `shouldBlockPostCoreAction` or
  `shouldBlockPostSecondaryAction`. Returning `true` makes the base class throw and halts the
  tool lifecycle.

Both register through the **same `context.hooks` array**; there is no separate `policies` field.
Only tools extending `BaseTool` participate — v3-style object-literal tools do not.

## Decision

The outer enforcement layer is `TabCeilingPolicy extends AbstractPolicy`, implementing
`shouldBlockPostParamsNormalization` so it sees the normalised spend amount and seller.

A separate `TabAuditHook extends AbstractHook` observes and records tool calls. Both ship in
`@tab/agentkit-plugin` and both are registered into `context.hooks`.

Every method opens with `if (!this.appliesToMethod(method)) return`, per the documented
requirement that `relevantTools` be honoured explicitly.

## Consequences

**What we gain.** The two-layer defence claim is real: a prompt-injected agent is refused by the
policy without a network call, and a bypassed or misconfigured policy is refused again by the
gateway fast path. Neither layer trusts the other, which is what the README claims.

**Correction owed.** The README's Agent Surface section and its hook diagram must say *policy*
where they currently say *hook*, or the strongest security claim in the document is described
using an API that cannot do it. A judge who has read Agent Kit v4's docs will notice.

**Evaluate before building.** Agent Kit ships `HcsAuditTrailHook(tools, topicId)`, which writes
tool executions to an HCS topic. That may cover `TabAuditHook` entirely. Check it first — using
the ecosystem's own hook is a better story than writing our own.

**Constraint to remember.** Because only `BaseTool`-derived tools support policies, all four Tab
tools (`spend`, `quote`, `balance`, `ceiling`) must extend `BaseTool` or
`BaseTransactionTool`. A quick object-literal tool would silently opt out of enforcement.
