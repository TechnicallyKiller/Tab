# Design Prompt — Tab

Paste any single section into Claude to build that surface. Section 1 is the shared
foundation and should be included with every request.

---

# 1 · FOUNDATION — include this with every surface

## What Tab is

Tab is a credit rail for autonomous AI agents, on Hedera. Read this before designing
anything, because the product's argument dictates the visual argument.

The agentic economy has payment rails and no credit rails. An agent pays for inference,
data and APIs *before* anyone has paid it, so its balance is structurally behind its
earning capacity. The only fix on offer today is "put USDC in a wallet first" — which
means a freshly deployed agent's first act is to fail.

Tab removes the wallet. A gateway sits in front of the agent on both legs of its
economic life: when the agent buys, the gateway pays the seller from house float and
debits a running balance; when the agent sells, the gateway fronts its endpoint,
collects payment, and credits that balance. Once per window the net settles in a single
transfer. The agent never holds USDC, never signs a payment, never borrows and never
repays. It spends and earns. **The ceiling on how negative that balance can go is the
credit product.**

Four things follow, and each is a design constraint:

- **The agent holds nothing**, so there is nothing to steal. The blast radius of a
  prompt injection is "the gateway refused."
- **The gateway sees every spend before it happens** and can refuse in-flight,
  mid-window, on the call that would have caused the loss.
- **Revenue is attested, not inferred** — the gateway knows an inbound payment
  corresponds to a request it served.
- **Ten thousand calls become one transfer.**

The verbs matter. Not borrow and repay — **spend and earn**. The credit object is not a
loan with a term; it is a ceiling on a running balance. That is how trade credit has
always worked between businesses.

**Refusal is the product.** Not an error state, not a failure path — the demonstration
that underwriting works. Design every surface with that inverted: where a normal fintech
hides declines, Tab features them.

## Audience

Three readers, one per surface, and they want different things:

- **Landing** — a developer or founder who deploys agents and has personally hit the
  "fund the wallet" wall. Skeptical of crypto marketing. Wants to know in fifteen
  seconds whether this is real.
- **App** — an operator watching an agent transact with their money. Scanning, not
  reading. Needs state at a glance and the reason behind every decision.
- **Docs** — an engineer integrating. Wants a copyable snippet in under a minute and
  exact semantics after that.

## The governing rule

**Playful in the frame. Serious in the numbers.**

Blend neobrutalism with institutional finance restraint — but do not average them into
mush. Divide them by role:

**Structure and interaction is neobrutalist.**
- `2.5px` solid ink borders on every container. No hairlines, no shadow-as-border.
- Hard offset shadows, zero blur: `6px 6px 0 var(--ink)`. Interactive elements displace
  on press — `translate(-2px,-2px)` with a `5px 5px 0` shadow on hover,
  `translate(2px,2px)` with `1px 1px 0` on active.
- Tight radii: `0`–`4px`. Cards are square. Only status pills go fully round.
- Rotation at most once per viewport, never exceeding 2°, and only on something that
  reads as a physically stuck-on object — a stamp, a sticker, a tag.

**Data and figures are institutionally restrained.**
- Every digit in mono with `font-variant-numeric: tabular-nums`. Columns align or they
  lie.
- One accent hue in the entire product. Semantic colour is separate and means exactly
  three things.
- Dense tables, generous line-height, never one-card-per-row.
- Zero decoration inside a figure. No gradient on a balance, no glow on a total, no
  animated count-up on money.

The chrome may have a sense of humour. The money never does.

## Palette

Derived from the object Tab is named after: a paper tab, written in pen, on the pale
green stock that ledger tallies were printed on. Alternating table rows use greenbar
striping — a real bookkeeping convention, not a style flourish.

