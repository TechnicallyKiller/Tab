# @tab/web

**Deployable · Next.js 16 · all three surfaces · no backend yet**

One app, three route groups, one token layer:

| Route | Surface | Treatment |
|---|---|---|
| `/` | **tab.xyz** — the landing page | Editorial. 3D hero, scroll-choreographed flows, the attack |
| `/app/*` | **app.tab.xyz** — the operator console | Utilitarian. Eight views, latency-critical, zero page animation |
| `/docs` | **docs.tab.xyz** — the docs | Dense, typographically disciplined, near-zero motion |

Built from the Claude Design bundle in [`surface-selection-decision/`](../../surface-selection-decision/).
The design decisions behind it are in [docs/DESIGN_PROMPT.md](../../docs/DESIGN_PROMPT.md).

## Everything is mocked

There is no gateway, no engine and no Hedera connection yet. Every figure on every screen comes
from [`src/lib/mock/`](src/lib/mock/), which is deliberately shaped like the API that will replace
it — one module per view, exported as typed constants.

`src/lib/hooks/use-receipt-stream.ts` stands in for the gateway's SSE stream: it seeds from the
same fixture rows and then emits an arrival every 3.4s so the table, the balance and the refusal
stamp behave the way they will in the demo.

**When the gateway lands,** swap the mock modules for `@tab/sdk` calls. Nothing in
`src/components/` reads a mock directly except through a prop, so the components do not change.

## The rules this app is held to

- **`@tab/sdk` only.** `boundaries.json` bans `@hiero-ledger/sdk`, `ioredis`, `drizzle-orm`,
  `bullmq` and `postgres` here. A browser bundle must not be able to reach a signing path or a
  database driver — and "the agent holds no key" is a weaker claim if the dashboard could sign.
- **All money is `bigint` micro-USDC.** `src/lib/money.ts` carries the branded type. Display shows
  4 of 6 decimals and **truncates** — the docs promise it never rounds up, so the code means it.
  The prototype used floats; this does not. See
  [ADR-0006](../../docs/adr/0006-money-as-bigint.md).
- **Views do not animate.** No page transitions, no entrance animation on data. The only motion in
  the console is the value-change flash, the hold hatching, control presses, and the refusal stamp.
- **Every colour is a token.** Defined once on `:root` in `src/app/globals.css`, redefined for dark
  in both a `prefers-color-scheme` media query and a `[data-theme]` block, so the un-stamped
  system-default state renders correctly too.
- **Read-only.** No mutation from the browser. Operator actions belong in `@tab/cli`, which is
  authenticated and audited.

## Layout

```
src/
├── app/
│   ├── globals.css         tokens, primitives, motion, layout — the design system
│   ├── layout.tsx          fonts, no-flash theme script
│   ├── page.tsx            landing
│   ├── app/                console: layout + 8 views
│   └── docs/               docs: layout + page
├── components/
│   ├── ui/                 Card · Pill · Chip · Stamp · Hazard · Hops · Figure · CodeBlock
│   ├── landing/            hero scene, diagrams, flows, ceiling playground, attack, tape
│   ├── console/            shell, provider, capacity meter, receipt table
│   └── docs/               callouts, search palette
└── lib/
    ├── money.ts            bigint micro-USDC, truncating formatter
    ├── format.ts           consensus timestamps, sequence numbers, mm:ss
    ├── hooks/              theme, reduced motion, receipt stream
    └── mock/               every figure on every screen
```

## Commands

```bash
pnpm dev:web       # http://localhost:3000
pnpm build:web
pnpm --filter @tab/web typecheck
```

## Two components worth reading before you change anything

**`components/landing/hero-scene.tsx`** — the balance wire under a ceiling plane. It is the product
as one object: a balance that goes negative, bounded by a ceiling, resetting each window. The SVG
inside it is the real default (server-rendered, correct alone) and is only hidden once WebGL is
confirmed; reduced motion and any WebGL failure both keep it.

**`components/console/capacity-meter.tsx`** — outstanding solid, holds hatched, available sunk. The
hatching is load-bearing: a hold is money reserved but not yet spent, and colour alone cannot say
"provisional".

## Known gaps

- **Refusals filter counts are static.** They come from the fixture, not from the live stream, so
  they do not tick up as refusals arrive.
- **No `/app/agents` detail route.** The registry links back to `/app/tab` for every agent.
- **`⌘K` search is a fixture match**, not a real index.
- **HashScan links point at the topic**, not the individual message, because there is no real
  sequence number to deep-link yet.
