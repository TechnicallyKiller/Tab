# HANDOFF — living log

**Every change gets an entry. Every push. No exceptions.**

This is the file you read first when you sit down and write last before you stop. Its job is to make
sure nobody loses an hour rediscovering something a teammate already knows — and on a hackathon
timeline, that hour is the difference.

**How to use it**

1. **Before you start:** read *Current State* and the last five entries in the log.
2. **Before you push:** update *Current State* if it changed, and append an entry at the **top** of
   the log.
3. **If you learned something that contradicts a doc:** fix the doc in the same commit, and say so
   in your entry. A stale doc is worse than no doc because it gets trusted.

Keep entries short. Three lines is fine. An entry that takes ten minutes to write does not get
written.

---

## Current State

**Phase:** on-chain — HCS live, money moving between accounts. Frontend still on mocks.
**Next action:** write `@tab/protocol`. Decision on receipt conventions is made (bespoke — see
log); nothing is blocking it. The receipt topic still carries only `bootstrap.hello`.

**Pick zod 4 (4.4.3), not 3.** The catalog in `pnpm-workspace.yaml` still pins `zod: ^3.25.0`, but
v3 has no stable release past 3.25 — the newest v3 tag is a canary. Update the catalog when
`protocol` lands.
**Last updated:** 2026-08-22 by Claude (receipt-schema decision made; protocol not yet written)

### Live testnet