```css
:root{
  /* ground */
  --paper:#E7EBE0;      /* page ground — greenbar ledger stock, NOT cream */
  --surface:#FBFCF8;    /* raised cards */
  --sunk:#DDE3D4;       /* table stripe, card headers, inset wells */

  /* ink */
  --ink:#14180F;        /* all text, all borders — green-biased black */
  --ink-2:#3D4636;      /* secondary text */
  --ink-3:#6B7462;      /* muted, labels, timestamps */
  --rule-soft:#B9C2AC;  /* inner table rules only, never a container edge */

  /* the only accent */
  --pen:#1F3A93;        /* links, ceiling values, weight bars, focus rings */
  --pen-soft:#DDE3F5;

  /* semantic — three meanings, no more */
  --credit:#17703F;     /* balance positive, settled clean */
  --debit:#9E2B18;      /* balance negative */
  --caution:#F2C230;    /* held, refused, primary action */

  --shadow:6px 6px 0 var(--ink);
  --shadow-sm:3px 3px 0 var(--ink);
  --bw:2.5px;
}
```

Dark theme is a **carbon copy**, not an inversion — ground `#12150E`, surface `#1B1F16`,
ink `#E8EDE0`, pen lifted to `#9DB4F7`, credit `#5FCB8B`, debit `#F0846C`, caution
unchanged. Define every colour as a token on bare `:root`, redefine only the tokens for
dark, and never set a colour inside a component that is not a token reference.

**Two rules about colour that carry the pitch:**

**Negative is not red-as-broken.** A tab going negative is the product working exactly
as designed. Debit brick is a colour of record, not of alarm. Reserve alarm for caution
yellow, which means *held*.

**Do not use cream-and-mint or coral.** Those palettes belong to adjacent products —
bloopa.xyz (cream `#FDFBF7`, mint `#bbf7d0`, indigo `#6366f1`, Syne + Caveat + VT323)
occupies the same category as Tab, and Maple owns institutional coral `#FC7A4A`.
Borrowing either reads as derivative.

## Typography

Three faces, three jobs, all on Google Fonts.

```
Display   Bricolage Grotesque   700–800   letter-spacing -0.03em
Body/UI   Public Sans           400–700   letter-spacing 0
Figures   IBM Plex Mono         400–600   tabular-nums
```

`IBM Plex Mono` carries **every** number, account id, consensus timestamp, sequence
number, basis-point value and hash. Public Sans is designed for the US government's own
design system — institutional by origin, plain by intent. Bricolage Grotesque has
character without tipping into cartoon.

No handwriting face and no pixel face. The approachability you want comes from geometry
and shadow, not from a script font.

Type scale, and stay on it:
`11 / 12.5 / 14 / 16 / 19 / 24 / 32 / 44 / 68 / 104`
Running text at 16px, `max-width: 65ch`. Uppercase mono labels at 11px with
`letter-spacing: 0.13em`. Headings get `text-wrap: balance`.

## Motion system

Motion earns its place by explaining a mechanism or confirming an action. Ambient
decorative movement is forbidden — it makes a financial product feel unserious, which
is the exact failure mode of mixing in a comic register.

```
instant     0ms      state changes in the app. Views do not transition
snap        90ms     cubic-bezier(.2,0,.4,1)    button press, pill toggle
settle      220ms    cubic-bezier(.2,.7,.3,1)   panel open, row expand
draw        700ms    cubic-bezier(.3,0,.2,1)    a line or path drawing itself
stamp       420ms    cubic-bezier(.3,1.5,.4,1)  overshoot — stamps only
ledger      1500ms   ease-out                   value-change flash, then decay
```

Named behaviours to implement once and reuse:

- **`flash-credit` / `flash-debit`** — when a figure changes, tint its row background
  green or brick at 12% opacity and decay over 1500ms. This is how a ledger shows
  movement without animating the digits themselves. Never animate the number.
- **`stamp-down`** — a refusal stamp scales from 1.4 to 1 with rotation settling to
  −8°, on the `stamp` curve, once. No repeat, no pulse.
- **`draw-path`** — `stroke-dashoffset` from full to zero. Used for the balance wire,
  funding-hop arrows, and the settlement flow.
- **`tape-scroll`** — a linear, infinite, 40-second marquee of real receipt rows.
  Landing page only. Pauses on hover and on `prefers-reduced-motion`.
