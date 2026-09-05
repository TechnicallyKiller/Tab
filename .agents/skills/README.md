# Vendored skills — hedera-dev/hedera-skills

Installed with `npx skills add hedera-dev/hedera-skills`. Committed so the whole team gets the
same reference material, and symlinked into `.claude/skills/` for Claude Code.

**Read them before use. They run with full agent permissions.**

## Load-bearing for Tab

| Skill | Why it matters here |
|---|---|
| **`x402-payments`** | The canonical Hedera x402 wiring — resource server, self-hosted facilitator, client retry loop. Two findings below came from it |
| **`hedera-consensus-service`** | Topic creation, submission, real-time subscription |
| **`hedera-token-service`** | HTS create/transfer/associate |
| **`agent-kit-plugin`** | Building the Agent Kit v4 plugin — `@tab/agentkit-plugin` |
| **`hedera-policy-creation`** | Policies block a tool call. Confirms [ADR-0008](../../docs/adr/0008-agentkit-policy-not-hook.md): enforcement is a policy, not a hook |
| **`hedera-hook-creation`** | Hooks observe and cannot block. Same ADR |
| **`hedera-hackathon-submission-validator`** | The official judging rubric and weights. See `docs/JUDGING.md` |
| **`hiero-cli`** | CLI for topics, tokens, transfers — useful for manual checks |

Irrelevant to us (other chains, other oracles): `ccip`, `layerzero-messaging`, `pyth-price-feeds`,
`supra-push-oracle`, `axelar-gmp`, `chainlink-data-feeds`. Left installed rather than pruned so a
re-install does not look like a diff.

## Two findings from `x402-payments` that changed our plan

**The canonical Hedera x402 path settles native HBAR, not an HTS token.**
`asset: "0.0.0"`, amounts in **tinybars** (1 HBAR = 1e8). `@x402/hedera` supports HTS tokens too —
`isValidHederaAsset` accepts both — but HBAR is the documented default. This means the x402 loop can
be proven with the HBAR we already hold, and does **not** block on obtaining testnet USDC.

**The facilitator fee payer must be a funded ECDSA account, separate from the seller.**
Hedera x402 settles with a `TransferTransaction` the buyer *partially* signs; the facilitator
co-signs as the advertised fee payer and submits until SUCCESS. This confirms
[ADR-0003](../../docs/adr/0003-two-account-float.md) from a second source, and adds a rule we did
not have: **the resource server must never hold the facilitator key.** Two processes, two keys.
