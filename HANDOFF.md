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

**Phase:** **both legs work end to end on Hedera testnet.** An agent with no key spends against a
ceiling and earns through its own endpoint. Frontend still runs entirely on mocks.

**Next action:** settlement. `planSettlement` is written and tested, HIP-423 is proven, and the tab
is sitting at `−0.0600` waiting to be netted into one transfer. Then `graph` + `scoring`, which is
what the attack demo needs.

**Last updated:** 2026-09-06 by Claude (earn leg — the tab now swings positive)

### Written: 12 of 27 packages

`money` · `protocol` · `ledger` · `mirror` · `hedera` · `x402` · `testkit` · `web`
`gateway` · `honest-agent` · `bootstrap` · `probes`

Still only a README: `params` · `scoring` · `graph` · `fastpath` · `cache` · `db` ·
`observability` · `sdk` · `cli` · `agentkit-plugin` · `mcp` · `engine` · `settlement` ·
`loop-attacker` · `verify`

**47 unit tests** — money 13, protocol 9, ledger 25.

### The demo that runs today

```bash
pnpm seller                                              # unmodified x402 seller
pnpm agent:endpoint                                      # agent's own endpoint, no key
AGENT_ENDPOINT_URL=http://localhost:4066 pnpm start:gateway
pnpm demo:honest    # spend leg — tab goes negative
pnpm demo:earn      # earn leg  — tab goes positive
```

Last run, and the receipt topic agrees to the micro-USDC:

```
spend   available 0.9200 -> 0.8400   two debits, seq 6 and 7
earn    balance  -0.1600 -> -0.0600  two attested credits, seq 8 and 9
replay  net -0.0600                  independent HCS reconstruction
```

### Proven on testnet

| Capability | Re-run with | Result |
|---|---|---|
| **HCS** | `pnpm bootstrap` | 3 topics with submit keys; round-trips in ~2s |
| **HTS** | `pnpm probe3` | mint, associate, transfer. Association failure shown *then* fixed |
| **Mirror Node** | `pnpm --filter @tab/mirror test:live` | 7 checks |
| **Schedule Service (HIP-423)** | `pnpm probe:schedule` | tick fires at expiry; we submit nothing |
| **x402, both roles** | `pnpm probe:adapter` / `:hts` | HBAR ~2.2s · token ~39s |
| **Typed receipts** | `pnpm probe:protocol` | written, read back, topic replayed |
| **Cache latency** | `pnpm probe:latency` | co-located 1.5ms p99 · remote 499ms |

Four native Hedera services; the track requires two.

### Live testnet