- **`hold-hatch`** — pending holds render as 45° diagonal hatching that translates
  slowly, 3s linear infinite. The only permitted ambient loop, because it signals
  "in flight".

Every animation needs a `prefers-reduced-motion: reduce` branch that resolves to the
final state instantly. For the 3D hero, that branch renders a static composed frame.

## Accessibility, non-negotiable

- **State reads as form, not only colour.** Hazard stripes, diagonal hatching, outline
  stamps, border weight. Every status must survive a greyscale screenshot.
- Focus visible everywhere: `3px solid var(--pen)`, `outline-offset: 3px`.
- Body text ≥ 4.5:1, large display ≥ 3:1, on both themes.
- Tables get real `<th scope>`; live regions announce receipt arrivals politely.
- Full keyboard operation. Nothing hover-only.

---

# 2 · SURFACE ONE — tab.xyz, the landing page

Editorial treatment. This page is a thesis, not a brochure. A skeptical developer gives
it fifteen seconds; the hero has to land the whole idea in that window.

## 2.1 The hero — 3D, and it is the product

**Concept: the balance wire under a ceiling plane.**

Build in react-three-fiber. A single continuous tube, drawn along a spline, running left
to right across the frame — this is one agent's running balance over a window. It starts
at a horizontal zero plane, dips **below** it as the agent spends, climbs back **above**
as it earns, and at the right edge snaps back to exactly zero as the window settles.

Above the wire floats a translucent horizontal plane: **the ceiling**. The wire's lowest
dip approaches it from below but never crosses it. Sub-surface, a faint greenbar grid
recedes toward the horizon.

That is Tab's entire mechanism as one object: a balance that goes negative, bounded by a
credit ceiling, resetting each window.

Specification:
- Tube of radius ~0.06 along a `CatmullRomCurve3` of 8–10 control points, ~200 segments.
- Below the zero plane the tube is `--debit`; above it, `--credit`. Colour by sign, on
  the geometry, so the meaning is in the object.
- The ceiling plane is `--pen` at 0.12 opacity with a `2.5px`-equivalent solid edge line
  at full opacity, so it reads as a hard limit rather than a haze.
- Zero plane is a single ink line, full width, no fill.
- Lighting: one directional key from upper left plus low ambient. Matte, unlit-adjacent
  materials — no metalness, no environment reflections. This should look like a
  technical drawing that happens to have depth, not a crypto render.
- Camera: locked, with ±3° drift on a 20-second sine. Never user-orbitable; a hero the
  reader can break is a hero that gets broken.
- Load sequence: grid fades in (300ms), zero line draws left to right (`draw`), wire
  extrudes along its length (900ms), ceiling plane descends into position from above
  (`settle`, 220ms delay). Total under 1.5 seconds.
- `prefers-reduced-motion` and any WebGL failure both fall back to a static SVG of the
  identical composition. Ship the fallback as the default and hydrate up.

Overlaid, left-aligned, in the left 55% of the frame:

- Eyebrow, mono 11px: `CREDIT RAIL FOR AUTONOMOUS AGENTS · HEDERA`
- H1, Bricolage 800, clamp(40px, 7vw, 104px), max 18ch:
  **"Agents shouldn't need a wallet to do business."**
- Sub, Public Sans 19px, max 58ch: "Tab is a running balance for autonomous agents. It
  goes negative when the agent spends, positive when it earns, and settles once per
  window in a single transfer. The agent never holds USDC and never signs a payment."
- Two buttons: `Read the docs` (caution yellow, primary) and `Open the app` (surface,
  secondary). Both with offset shadows and press displacement.
- Below them, a mono strip: `ZERO SMART CONTRACTS · 4 NATIVE HEDERA SERVICES · x402 ON BOTH LEGS`

## 2.2 The problem — four failure modes

Full-bleed ink band, paper text. Section head: **"x402 solved how an agent pays. Nobody
solved when."**

Then a four-panel grid, each panel bordered `2.5px` in paper-on-ink, each with a small
2D diagram drawn in SVG:

