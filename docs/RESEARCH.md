# Research Findings — Dependency Reality Check

Verified against live npm registry metadata and published type definitions on **2026-08-18**.
Read this before writing code. Six findings change the build; three de-risk it.

---

## Verified package versions

| Package | Version | Last publish | Verdict |
|---|---|---|---|
| `@hiero-ledger/sdk` | **2.87.0** | 2026-08-12 | **Use this.** Active line. |
| `@hashgraph/sdk` | 2.81.0 | 2026-03-13 | Stale. Same repo, old scope. Do not use. |
| `@hashgraph/hedera-agent-kit` | **4.1.0** | 2026-08-04 | v4 confirmed. New `@hashgraph` scope. |
| `hedera-agent-kit` (unscoped) | 3.8.2 | 2026-03-21 | v3 line. Dead end. |
| `@x402/core` · `@x402/hedera` | **2.22.0** | 2026-08-11 | **Use these.** |
| `x402` (unscoped) | 1.2.0 | 2026-04-16 | Older single-package line. Do not use. |
| `@hashgraph/hedera-agent-kit-mcp` | 1.1.0 | 2026-08-04 | An official MCP server already exists. |

---

## Finding 1 — The Hedera SDK moved scope. Mixing the two scopes breaks signing silently.

`@hashgraph/sdk` was transferred to the Hiero project and republished as `@hiero-ledger/sdk`.
Both scopes still publish; neither is marked deprecated on npm, so nothing stops you installing both.

Both of our load-bearing dependencies already resolve `@hiero-ledger/sdk`:

- `@x402/hedera@2.22.0` → `@hiero-ledger/sdk@2.85.0`, `@hiero-ledger/proto@2.31.0`
- `@hashgraph/hedera-agent-kit` v4 docs import `Client` from `@hiero-ledger/sdk`

**Why this is a correctness issue, not a style issue.** Two copies of the SDK in the graph
means two distinct `Transaction`, `AccountId` and `PrivateKey` classes. `instanceof` returns
false across the boundary, and a partially-signed transfer handed from our code to
`@x402/hedera` fails to serialize with an unhelpful error — at request time, not build time.

**Action:** pin `@hiero-ledger/sdk` in the pnpm catalog and root `overrides`. Ban
`@hashgraph/sdk` in CI alongside the `.sol` ban. See [ADR-0002](adr/0002-single-hedera-sdk.md).
README stack section needs updating.

## Finding 2 — x402 is now a scoped multi-package family, and it ships a Hedera facilitator

`@x402/hedera@2.22.0` exports exactly three entry points:

```
@x402/hedera/exact/client       — build the partially-signed transfer (buyer)
@x402/hedera/exact/server       — price parsing, payment requirements (seller)
@x402/hedera/exact/facilitator  — verify + settle (submits the transaction)
```

Tab plays **all three roles**, which is why `packages/x402` exists as one adapter rather than
being scattered across the gateway.

**We can self-facilitate the earn leg.** The facilitator class is exported and constructible
from our own signer. This turns the README's Probe 2 fallback into the primary plan and
removes "facilitator down" as a risk on the earn leg. On the spend leg we are the client and
must still use whatever facilitator the seller advertises.
See [ADR-0004](adr/0004-self-hosted-facilitator.md).

## Finding 3 — The exact scheme's signing model conflicts with a threshold KeyList on the float

From the published types, the Hedera `exact` flow is:

1. **Client** builds a `TransferTransaction`, signs it as the debited party, base64-encodes it
   into `ExactHederaPayloadV2 = { transaction: string }`.
2. **Facilitator** decodes it, verifies transfer semantics via `inspectHederaTransaction`,
   and **submits it as fee payer** (`getExtra()` returns `feePayer`).

So on the **spend leg**, the account paying the seller must produce a signature **per request,
inside the request**. The README puts the house float on a threshold `KeyList`. That would put
an m-of-n signature collection inside a path budgeted at under 50ms.

**Resolution — split the float into two accounts.** This keeps the security claim honest and
the latency budget achievable. See [ADR-0003](adr/0003-two-account-float.md) and [KEYS.md](KEYS.md).

| Account | Key | Holds | Signs |
|---|---|---|---|
| **Cold Treasury** | threshold `KeyList` | the bulk | top-ups to Hot Float, nothing per-request |
| **Hot Float** | single key | a capped working balance | every spend-leg x402 payment, the settlement tick |

The blast radius of the hot key is bounded by its balance, and that bound is a published number.
This is a real change to the README's Trust and Security Model section, which currently claims
a threshold KeyList protects the paying account.

## Finding 4 — Testnet USDC token id is confirmed correct

`@x402/hedera` exports these as constants, so the README's value needs no probe to confirm:

```
HEDERA_TESTNET_USDC   = "0.0.429274"
HEDERA_MAINNET_USDC   = "0.0.456858"
HEDERA_USDC_DECIMALS  = 6
HEDERA_TESTNET_CAIP2  = "hedera:testnet"
HEDERA_MAINNET_MIRROR_NODE_URL / HEDERA_TESTNET_MIRROR_NODE_URL
```

Import them rather than re-declaring them in our env file. `hedera:testnet` as the CAIP-2
network id is confirmed, as is 6-decimal USDC — so all money is `bigint` micro-USDC.

## Finding 5 — Token association is partly handled for us

`@x402/hedera` exports `createHederaPreflightTransfer()`, which checks via Mirror Node that
the payer holds enough of the asset **and** that `payTo` is either associated with the token
or has a free auto-association slot. Its own doc comment notes that consensus-node token
queries no longer return association data dependably — Mirror Node is the source.

This does not remove Probe 3; our own accounts still need association at bootstrap. It does
mean a seller that forgot to associate fails at preflight with a reason rather than silently.

## Finding 6 — Agent Kit v4's real extension API (this differs from the README's description)

Confirmed from `docs/PLUGINS.md` and `docs/HOOKS_AND_POLICIES.md`:

- A plugin is a plain object: `{ name, version, description, tools: (context) => Tool[] }`.
- Tools extend `BaseTool` / `BaseTransactionTool` / `BaseQueryTool` and implement only three
  of seven lifecycle stages: `normalizeParams`, `coreAction`, `secondaryAction`.
- **Hooks and policies register through the same `context.hooks` array. There is no separate
  `policies` field.** The README implies two systems; it is one array.
- Blocking is done by a **policy**, not a hook: extend `AbstractPolicy`, implement
  `shouldBlockPreToolExecution` / `shouldBlockPostParamsNormalization` /
  `shouldBlockPostCoreAction` / `shouldBlockPostSecondaryAction`; returning `true` makes the
  base class throw and halt the lifecycle. Hooks return `void` and cannot block.
- Every hook and policy method must open with `if (!this.appliesToMethod(method)) return`.
- Only `BaseTool`-derived tools support hooks and policies. v3 object-literal tools do not.
- There is a built-in `HcsAuditTrailHook(tools, topicId)` that writes tool executions to an
  HCS topic. Worth evaluating before we write our own audit hook.

**Action:** the README's "Agent Kit hooks — the second enforcement layer" section should say
**policy**, since a hook cannot refuse a spend. Our outer enforcement layer is a
`TabCeilingPolicy extends AbstractPolicy`.

---

## Confirmed as described in the README

- **HIP-423 long-term scheduled transactions** shipped in mainnet v0.57. `expiration_time`
  and `wait_for_expiry` behave as the README states: with `wait_for_expiry: true` the
  transaction is evaluated at expiry rather than when the last signature lands. The README's
  caveat is also correct and worth keeping — a schedule fires once and expires; this is not cron.
- **HCS-14 UAID** exists as a Hashgraph Online standard (announced 2025-09-11, status Draft),
  dual-method DID scheme, available via `@hashgraphonline/standards-sdk`. Correctly scoped as
  a bonus tier, not v1 — a Draft standard is not a foundation.

## Adjacent prior art worth knowing

Searching npm for Hedera x402 packages surfaces work in the same neighbourhood:

| Package | What it does | Relationship to Tab |
|---|---|---|
| `@x402-guard/hedera`, `@zero-two-labs/hedera-x402-guard` | spend guardrails and per-agent policies for x402 on Hedera | **Closest prior art.** Both cap spending of money the agent already holds. Tab's claim is the opposite direction: the agent holds nothing and spends money it does not yet have. Be precise about this in the pitch — a judge who knows these will ask. |
| `x402-hedera-upto` | the x402 `upto` scheme for usage-based metered payments | Semantically nearer to "a running tab" than `exact` is. Out of scope for v1 — `exact` on both legs keeps the "unmodified seller" property — but note it in the roadmap. |
| `x402-hedera-receipts` | signed offers and verifiable receipts for x402 on Hedera | Overlaps our HCS receipt topic. Check the shape before finalising our schemas; matching an existing convention is cheaper than inventing one. |

## Open questions for Phase 0

These could not be settled from package metadata and belong in the probes:

1. Which public facilitator, if any, currently advertises `hedera:testnet` in `/supported`
   — needed for the **spend** leg, where we are the client. Self-facilitating does not help here.
2. Do the demo sellers we point at accept HTS USDC, or only HBAR? `@x402/hedera` supports both
   (`HBAR_ASSET_ID = "0.0.0"`).
3. Testnet USDC faucet availability at `0.0.429274`. Fallback remains: mint our own 6-decimal
   HTS token.
4. Mirror Node lag under load, and whether 100-row pages hold at our receipt volume.
