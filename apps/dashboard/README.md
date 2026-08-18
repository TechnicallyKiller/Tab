# @tab/dashboard

**Deployable · Next.js 15 · read-only · reads through `@tab/sdk` only**

The demo's visual surface. Six views.

| View | Shows |
|---|---|
| **Tab** | live balance, ceiling, available, pending holds, window countdown |
| **Ceiling** | current ceiling with every input broken out, tier, ramp, `MODEL_VERSION`, verify button |
| **Counterparties** | per counterparty: weight, why counted, why discounted, why rejected |
| **Receipts** | live HCS receipt stream, both legs, with request hashes |
| **Settlements** | window history, net amounts, ramp changes |
| **Refusals** | every refused spend with the exact rule that fired |

## Refusals is the most important view

It is not an error log. **It is the product demonstrating that it works.**

Design it accordingly: the rule that fired is the headline, the seller and price are context, and
the graph reason behind a control-cluster block is expandable. At 1:10 in the demo a ceiling
collapses mid-window and a spend is refused — this view is what is on screen for that, so it
carries the moment the whole pitch is built around. Build it early and treat it as a primary
surface, not the last page anyone gets to.

The **Ceiling** view's verify button matters for the same reason: it lets a judge recompute a
published ceiling from published inputs, live. That is the no-contract argument made visible.

## Contents

| Path | Holds |
|---|---|
| `src/app/(views)/*` | one route per view |
| `src/components/*` | shadcn/ui components |
| `src/lib/sdk.ts` | the single `@tab/sdk` client instance |
| `src/lib/stream.ts` | SSE subscription for the live receipt stream |

Stack: Next.js 15, Tailwind, shadcn/ui, TanStack Query, SSE for the receipt stream.

## Invariants

- **`@tab/sdk` only.** `boundaries.json` bans `@hiero-ledger/sdk`, `ioredis`, `drizzle-orm` and
  `bullmq` here. A browser bundle must not be able to reach a signing path or a database driver —
  and the agent-holds-no-key claim is weaker if the dashboard could sign.
- **Read-only.** No mutation from the browser. Operator actions live in the CLI, which is
  authenticated and audited.
- **Amounts are formatted by `@tab/money`.** Never `toFixed` in a component — 6-decimal
  micro-USDC formatted by hand will be wrong, and it will be wrong on screen during the demo.
- **Every view degrades visibly.** A stale stream shows as stale rather than as a frozen number.
  A number that has silently stopped updating is worse than a visible gap.