| Panel | Copy | Diagram |
|---|---|---|
| **Cold start** | A freshly deployed agent cannot transact at all until a human funds it. Its first act is to fail. | An agent node with an empty balance ring, one outbound arrow terminating in an × |
| **Job rejection** | The agent declines profitable work because it can't fund the input cost right now. | Two stacked jobs, the profitable one greyed and struck through |
| **Human bottleneck** | An operator tops up the wallet by hand — which defeats the point of autonomy. | A dashed line from a person glyph to the agent, labelled `manual` |
| **Hot float** | The operator over-funds "just in case," leaving a large balance in a key an agent controls. | An oversized balance ring with a key glyph inside it |

Panels reveal on scroll, staggered 60ms, translating up 12px with opacity — once, never
on re-entry.

## 2.3 How it works — the three flows, scroll-choreographed

The centrepiece of the page and the place to spend real effort. A sticky viewport that
holds while the reader scrolls through three states. Left column: a persistent 2D
diagram. Right column: the explanation, swapping per state.

**State 1 — Spend leg.** Agent → Gateway → Seller. Animate a payment travelling the
path: gateway pays the seller from house float, an `x402 402 → paid` badge lights on the
seller, and the balance figure drops. Caption the property that matters:
*"The seller sees an ordinary x402 customer. It does not know Tab exists. Nothing on the
seller side changes."*

**State 2 — Earn leg.** Payer → Gateway → the agent's own endpoint. Payment travels
inward, the balance figure climbs, and an **attested** receipt chip stamps into a
receipt column. Caption: *"Because Tab served the request, it can prove the payment
corresponds to real work. Chain history alone can't."*

**State 3 — Settlement.** Forty-three individual receipts collapse — physically, with
motion — into a single transfer row. This is the one place a count-up is permitted:
`43 calls` → `1 transfer`. Caption: *"Ten thousand calls become one transfer."*

Scroll drives state via `IntersectionObserver`, not by hijacking wheel events. On reduced
motion, render all three states stacked as static diagrams.

## 2.4 The ceiling engine

Two-column. Left: the formula, set in mono as a real block, with each term as a distinct
bordered chip so a reader can see it is arithmetic and not hand-waving:

```
ceiling = trailing_attested_revenue_per_window
        × tier_multiple        A 3.0 · B 2.0 · C 1.0 · Unrated 0
        × ramp_factor          starts 15%, +15% clean, −30% missed
        , clamped by hard_cap[tier]
```

Right: a small interactive. Three sliders — trailing revenue, tier, ramp — and a live
ceiling figure that updates. The figure uses `flash-credit` / `flash-debit` on change and
the digits themselves never animate. Let the reader drive tier to Unrated and watch the
ceiling hit exactly `0.0000`, because that is the mechanism.

Below, a two-column split on the deliberate speed asymmetry: **fast path** (every spend
request, target under 50ms, cache only, six checks listed as a numbered sequence) versus
**slow path** (background, Mirror Node → graph → score → ceiling). One arrow from slow to
fast labelled `writes cache`, one crossed-out arrow the other way labelled
`never calls Mirror Node`.

## 2.5 The attack — the emotional peak of the page

The section that earns trust, because it breaks Tab's own design.

Full-bleed. Reuse the hero's 3D scene, re-lit and closer. As the reader scrolls: a second
seller node appears, a funding edge illuminates between the agent and that seller across
two hops, and the **ceiling plane slams down** to zero — `settle` easing, no bounce — and
the next spend attempt hits it and stops dead.

A refusal card stamps in over the scene (`stamp-down`): hazard stripe, the rule chip
`CONTROL_CLUSTER · funding ancestry ≤ 3 hops`, a plain sentence naming amount and seller,
and the funding path drawn as discrete hops with the final node marked.

Copy beneath: *"The graph caught a seller the agent controls. The ceiling collapsed
mid-window and the next spend was refused. The float was never touched."*

Then, immediately and in the same visual weight, the honest list. **Do not soften this
and do not hide it below a fold** — publishing the gaps is what makes the caught attacks
credible:

- **Non-reciprocal collusion rings — OPEN.** A ring where value never flows back and
  funding roots are genuinely separate defeats the graph.
- **Gateway operator misbehaviour — OPEN by design.** The float is custodial. Detectable
  via published receipts; not preventable in v1.
- **Seller takes payment and doesn't deliver — OPEN.** v1 records the dispute and does
  not arbitrate.

## 2.6 Why Hedera

Four bordered cards, each one property and one number, no logos:

- **HCS is a clearing ledger you don't have to write** — append-only, consensus-ordered,
  ~$0.0001 per message. This is why Tab ships with zero smart contracts.
- **Sub-cent USD-denominated fees** make per-request payouts a product rather than
  arithmetic that loses money.
- **3-second finality** matches the settlement tick — window close to settled transfer
  inside one agent reasoning cycle.
- **Scheduled Transactions (HIP-423)** execute the tick by consensus, with no keeper.

Add a fifth, wider card: **"No Solidity. Contracts replaced by native primitives."** A
two-column table mapping what would normally be a contract to the primitive that replaced
it, and closing on the attack surface removed: no reentrancy, no delegatecall, no proxy
storage collision, no upgrade key, no liquidation MEV.

## 2.7 Live receipt tape

Full-bleed strip against ink. A `tape-scroll` marquee of real receipt rows in mono —
consensus timestamp, leg, counterparty, amount, attested flag. Debits brick, credits
green, one refusal in caution yellow passing through every cycle. Pauses on hover.

This is the page's proof of life, and it needs no explanation to work.

## 2.8 Close

Two-panel split, ink ground.

Left: the agent surface — `spend`, `quote`, `balance`, `ceiling`, `receipts` as five mono
chips, with a copyable install snippet and the line *"Ships as a Hedera Agent Kit v4
plugin, an MCP server, a TypeScript SDK, and a CLI."*

Right: what Tab deliberately did not build, as a short honest list — no smart contracts,
no seller-side credential, no cross-chain messaging, no price oracles, no LP vaults, no
agent deployment platform.

Footer: repo, HashScan links for the receipt topic, ceiling topic and float account, and
the line `Built for ETHOnline 2026 · Hedera Testnet · No Solidity was deployed at any
point.`

---

# 3 · SURFACE TWO — app.tab.xyz, the operator console

Utilitarian treatment, executed immaculately. This is scanned and operated, never read
top to bottom. Every gram of personality that survives from the landing page lives in
the chrome; the data itself is silent.

**Views do not animate.** No page transitions, no skeleton shimmer longer than 400ms, no
entrance animation on data. An app that animates feels slow. The only motion permitted
here is `flash-credit`/`flash-debit` on a changed figure, `hold-hatch` on pending holds,
`snap` on controls, and `stamp-down` when a refusal arrives live.

## 3.1 Shell

Fixed left rail, 232px, ink ground, paper text. Sections in order — this ordering is
information, from most-glanced to least:

```
TAB          balance, ceiling, available, holds, window
CEILING      inputs, tier, ramp, model version, verify
COUNTERPARTIES  weights and reasons
RECEIPTS     live stream, both legs
SETTLEMENTS  window history
REFUSALS     every refused spend
──────────
AGENTS       registry, starter tabs
CONFIG       every parameter in force
```

Top bar, 56px, surface ground, `2.5px` bottom border: agent selector (mono account id),
a window countdown that is always visible, a connection pill (`streaming` /
`reconnecting` / `stale`), and a theme toggle.

The countdown is persistent because every number in the app is scoped to a window; a
reader who loses track of where they are in the window misreads everything.

## 3.2 TAB view

Hero figure: the running balance, IBM Plex Mono 600, clamp(40px, 6vw, 68px), coloured by
sign. `flash` on change. The digits never animate.

Directly beneath, the **capacity meter** — the most important component in the app. A
single horizontal track, `2.5px` ink border, height 22px, containing in order:

1. `outstanding` — solid `--debit`
2. `pending_holds` — `--caution` with animated 45° `hold-hatch`, separated from
   outstanding by a `2.5px` ink divider