| | |
|---|---|
| Operator | `0.0.8812188` · ED25519 · 1000 HBAR · unlimited auto-association |
| Receipt topic | [`0.0.10182696`](https://hashscan.io/testnet/topic/0.0.10182696) |
| Ceiling topic | [`0.0.10182697`](https://hashscan.io/testnet/topic/0.0.10182697) |
| Settlement topic | [`0.0.10182698`](https://hashscan.io/testnet/topic/0.0.10182698) |
| Spend token | [`0.0.10182853`](https://hashscan.io/testnet/token/0.0.10182853) — `TUSD`, 6 dp, 1000 supply. **Stand-in**: the Circle faucet reported a drip that never arrived. Swapping to real USDC is one env var |

All three carry an ED25519 submit key, so the log is append-only and Tab-owned. A message
round-trips through consensus and back out of Mirror Node in about two seconds.

### Track board

**No assigned owners. Everyone is equal — claim a track, work it, release it.** Put your name in
*Claimed by* when you start and clear it when you stop, so two people never edit the same package in
parallel. That is the only rule, and it is about merge conflicts, not authority.

Tracks are dependency-ordered — see [docs/BUILD_ORDER.md](docs/BUILD_ORDER.md). Do not start a
phase whose predecessor is unfinished; you would be building against an interface that does not
exist yet.

| Track | Scope | Phase | Claimed by | Status |
|---|---|---|---|---|
| **P0** | `tools/probes` → `docs/probes.md` | 0 | — | **4 of 5 green.** Only Probe 2 (facilitator) and 5 (Redis) left |
| **G** | `tools/guards` | 0 | — | **done** — 5 guards, negative-tested |
| **F1** | `money` ✅ · `protocol` · `params` | 1 | — | **protocol is the next action** — schemas pinned by the UI and the 1KB chunk limit |
| **F2** | `ledger` | 1 | — | open |
| **F3** | `scoring` · `graph` | 1 | — | open |
| **A1** | `hedera` · `observability` | 2 | — | hedera: topics + HTS + accounts live. **Schedule (HIP-423) not written** |
| **A2** | `mirror` ✅ · `db` | 2 | — | mirror done, 7 live checks green |
| **A3** | `x402` | 2 | — | open |
| **A4** | `cache` | 2 | — | open |
| **FAST** | `fastpath` · `apps/gateway` | 3 | — | open |
| **SLOW** | `apps/engine` · `apps/settlement` | 3 | — | open |
| **S1** | `sdk` · `apps/cli` | 4 | — | open |
| **S2** | `agentkit-plugin` | 4 | — | open |
| **S3** | `apps/web` | 4 | — | open |
| **S4** | `mcp` — scope it before building | 4 | — | open |
| **D1** | `tools/verify` | 5 — pull earlier if you can | — | open |
| **D2** | `agents/honest-agent` | 5 | — | open |
| **D3** | `agents/loop-attacker` | 5 | — | open |

**Before Phase 1 is claimed:** agree the `@tab/protocol` message shapes together. Everything
downstream reads and writes them, and changing them on day four touches every package.

### Environment

| Thing | Status | Value / where |
|---|---|---|
| Hedera testnet account | ⬜ | |
| Supabase project | ⬜ | `DATABASE_URL` in `.env` |
| Upstash Redis | ⬜ | `REDIS_URL` in `.env` — **note the region** |
| HCS topics (3) | ⬜ | created by `pnpm bootstrap` |
| Float accounts (2) | ⬜ | Treasury + Hot Float, see [docs/KEYS.md](docs/KEYS.md) |
| Testnet USDC obtained | ⬜ | Probe 1 |

### Blocked / open questions

| What | Blocking whom | Owner |
|---|---|---|
| Probe 2: which facilitator do our demo sellers use? | `x402`, `apps/gateway` spend leg | — |
| ~~Match `x402-hedera-receipts` or go bespoke?~~ | `protocol` | **decided: bespoke** — see log 2026-08-22 |
| Probe 5: fast-path latency to in-region Upstash | `cache` LRU design, the 50ms claim | — |
| Standalone MCP server, or load our plugin into the official Agent Kit MCP server? | `mcp` scope | — |
| Settlement schedule: provisional-amount-at-open, or short-expiry-near-close? | `apps/settlement` | — |
| `AGE_FULL_DAYS` testnet value | `graph`, `params`, the config dump | — |
| Refusal reason enum — the UI already renders 6 codes, `@tab/protocol` must match exactly | `protocol`, `fastpath`, `web` | — |
| Ceiling input record shape — the CEILING view renders 9 rows and a canonical hash | `scoring`, `protocol`, `web` | — |

### Contract changes — read this before you assume a doc is current

Anything that changed a shared interface, a schema, or a documented decision. **This is the section
most likely to save someone an hour**, so be generous here even when the change felt small.

| Date | What changed | Who must know |
|---|---|---|
| 2026-08-18 | Float is **two accounts** (Treasury KeyList + Hot Float single key), not one. The x402 exact scheme signs per request. [ADR-0003](docs/adr/0003-two-account-float.md) | `hedera`, `gateway`, `settlement`, `verify` |
| 2026-08-18 | We **self-facilitate the earn leg**; we are the HBAR fee payer when we earn. [ADR-0004](docs/adr/0004-self-hosted-facilitator.md) | `x402`, `gateway` |
| 2026-08-18 | Agent Kit enforcement is a **policy**, not a hook — hooks cannot block. [ADR-0008](docs/adr/0008-agentkit-policy-not-hook.md) | `agentkit-plugin` |
| 2026-08-18 | SDK is **`@hiero-ledger/sdk`**, never `@hashgraph/sdk`. Mixing them breaks signing at request time. [ADR-0002](docs/adr/0002-single-hedera-sdk.md) | everyone |
| 2026-08-18 | x402 is the **scoped `@x402/*` 2.22.0** family, not unscoped `x402@1.2.0` | `x402` |
| 2026-08-18 | **No Docker.** Supabase + Upstash. [ADR-0005](docs/adr/0005-managed-infrastructure.md) | everyone |
| 2026-08-21 | **`apps/dashboard` is now `apps/web`** and carries all three surfaces as route groups (`/`, `/app/*`, `/docs`). `boundaries.json` and every README updated | `web`, anyone reading the package map |
| 2026-08-21 | **pnpm 11 ignores the `pnpm` field in package.json.** `overrides` moved to `pnpm-workspace.yaml` — the ADR-0002 SDK pin was silently inactive before this | everyone |
| 2026-08-22 | **The spend token is `TUSD` `0.0.10182853`, not real USDC.** The Circle faucet reported a drip that never arrived. Read the token id from `USDC_TOKEN_ID`, never hardcode `0.0.429274` | everyone touching a transfer |
| 2026-08-22 | **Mirror Node 404s on an entity that exists on consensus.** A just-created account is indexed seconds later; 404 means "not indexed yet". Use `waitForAccount()` after any create-then-read | `engine` indexer, `bootstrap`, `gateway` |
| 2026-08-22 | **Keep an HCS receipt under 1KB.** Above that it chunks across messages and must be reassembled before parsing; a lone chunk is truncated JSON | `protocol`, `gateway`, `verify` |
| 2026-08-22 | **Mirror Node returns empty pages mid-result-set.** Stop only on `links.next === null`, never on an empty page, or history truncates silently | `engine` indexer, `verify` |
| 2026-08-22 | **Filter `result === 'SUCCESS'`** on transactions — failed transfers are returned and would be phantom graph edges | `engine`, `graph` |
| 2026-08-22 | **No TypeScript parameter properties anywhere.** Packages run under `node --experimental-strip-types`, which cannot handle them. `erasableSyntaxOnly` is now on | everyone |
| 2026-08-21 | **`allowBuilds` in `pnpm-workspace.yaml` must stay answered.** pnpm 11 only warns locally on an unanswered entry but exits 1 in CI, which fails the deploy | anyone adding a dependency with an install script |
| 2026-08-21 | **The UI already fixes two shapes**: the refusal reason enum (6 codes) and the ceiling input record (9 rows + canonical hash). `@tab/protocol` must match what the screens render | `protocol`, `scoring`, `fastpath` |

---

## Log

Newest first. Append at the top.

### Template — copy this

```markdown
### YYYY-MM-DD HH:MM — <your name> — <area>

**Did:** what you actually changed, in one or two lines.
**Learned:** anything surprising. A library that does not work as documented, a value that had to be
tuned, an approach that failed. This line is the most valuable one in the entry — if you struggled
with it, write it down so nobody else does.
**Contract change:** none · or what changed and who is affected (also add it to the table above).
**Next:** what you would do next, or what you are handing over.
**Blocked:** nothing · or what you need and from whom.
```

---

### 2026-08-22 — Claude — receipt schema: bespoke, decided

**Did:** No code. Investigated the one open decision blocking `@tab/protocol` — whether to match
the existing `x402-hedera-receipts` package or design our receipts clean.

**Decided: bespoke.** Three reasons, all from reading the package rather than guessing:

1. **It solves a different problem.** It verifies seller *overcharge* under x402's `upto` scheme —
   signed offers, price schedules, meter readings, so `captured ≠ units × unit_price` is provable.
   Tab uses `exact`, and our receipts record the tab's own debits and credits. Almost no overlap.
2. **It depends on `ethers`**, which our own `guard:solidity` bans as EVM tooling. Adopting it
   would mean either weakening a track-requirement guard or vendoring around it.
3. **v0.1.1, two versions, published 2026-07-15.** There is no established convention there to
   match yet, so "matching it" buys no interoperability.

Worth knowing anyway: it is from the Tally project and is adjacent work in the same space. If a
judge knows it, the distinction above is the answer.

**Learned:** `zod` v3 has no stable release past 3.25 — the newest v3 tag is a canary, and v4.4.3
is current. The catalog in `pnpm-workspace.yaml` still says `zod: ^3.25.0`; that needs to become
v4 when `protocol` is written, or install resolves to something unintended.

**Contract change:** none — no code was written.

**Next:** `@tab/protocol`. Constraints already fixed and non-negotiable: messages stay **under 1KB**
or HCS chunks them; every message carries a schema version; amounts cross the wire as decimal
strings via `toWire()`; canonical serialization must be byte-stable so the ceiling input hash is
reproducible. Two shapes are pinned by what the UI already renders — the 6-code refusal enum and
the 9-row ceiling input record — see `apps/web/src/lib/mock/types.ts`.

**Blocked:** nothing on `protocol`. Probe 2 still needs a live x402 seller; Probe 5 needs Supabase
and Upstash.

---

### 2026-08-22 — Claude — Probe 1 and 3 green, money moves on testnet

**Did:** HTS transfers, association and account creation in `@tab/hedera`. Minted the stand-in
token after the faucet failed. `pnpm probe3` now creates a fresh account, proves the transfer fails
unassociated, associates it, pays it, and confirms both balances from Mirror Node.

**Learned:**

1. **The Circle faucet reported a successful drip and delivered nothing.** Polled ten times over two
   minutes — the account had never held *any* token relationship, so it never arrived. Do not assume
   a faucet worked; check the balance on-chain. Took the hour-one fallback and minted `TUSD`.
2. **Mirror Node 404s on an entity that already exists on consensus.** A just-created account
   reaches consensus seconds before it is indexed. That 404 means "not indexed yet", not "does not
   exist" — treating it as fatal is wrong. `waitForAccount()` exists for this now.
3. **The association failure is silent unless you look.** Probe 3 tests it with a fresh account at
   **0** auto-association slots on purpose; the operator has unlimited slots and would have hidden
   the failure mode completely. `canReceiveToken()` predicts the refusal *before* we send, which is
   why it belongs in the spend leg's preflight.
4. **The boundaries guard caught me mid-build.** `tools/bootstrap` tried to import
   `@hiero-ledger/sdk` directly to create an account. Not on its allow list, so `createAccount`
   moved into `@tab/hedera` where the SDK belongs. The rule worked without me thinking about it.

**Contract change:** three, in the table above.

**Next:** `@tab/protocol`. The receipt topic currently holds `bootstrap.hello`; it should hold typed
receipts. Two shapes are already pinned — the 6-code refusal enum and the 9-row ceiling input record
the UI renders — and messages must stay under 1KB to avoid chunking.

**Blocked:** Probe 2 needs a live x402 seller. Probe 5 needs Supabase and Upstash. One open decision
before writing schemas: match `x402-hedera-receipts` conventions or go bespoke.

---

### 2026-08-22 — Claude — Hedera testnet is live

**Did:** `tools/guards` (5 guards, all negative-tested), `@tab/money` extracted from the frontend,
`@tab/mirror` (7 checks against real testnet), `@tab/hedera` (client + topics), and `pnpm bootstrap`
— which created three real HCS topics and round-tripped a message through consensus.

**Learned:** Four things measured against the live chain, not read in docs.

1. **Mirror Node returns empty pages in the middle of a real result set** — 7 of 8 empty, one page
   with data, `links.next` non-null throughout. An indexer that stops on the first empty page
   silently truncates history, which is a wrong graph and therefore a wrong credit decision.
2. **HCS messages above ~1KB chunk**, and a lone chunk parses as truncated JSON. Keep receipts under
   1KB; every read goes through `reassembleChunks()`.
3. **Portal accounts now ship `max_automatic_token_associations: -1`** — unlimited auto-association,
   which softens the README's "fails silently" association warning for portal accounts. Accounts we
   create in bootstrap still need it set explicitly.
4. **Running the guards found two real defects in the frontend** I had already shipped: the ceiling
   formula was computed in floats on the landing page, and counterparty share was compared against
   the 40% cap as a float. `0.4` is not representable, so that comparison can flip at exactly 40% —
   a refusal that should fire and doesn't. Both now bigint/basis-points.

Also fixed two false positives in my own guards, both by making the check more truthful rather than
looser: the SDK guard now counts physical copies in the pnpm store instead of parsing peer-suffixed
lockfile versions, and the secrets guard asks git whether a `.env` is *tracked* rather than whether
it exists.

**Contract change:** four, in the table above.

**Next:** testnet USDC (Probe 1) is the gate for everything else on-chain. Then HTS transfers, then
`@tab/protocol` so receipts have a real schema instead of `bootstrap.hello`.

**Blocked:** Probe 1 needs a USDC faucet; Probe 2 needs a live x402 seller to query; Probe 5 needs
Supabase and Upstash.

---

### 2026-08-21 — Claude — apps/web, all three surfaces

**Did:** Built the frontend from the Claude Design bundle in `surface-selection-decision/`. One
Next.js 16 app, three route groups: landing (`/`), operator console (`/app/*`, eight views), docs
(`/docs`). Token layer, primitives and motion system in `src/app/globals.css`; every figure comes
from `src/lib/mock/`. Builds clean, 13 routes, all verified serving. `apps/dashboard` became
`apps/web` and the structure docs followed.

**Learned:** Three things worth the next person's time.

1. **pnpm 11 no longer reads the `pnpm` field in package.json.** Our `@hiero-ledger/sdk` override
   was silently doing nothing. Moved to `pnpm-workspace.yaml`, and added an alias so
   `@hashgraph/sdk` resolves to the Hiero package even if something pulls it in. ADR-0002 was
   unenforced until now.
2. **The branded `MicroUsdc` type earned its keep immediately.** It failed the build twice on
   places where I'd let a raw `bigint` through from a subtraction. That is exactly the class of slip
   that produces a balance a few micro-USDC off the ledger, so `sub()` and `atLeastZero()` now
   exist rather than inline arithmetic. The prototype used floats throughout; this does not.
3. **The design prototype is decided on two schemas we have not written yet** — the refusal reason
   enum and the ceiling input record. Whoever takes `protocol` should read
   `apps/web/src/lib/mock/types.ts` first; the screens are the spec.

**Contract change:** three, in the table above.

**Next:** `@tab/sdk` (track S1) is now the critical path for the frontend — swapping the mock
modules for real calls is mechanical once its surface exists. Backend still gated on Phase 0 probes.

**Blocked:** nothing.

---

### 2026-08-18 — Claude — repo structure

**Did:** Scaffolded the monorepo — folder tree, a README per directory stating its invariants and
dependency rules, eight ADRs, [`boundaries.json`](boundaries.json) as the machine-checked
architecture, root tooling config, CI, and [docs/](docs/). No implementation.

**Learned:** Verified every load-bearing dependency against the live npm registry and their published
type definitions rather than trusting the original README, and six things were off — three of them
architectural. Full detail in [docs/RESEARCH.md](docs/RESEARCH.md). The one that would have hurt
most: the x402 Hedera `exact` scheme requires the *paying* account to sign a transfer inside each
request, which makes a threshold KeyList on the float incompatible with a sub-50ms path. That is
knowable only from reading `@x402/hedera`'s type definitions, and it would have surfaced as a
mysterious latency problem in week two.

**Contract change:** six, all recorded in the table above.

**Next:** Phase 0 probes. Then split Phase 1 three ways per
[docs/BUILD_ORDER.md](docs/BUILD_ORDER.md) — but agree the `@tab/protocol` message shapes together
before splitting, because everything downstream reads them.

**Blocked:** nothing. Probes 2 and 5 are open questions that only running them answers.