| | |
|---|---|
| Operator / hot float | [`0.0.8812188`](https://hashscan.io/testnet/account/0.0.8812188) · ED25519 · unlimited auto-association |
| Receipt topic | [`0.0.10182696`](https://hashscan.io/testnet/topic/0.0.10182696) — **9 messages: 4 debits, 1 refusal, 2 credits, 2 pre-schema** |
| Ceiling topic | [`0.0.10182697`](https://hashscan.io/testnet/topic/0.0.10182697) — empty, nothing publishes ceilings yet |
| Settlement topic | [`0.0.10182698`](https://hashscan.io/testnet/topic/0.0.10182698) — empty, no settlement worker |
| Spend token | [`0.0.10182853`](https://hashscan.io/testnet/token/0.0.10182853) · `TUSD` · 6 dp · **stand-in** for USDC |
| x402 demo seller | [`0.0.10379572`](https://hashscan.io/testnet/account/0.0.10379572) · stock `@x402/hedera`, receives only |
| Facilitator fee payer | [`0.0.10379287`](https://hashscan.io/testnet/account/0.0.10379287) · **ECDSA** · also the faucet relay |
| Demo payer | [`0.0.10385196`](https://hashscan.io/testnet/account/0.0.10385196) · independent, funded with TUSD |

**A working x402 payment needs THREE distinct accounts** — payer, `payTo`, and fee payer. x402
rejects a transfer the fee payer is a party to
(`invalid_exact_hedera_payload_fee_payer_transferring_funds`). `pnpm payer:create` and
`pnpm seller:create` exist for this.

### Read these before you write code

Three findings cost hours each and will cost them again if rediscovered:

1. **Node's `fetch` has a 10s connect timeout no `AbortController` can extend.** Mirror Node needs
   5–15s from a high-latency link. Every app and tool entry point must call `configureGlobalHttp()`
   from `@tab/mirror` **before any HTTP**. Skip it and x402 reports
   `invalid_exact_hedera_payload_signature_invalid` — a signature error for a network problem.
2. **Mirror Node returns empty pages mid-result-set.** Hit three times on three accounts. Stop only
   on `links.next === null`; use `walk()`.
3. **Never diff Mirror Node account balances to prove value moved** — they are snapshots. Fetch the
   transaction and assert on `result` plus the transfer list. **`verify-tab` inherits this.**

### Environment

| | |
|---|---|
| `REDIS_URL` | set — Upstash **us-east-1**. Use a **local Redis for the demo** (`redis-server --port 6380`, already installed) or the 50ms claim is not demonstrable |
| `DATABASE_URL` | **NOT SET** — blocks `db`, and therefore `engine` |
| Real USDC | not obtained. Circle's faucet reported drips that never arrived. Proven not to block anything |

### Track board

**No assigned owners. Everyone is equal — claim a track, work it, release it.** Put your name in
*Claimed by* when you start and clear it when you stop, so two people never edit the same package in
parallel. That is the only rule, and it is about merge conflicts, not authority.

Tracks are dependency-ordered — see [docs/BUILD_ORDER.md](docs/BUILD_ORDER.md). Do not start a
phase whose predecessor is unfinished; you would be building against an interface that does not
exist yet.

| Track | Scope | Phase | Claimed by | Status |
|---|---|---|---|---|
| **P0** | `tools/probes` → `docs/probes.md` | 0 | — | **all 5 answered + Probe 6.** Phase 0 complete |
| **G** | `tools/guards` | 0 | — | **done** — 5 guards, negative-tested |
| **F1** | `money` ✅ · `protocol` ✅ · `params` | 1 | — | only `params` left — `TIER_APR_BP` is squatting in `ledger` until it exists |
| **F2** | `ledger` | 1 | — | **done** — 25 tests. No generative property tests yet |
| **F3** | `scoring` · `graph` | 1 | — | open |
| **A1** | `hedera` · `observability` | 2 | — | hedera: topics + HTS + accounts live. **Schedule (HIP-423) not written** |
| **A2** | `mirror` ✅ · `db` | 2 | — | mirror done, 7 live checks green |
| **A3** | `x402` | 2 | — | **done** — 3 roles, proven on testnet for HBAR and HTS. No `hold_id` threading yet |
| **A4** | `cache` | 2 | — | **read Probe 5 first** — the LRU is not optional, and the hold reserve cannot be cached |
| **FAST** | `fastpath` · `apps/gateway` | 3 | — | gateway: **both legs live**. `fastpath` unwritten — checks are inline in `spend.ts` |
| **SLOW** | `apps/engine` · `apps/settlement` | 3 | — | open |
| **S1** | `sdk` · `apps/cli` | 4 | — | open |
| **S2** | `agentkit-plugin` | 4 | — | open |
| **S3** | `apps/web` | 4 | — | open |
| **S4** | `mcp` — scope it before building | 4 | — | open |
| **D1** | `tools/verify` | 5 — pull earlier if you can | — | open |
| **D2** | `agents/honest-agent` | 5 | — | **done** — zero dependencies, spends and earns |
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
| Test against a **third-party public** x402 seller — ours is stock, which tests "unmodified" but not a public facilitator accepting HTS | `x402`, `gateway` spend leg | — |
| ~~Match `x402-hedera-receipts` or go bespoke?~~ | `protocol` | **decided: bespoke** — see log 2026-08-22 |
| ~~Probe 5: fast-path latency~~ | `cache` | **answered: co-located 1.5ms, remote 499ms.** Demo must use local Redis |
| Standalone MCP server, or load our plugin into the official Agent Kit MCP server? | `mcp` scope | — |
| Settlement schedule: provisional-amount-at-open, or short-expiry-near-close? | `apps/settlement` | — |
| `AGE_FULL_DAYS` testnet value | `graph`, `params`, the config dump | — |
| `DATABASE_URL` (Supabase) not set | `db` → `engine` | **needs the user** |
| No demo video, no user-testing evidence, no network-impact doc — 45% of the rubric | submission | **needs the user** |
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
| 2026-09-06 | **An x402 payment needs THREE distinct accounts** — payer, `payTo`, fee payer. The scheme rejects a transfer the fee payer is a party to. Same rule that bit us on the seller, now general | `x402`, `gateway`, `testkit`, any demo |
| 2026-09-06 | **The earn leg forwards even if the receipt write fails.** The money has already moved by then — refusing to serve a request the payer paid for would be theft; a missing receipt is repairable. A payment taken but not served is `attested: false` | `gateway`, `settlement` reconciler |
| 2026-09-06 | **The gateway is SINGLE INSTANCE.** Holds live in process memory, so two instances would each allow up to the ceiling. `@tab/cache` fixes it; Probe 5 says why the hop cannot be removed | `gateway`, `cache`, deployment |
| 2026-09-05 | **Node's `fetch` has a 10s CONNECT timeout no AbortController can extend.** Mirror Node needs 5–15s from a high-latency link, so ~half of requests die on it. Inside x402 it surfaces as `invalid_exact_hedera_payload_signature_invalid` — a signature error for a network problem. **Every app/tool entry point must call `configureGlobalHttp()` from `@tab/mirror` before any HTTP** | everyone doing HTTP; `gateway` especially |
| 2026-09-05 | **`@tab/x402` may import `@hiero-ledger/sdk`** — second exception after `@tab/hedera`, now actually in `boundaries.json` rather than only in a README | `x402`, anyone reading the SDK ban |
| 2026-09-05 | **The 50ms budget requires a CO-LOCATED cache — and holds easily with one.** Local Redis: p99 **1.5ms**, 33× headroom. Remote Upstash us-east-1 from ap-south: 499ms. **Run the demo against local Redis** (`redis-server --port 6380`, already installed, no Docker/sudo). An LRU serves the snapshot but a hold reserve must be atomic across instances, so it cannot be cached away | `cache`, `fastpath`, `gateway`, demo |
| 2026-09-05 | **Never diff Mirror Node account balances to prove value moved.** They are snapshots; `balance.timestamp` is the last activity that updated them. Fetch the transaction and assert on `result` + transfer list. **`verify-tab` must account for this** or its invariant fails spuriously | `verify`, `engine`, `settlement` |
| 2026-09-05 | **Schedule state comes from Mirror Node, not `ScheduleInfoQuery`** — a consensus node that did not see the create returns `INVALID_SCHEDULE_ID` | `settlement` |
| 2026-09-05 | **x402 settles NATIVE HBAR** (`asset "0.0.0"`, tinybars) as its documented default. The primary track requirement never depended on USDC | `x402`, `gateway`, anyone waiting on the faucet |
| 2026-09-05 | **x402's client spend controls default to USD-pegged assets only** and are client-side/advisory. HBAR needs an explicit `allowedAssets` entry with an ATOMIC cap. Tab's real cap stays in the gateway | `x402`, `fastpath` |
| 2026-09-05 | **Facilitator fee payer must be a funded ECDSA account separate from the seller.** Same account for both nets to price-minus-fee | `x402`, `gateway`, `bootstrap` |
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

### 2026-09-06 — Claude — both legs work; the tab spends and earns

**Did:** `@tab/protocol`, `@tab/ledger`, `apps/gateway` (spend + earn), `agents/honest-agent`,
`@tab/testkit`. The product now exists: an agent with no key spends against a ceiling, earns
through its own endpoint, and every movement is a typed receipt on HCS.

```
spend   available 0.9200 -> 0.8400   seq 6, 7
earn    balance  -0.1600 -> -0.0600  seq 8, 9, attested
replay  net -0.0600                  independent HCS reconstruction agrees
```

**Learned:**

1. **An x402 payment needs three distinct accounts** — payer, `payTo`, fee payer. The earn leg
   404'd twice before I found it: first the payer held none of the spend token, then it *was* the
   facilitator's fee payer and x402 rejected the transfer with
   `invalid_exact_hedera_payload_fee_payer_transferring_funds`. Same rule that bit the seller
   earlier, now general. Independence matters beyond the protocol: revenue from a payer Tab
   controls is exactly what `@tab/graph` exists to discount.
2. **The earn leg's ordering is the mirror image of the spend leg.** Spend reserves *before*
   paying. Earn forwards *even if the receipt write fails*, because the money has already moved —
   refusing to serve a paid request would be theft, while a missing receipt is repairable. A
   payment taken but not served is `attested: false`; real money must not claim to be revenue it
   did not earn.
3. **The boundaries guard caught a real design error.** I put the unmodified seller inside
   `agents/honest-agent`; it was rejected because a seller needs a key and the agent must not have
   one. The seller moved to `@tab/testkit`, where the spec always said it belonged. `honest-agent`
   now declares **zero dependencies**, so "the agent holds no key" is a check, not a claim.
4. **Two "fetch failed" scares were both mine** — a `timeout` had killed the seller, and the
   gateway's own header/body timeouts were 45s against a ~40s payment. Neither was the protocol.

**Contract change:** three, in the table above.

**Next:** settlement — `planSettlement` is written and tested, HIP-423 is proven, and the tab sits
at `−0.0600` waiting to be netted. Then `graph` + `scoring` for the attack demo.

**Blocked on nobody.** Still outstanding and needing the user: a demo video, user-testing evidence
for Validation (15% of the rubric, currently zero), and a network-impact doc for Success (20%).

---

### 2026-09-05 (evening) — Claude — @tab/x402 extracted; a 10s timeout that faked a crypto bug

**Did:** `packages/x402` — all three protocol roles behind one adapter, proven on testnet for both
HBAR (~2.2s) and the 6-decimal token (~39s). Added `configureGlobalHttp()` to `@tab/mirror`.

**Learned — and this one is worth reading before you debug anything network-adjacent:**

**Node's `fetch` has a 10-second connect timeout that no `AbortController` can extend.** An abort
bounds the whole request; the connect phase fails first and independently. Mirror Node from a
high-latency link takes **5–15s to connect**, so roughly half of all requests die on undici's
default.

Inside x402 that surfaces as `invalid_exact_hedera_payload_signature_invalid` with
`invalidMessage: "fetch failed"` — the facilitator's `verifyPayerSignature` fetches the payer's
on-chain key from Mirror Node, and when that dies the scheme fails closed reporting a **signature**
error for a **network** problem.

I bisected through four wrong hypotheses (spend controls, facilitator config, sync `getSupported`,
resource-server wiring), compared payloads and challenge headers byte for byte — all identical —
while the original spike kept passing. The premise was wrong the whole time. **Check whether the
process can reach the host before believing an error message about cryptography.**

This also explains two earlier mysteries: the intermittent "This operation was aborted" failures,
and `probe:x402:hts` taking ~30s while HBAR took 2.4s.

**Also learned:** the boundaries guard caught me committing a documented-but-unimplemented
exception. `@tab/hedera`'s README claimed `@tab/x402` was permitted to import the SDK; that was
never in `boundaries.json`. It is now. I pushed at 2/5 guards before noticing — **run `pnpm guard`
before committing, not after.**

**Contract change:** two, in the table above.

**Next:** `@tab/protocol`. The receipt topic still holds `bootstrap.hello`.

---

### 2026-09-05 (later) — Claude — Phase 0 complete, four Hedera services proven

**Did:** Closed every remaining probe. HTS-token x402 (Probe 2's other half), Redis latency
(Probe 5), and HIP-423 scheduled transactions (Probe 6, new). Added `getSchedule`,
`waitForScheduleExecution`, `getTransactionAt`, `hbarNetFor` to `@tab/mirror` and the HIP-423
wiring to `@tab/hedera`.

**Learned — the one that changes the architecture:**

**Probe 5: the 50ms budget needs a co-located cache, and an LRU does not rescue it.** Measured
220ms per Redis command (Upstash primary in us-east-1, client in ap-south; the 45ms TCP handshake
to the same host is what made it attributable). The snapshot read *can* be served from memory. A
**hold reserve cannot** — it must be atomic across every gateway instance or two both allow, which
is the exact race the README lists as caught. So the budget is a deployment precondition. The
README's "under 50ms, cache only" needs restating, and `apps/README.md`'s "horizontally scalable,
stateless" gateway is only true *because* the hold lives in Redis.

**Also learned:**

- **Never diff Mirror Node balances to prove value moved.** They are snapshots. This probe reported
  `1.8000 → 1.8000` while the transfer had succeeded. Worse, a schedule can fire while its inner
  transaction fails, so "executed" and "moved" are separate claims. **`verify-tab` inherits this
  problem** — it asserts a float invariant from balances, so it must compare against receipts up to
  `balance.timestamp` or sum transfers instead. A spurious failure there is the worst possible bug.
- **HTS-token x402 takes ~30s vs ~2.4s for HBAR** from here, because the facilitator's Mirror Node
  preflight reads are 5–15s each. Same geography as Probe 5.
- **The empty-page hazard is the common case, not an edge case.** Hit it three times today on three
  accounts. Nothing should query `/transactions` without `walk()`.

**Contract change:** three, in the table above.

**Next:** extract `packages/x402` from the working spike, then `@tab/protocol`.

**Blocked:** Supabase `DATABASE_URL` still unset (blocks `db`, then `engine`). Real testnet USDC
still unobtained, but proven not to block anything — TUSD settles identically.

---

### 2026-09-05 — Claude — x402 settles on Hedera testnet (Probe 2 PASS)

**Did:** Built `tools/probes` and proved the full x402 loop end to end on real testnet —
402 challenge, signed retry, verify, settle, 200 with the seller's actual response body, in 2.4s.
Buyer −0.5000 ℏ, seller +0.5000 ℏ, exact. Self-hosted facilitator, stock
`@x402/hedera/exact/server` seller. Also vendored `hedera-dev/hedera-skills`, bumped @x402 to
2.25.0, and fixed the pnpm catalog (it was keyed by labels, so no `catalog:` reference could ever
resolve).

**Learned — the important one first:**

1. **x402 settles native HBAR by default, so the primary track requirement never needed USDC.**
   `asset "0.0.0"`, tinybars. I spent a lot of today chasing a testnet USDC faucet while the thing
   that could actually sink the submission — "x402 on both legs", completely untested — sat
   untouched. The `x402-payments` skill said this in its first paragraph. Read the skills first.
2. **ADR-0004's gas asymmetry is now measured, not asserted.** The buyer moved exactly the price
   and no fee; the facilitator's fee payer absorbed it. So the seller's facilitator pays gas when
   Tab spends, and Tab pays gas when it earns and self-facilitates. The gateway needs an HBAR
   balance watched separately from its USDC float.
3. **x402 has its own client-side spend controls** — USD-pegged assets only, `$1` cap, so HBAR
   needs an explicit `allowedAssets` entry with an atomic (tinybar) cap. It is x402's version of a
   per-call cap and it is **advisory**: the agent configures it, so a compromised agent can raise
   it. That is independent support for putting Tab's real cap in the gateway.
4. **The seller must not be the fee payer.** First run showed `+0.4975 ℏ` for a `0.5 ℏ` price
   because one account both received and paid fees. `pnpm seller:create` makes a dedicated one.
5. **`@x402/core`'s own types fail its own interfaces** under `exactOptionalPropertyTypes`
   (`network` widens to `string`). Relaxed in `tools/probes` only; `packages/` and `apps/` stay strict.

**Contract change:** three, in the table above.

**Next:** HIP-423 scheduled transactions — takes us from 3 Hedera services to 4, which lifts
Integration (15% of the grade), and it is already claimed in the README. Then extract
`packages/x402` from the working spike, then `@tab/protocol`.

**Still open on Probe 2:** not tested against a *third-party* public seller, and not tested with an
HTS token rather than HBAR. Probe 5 needs Supabase and Upstash.

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

**Learned:** `zod` v3 has no stable release past 3.25 — the newest v3 tag is a canary. The catalog
said `^3.25.0`, which would have resolved to something unintended. **Since bumped to `^4.5.4`**, so
`protocol` should just use `catalog:`.

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