3. remaining `available` — `--sunk`

Legend below in mono: `outstanding 0.4821 · held 0.0900 · available 0.4279 · ceiling 1.0000`

The hatching matters: a hold is money reserved but not yet spent, and hatching is how a
drawing says "provisional". Colour alone cannot express that.

Right of the hero, a four-tile stat row — `available`, `per-call cap`, `window spend /
window cap`, `tier` — each a bordered square tile with a mono figure and an 11px mono
label. Where a value is approaching a limit, add a hairline progress rule along the tile's
bottom edge rather than changing the tile's colour.

Below: the current window's receipts as a dense table, newest first, and a
`Force settlement` action gated to demo mode that says so in its label.

Empty state, for an agent registered seconds ago: a bordered panel, `STARTER TAB ISSUED`
stamped at −2°, the four starter parameters as a small table ($1.00 ceiling, $0.05
per-call cap, allowlist sellers, graduation on first clean settlement), and one primary
action. This is the first thing many operators will ever see — it should feel like being
handed a paper chit, not like an empty dashboard.

## 3.3 CEILING view

Left column, ~60%: every input as a table row, label left, mono figure right, with the
arithmetic visible.

```
Trailing attested revenue / window     0.3340
  ├ attested inflows        × 1.0      0.3340
  └ unattested inflows      × 0.6      0.0000
Tier multiple                    C     1.0×
Ramp factor                            30%
─────────────────────────────────────────────
Computed                               0.3340
Hard cap, tier C                       2.0000
Starter floor                          1.0000
═════════════════════════════════════════════
CEILING IN FORCE                       1.0000
```

Use rule weight to show the arithmetic: hairline for sub-terms, `2.5px` for the total,
double rule for the binding result. Mark which constraint actually bound with a caution
chip reading `BINDING` — that is the single most useful fact on the screen.

Right column: `MODEL_VERSION` pinned in mono, the canonical input hash in full and
copyable, the HCS sequence number as a HashScan link, and a **`Recompute and verify`**
button. On success the hash panel takes a green rule and a `VERIFIED` stamp at −6°; on
mismatch, a caution hazard stripe and both hashes shown for diffing.

That button is the no-smart-contract argument made operable. Give it real weight.

Below: ceiling history as a stepped line chart — stepped, because a ceiling changes
discretely and a smooth curve would be a lie. Faint greenbar grid, ink stroke, emphasised
endpoint dot, and each step annotated with its cause (`clean settlement +15%`,
`control cluster → 0`).

## 3.4 COUNTERPARTIES view

One dense table, sortable, no cards.

Columns: account id (mono), first seen, account age in days, direction (`sells to` /
`buys from` / `both`), volume, share of total, **weight**, and **reason**.

Weight renders as a small bordered bar, 86px, filled `--pen`. Reason is the point of the
view and gets a chip from a fixed enum, colour-coded by class:

- `INDEPENDENT` — no chip, weight 1.0
- `AGE_DISCOUNT` `SHARED_ROOT` `RECIPROCAL_FLOW` `CONCENTRATION` — caution chips, weight
  below 1
- `HARD_BLOCK_ANCESTRY` `HARD_BLOCK_SOLE_COUNTERPARTY` — debit chips, weight 0

Row expands (`settle`, 220ms) to show the evidence: the funding path drawn as discrete
hop boxes with arrows, the hop count against the limit from config, and the exact
computed share against the 40% cap. Never state a weight without the derivation
underneath it.

Add a config note in the view: `AGE_FULL_DAYS` is tuned down for testnet, because on a
testnet every account is young and a naive age factor rejects everyone. State the tuned
value inline. Hiding a tuning knob reads worse than explaining it.

## 3.5 RECEIPTS view

A live table, newest at top, streaming over SSE. Columns: consensus timestamp (mono,
full precision, monospaced so digits align), leg (`DEBIT` / `CREDIT` / `REFUSED` as
pills), counterparty, amount (right-aligned, signed, coloured), attested flag, request
hash (truncated, copyable), sequence number linking to HashScan.

New rows arrive with `flash-credit` / `flash-debit` on the row ground and no slide-in —
a slide pushes every other row and makes a streaming table unreadable. Header row carries
a filter bar: leg, attested, counterparty, and a time range.

Greenbar striping on alternating rows. This table will be on screen during the demo while
receipts land live, so it must stay legible at speed.

## 3.6 SETTLEMENTS view

One row per window: window index and time range, credits, debits, interest, **net**, the
transfer id as a HashScan link, ramp before → after, and outcome (`CLEAN` / `MISSED` /
`CARRIED`).

Expand a row to show the netting arithmetic as a small right-aligned mono column, ending
in the single transfer — the point being that many receipts became one movement. Show the
count explicitly: `43 receipts → 1 transfer`.

A `Reconciliation` panel at the top of the view surfaces the reconciler's diff of Mirror
Node outbound transfers against the receipt topic: `checked 43 · matched 43 · repaired 0`,
with a green rule when clean. This runs on camera during the demo, so it is a designed
artifact, not log output.

## 3.7 REFUSALS view — design this one first

Not an error log. The product demonstrating that it works. Give it the strongest visual
treatment in the app.

Reverse-chronological cards, not a table, because each refusal is an argument and needs
room:

- Hazard stripe across the top, 12px, 45° repeating caution-and-ink.
- The **rule that fired** as a caution chip in mono, prominent:
  `CONTROL_CLUSTER · funding ancestry ≤ 3 hops`
- A plain sentence: "Spend of `$0.0400` to `0.0.5591204` refused. The agent funded this
  seller two hops back, so the purchase would be self-dealing and the revenue would not
  be real."
- The evidence, rendered — funding hops as boxes with arrows, the offending node marked
  in debit; or for a cap refusal, the figure against the cap as a small bar.
- A `REFUSED` outline stamp, −8°, `stamp-down` on live arrival.
- Footer line in mono 11px: consensus timestamp, sequence number, `float untouched`.

Filter by rule across the top, with a count per rule — that turns the view into a summary
of what the engine is actually catching.

## 3.8 CONFIG view

Every parameter in force, grouped, with `MODEL_VERSION` at the top and a `Copy as JSON`
action. Flag any value overridden from its default with a caution chip and show both
values.

This view exists so tuning is stated rather than discovered. It appears in the demo.

## 3.9 States you must design, not leave to chance

- **Loading** — bordered skeleton blocks in `--sunk`, no shimmer beyond 400ms.
- **Empty** — every view gets a specific empty state that explains what would fill it.
- **Stale** — when the snapshot exceeds max age or the stream drops, the top bar pill
  goes caution and affected figures gain a hairline caution underline. A number that has
  silently stopped updating is worse than a visible gap.
- **Refused-by-design** — never styled as an application error.
- **Application error** — visually distinct from a refusal. Ink border, plain sentence,
  a retry. Refusals are yellow; errors are neutral.

---

# 4 · SURFACE THREE — docs.tab.xyz

Documentation treatment: dense, typographically disciplined, near-zero motion. The frame
keeps just enough of the neobrutalist border language to be recognisably Tab.

## 4.1 Layout

Three columns at ≥1280px: nav rail 260px, content 720px max, on-page outline 200px.
Collapses to a single column with a sticky nav trigger under 900px.

Content column is the one that matters: 16px Public Sans, line-height 1.7, `max-width:
68ch`. Headings in Bricolage. Every code block in IBM Plex Mono with a `2.5px` ink
border, a header strip carrying the language and a copy button, and no syntax-highlight
rainbow — two colours maximum, ink for code and `--pen` for identifiers Tab defines.

## 4.2 Information architecture

```
START HERE
  What Tab is · Quickstart · Core concepts

CONCEPTS
  The tab and the ceiling · Attested revenue · Independence and control clusters
  Windows and settlement · The Starter Tab · Holds and the write-ahead order

AGENT SURFACES
  TypeScript SDK · Hedera Agent Kit plugin · MCP server · CLI

REFERENCE
  Gateway API · Refusal codes · HCS message schemas · Credit parameters · Errors

OPERATING
  Environment setup · Verifying a ceiling · Verifying the float · Reconciliation

TRUST
  Trust and security model · Attack catalogue · What we did not build
```

## 4.3 Quickstart — one screen, working in under a minute

A four-step numbered sequence, each step one copyable block. The numbering is real here:
it is a sequence, and order carries information.

1. Install — `npm i @tab/sdk`
2. Register — returns a Starter Tab
3. Spend — the agent pays for something it could not have afforded
4. Read the receipt on HCS

End with the property that sells it, called out in a bordered panel: **"The agent signed
nothing. It holds no USDC. No key was provisioned."**

## 4.4 Documentation components to design

- **Callouts** — four kinds, distinguished by border and label, never by icon:
  `NOTE` (ink), `IMPORTANT` (pen), `REFUSES` (caution — this operation can be refused,
  and here is why), `IRREVERSIBLE` (debit).
  `REFUSES` is Tab-specific and belongs on every endpoint that can decline.
- **API reference blocks** — signature in mono, then a parameter table, then a response
  shape, then **every refusal code this endpoint can return** with the condition that
  triggers it. That last section is mandatory; an agent developer's main job is handling
  refusal.
- **The refusal code table** — a reference page in its own right. Code, rule, meaning,
  what the agent should do next. Design it to be linkable per row.
- **Schema blocks** — for HCS messages: the zod-shaped definition, one real example
  message, and the field that carries the schema version.
- **Formula blocks** — the ceiling formula and the netting arithmetic set as displayed
  math in mono, each term labelled, not buried in prose.
- **Sequence diagrams** — for the three flows, drawn as SVG in the house style: ink
  strokes, `2.5px` boxes, mono labels. Consistent with the landing page's diagrams so a
  reader recognises them across surfaces.
- **Version chip** — every reference page carries the `MODEL_VERSION` or schema version
  it documents.

## 4.5 Search, and the one motion allowed

`⌘K` palette. Bordered modal, mono input, results grouped by section with the matched
term in `--pen`. Opens on `snap`. That is the only animation in the docs.

---

# 5 · ANTI-PATTERNS — the mix fails in predictable ways

The failure mode of "a bit comic, a bit institutional" is landing between the two and
reading as neither. Guard against these specifically:

- **No emoji, no mascot, no wobble, no bounce, no confetti.** The comic register is
  borders, shadows and one stamp. That is the whole budget.
- **Never decorate a figure.** No gradient on a balance, no glow on a total, no animated
  count-up on money, no sparkline inside a number.
- **No second accent.** For emphasis use weight, border, or ground colour. If a new hue
  feels necessary, the hierarchy is wrong.
- **No ambient motion in the app.** The only loop permitted anywhere is `hold-hatch`,
  because it means "in flight".
- **Never style a refusal as a failure.** Red-alert treatment argues directly against the
  pitch.
- **No rounded-everything.** Radii stay 0–4px. A `rounded-lg` card set is the most
  common tell of a generated design.
- **No centred body text**, no full-width hero with centred everything.
- **Don't let the 3D read as crypto.** Matte materials, no metalness, no environment map,
  no glow, no particles. It should look like a technical drawing with depth.
- **Never show a number without its unit and scale.** USDC has 6 decimals; show four and
  make the truncation deliberate.
- **Never show a weight, tier or refusal without the reason.** The reason is the product.

# 6 · DELIVERABLES

1. A token layer as CSS custom properties — full light and dark sets — mapped into a
   Tailwind theme so shadcn/ui inherits it.
2. Three surfaces as separate route groups: marketing, app, docs.
3. The shared SVG diagram set — three flows, funding hops, fast/slow path — in one house
   style used across all three surfaces.
4. The r3f hero scene plus its static SVG fallback.
5. A components page rendering every state of every component, including empty, loading,
   stale and error, in both themes. Build this first; it is how the system stays coherent
   once three people are working in it.
