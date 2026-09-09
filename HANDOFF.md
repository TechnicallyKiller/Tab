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

**Last updated:** 2026-09-09 by Claude · **21 of 27 packages · 361 tests · 5/5 guards · REAL USDC · CONSOLE FULLY LIVE · PARAMS v3 · MCP**

**Phase: the whole rail works end to end on Hedera testnet, and a stranger can verify it.** An
agent with no key spends against a ceiling, earns through its own endpoint, settles by consensus,
gets refused when the ceiling shrinks, and every claim above is checkable from public data.

**All eight console views read live data. No view is on mock data any more.** **No budget:
everything is testnet and free tiers, and nothing in the design costs money.**

---

### What works, with the evidence

| Capability | Command | Observed |
|---|---|---|
| **Spend leg** — agent with no key pays a seller | `pnpm demo:honest` | hold + debit receipts, seller paid on chain |
| **Earn leg** — agent gets paid through its own endpoint | `pnpm demo:earn` | attested credits, `paymentFlow: 'upfront'` |
| **Write-ahead order, provable** | any spend | hold seq 28 → debit seq 29, same `holdId`, 36s apart |
| **Settlement by consensus** (HIP-423) | `pnpm settle` | 4 receipts → 1 transfer of `+0.1100`, schedule `0.0.10390470` executed at `1788686819.057159551` |
| **Reconciliation** | `pnpm reconcile` | `matched 1 · violations 0 · questions 0`; writes repairs with `--repair` |
| **Ceiling engine** | `pnpm engine:once --publish` | 9 ceilings published, each with its canonical input hash |
| **Underwriting is the binding constraint** | same | `ceiling 0.3528 bound by computed` — not by the grant |
| **Loop attack caught** | `pnpm attack` | shill `0%` BLOCKED, `COMMON_FUNDER`, revenue `0.0720 → 0.0000` |
| **Refusal from the real fast path** | see `docs/DEMO.md` | `CEILING_EXCEEDED`, shortfall `0.0500` |
| **Verify, by a stranger** | `pnpm verify-tab` / `verify-ceiling` | 6 of 7 `tab-v1` ceilings pass under v1's frozen params, with v2 current |
| **Transparency, checked from outside** | see `docs/NETWORK_IMPACT.md` | input hash recomputed in a throwaway Python script, no repo access — MATCH |

Four native Hedera services (HCS, HTS, Schedule Service, Mirror Node); the track requires two.
Zero Solidity, enforced by `pnpm guard`.

### Packages: 19 written, 8 not

**Written.** `money` · `protocol` · `params` · `ledger` · `graph` · `scoring` · `mirror` ·
`hedera` · `x402` · `testkit` · `gateway` · `settlement` · `engine` · `web` · `verify` ·
`bootstrap` · `probes` · `honest-agent` · `loop-attacker` · `sdk` · `mcp`

**Not written.** `db` · `cache` · `fastpath` · `observability` · `cli` · `agentkit-plugin`

**361 tests:** ledger 53 · mirror 49 · gateway 36 · engine 34 · graph 32 · scoring 28 ·
params 27 · sdk 26 · settlement 26 · verify 22 · money 13 · mcp 12 · protocol 9.

**No app or package over 400 lines is untested.** `hedera` (629) and `x402` (404) remain, and both
are thin wrappers over an SDK whose behaviour a unit test cannot assert — see test debt.

### Parameters: v3 is in force

`MODEL_ID = tab-v3`. Three generations, each changing exactly one thing:

- **v1 → v2** — the starter floor `1.000000 → 0.250000`, because v1 made the product's central
  claim untestable: earned credit for one young customer is `0.2352` against a `1.0000` floor, so
  the grant dominated the earning for an agent's whole early life.
- **v2 → v3** — the independence discount steps moved INTO the set, and `unverifiedBp` (50%) is
  new. The five existing values are unchanged, so no weight moved by relocating them (confirmed
  live: the same three counterparties still weigh 0%, 0%, 33%).

`v1.ts` and `v2.ts` are byte-identical and stay forever; all three hashes are pinned in
`params.test.ts` as a tripwire. **`verify-ceiling` passes ceilings published under all three, each
against its own frozen set — 13 of 14.** The one failure is `seq 1` and is genuine: hash matches so
the record is authentic, ceiling *value* matches, but the `binding` label reads `unrated` where
today's formula says `computed`, because `computeCeiling` changed after publication without a
version bump. No credit decision was affected. It stays visible — catching exactly that is what the
tool is for.

**`weights` is the schema's one optional field.** v1 and v2 genuinely had no frozen weight policy
(the steps lived in `apps/engine`), so back-filling it would claim a weight published under
`tab-v1` is reproducible from the frozen record when it is not. `weightPolicyFor` returns
`undefined` for pre-v3 — while an unknown *version* still throws, because a lookup bug and a fact
about history must not present identically.

**A published weight is now verifiable, not just readable.** `weightUpdate` carries `model`, and
`pnpm verify-ceiling` recomputes each weight from its published reasons and the frozen steps:
`SHARED_FUNDING_ROOT × YOUNG_ACCOUNT × CONCENTRATED` → `0.7 × 0.6 × 0.8` → `3360bp`, matching seq
34 on the live topic. The arithmetic is re-implemented in `tools/verify/src/reweigh.ts` rather than
imported from `@tab/graph` — calling the function that produced the number would prove only that it
is deterministic.

### Live testnet

| | |
|---|---|
| Operator / hot float | [`0.0.8812188`](https://hashscan.io/testnet/account/0.0.8812188) — fronts every spend |
| **Agent tab** | [`0.0.10390398`](https://hashscan.io/testnet/account/0.0.10390398) — **holds no key it needs**; receives, never signs |
| Receipt topic | [`0.0.10182696`](https://hashscan.io/testnet/topic/0.0.10182696) — **38 messages**: holds, debits, credits, refusals, repairs |
| Ceiling topic | [`0.0.10182697`](https://hashscan.io/testnet/topic/0.0.10182697) — **9 published ceilings**, each hash-verifiable |
| Settlement topic | [`0.0.10182698`](https://hashscan.io/testnet/topic/0.0.10182698) — **5 settlement receipts** |
| Token | [`0.0.429274`](https://hashscan.io/testnet/token/0.0.429274) · **REAL testnet USDC** · 6dp. `TUSD` `0.0.10182853` was the stand-in and is superseded; receipts before the switch are TUSD-denominated and carry no `tok` |
| x402 seller | [`0.0.10379572`](https://hashscan.io/testnet/account/0.0.10379572) — stock `@x402/hedera`, unaware Tab exists |
| Facilitator fee payer | [`0.0.10379287`](https://hashscan.io/testnet/account/0.0.10379287) · **ECDSA** |
| Direct customer | [`0.0.10385196`](https://hashscan.io/testnet/account/0.0.10385196) — funded by the operator, so `COMMON_FUNDER` blocks it |
| Indirect customer | [`0.0.10393567`](https://hashscan.io/testnet/account/0.0.10393567) — via intermediary `0.0.10393561`, so **discounted (33%) not blocked** |
| Attacker shills | `0.0.10392362`, `0.0.10393604` — funded directly, **0% BLOCKED** |
| Executed schedules | `0.0.10390303` · `0.0.10390470` · `0.0.10390637` · `0.0.10392071` |

**A working x402 payment needs THREE distinct accounts** — payer, `payTo`, fee payer. The scheme
rejects a transfer the fee payer is party to. `pnpm payer:create` and `pnpm seller:create` exist
for this.

---

### GAPS — ranked, because they are not equal

**Correctness and security. Fix these before scaling anything.**

1. ~~The independence graph FAILS OPEN~~ — **CLOSED 2026-09-09, in two halves.**
   Ancestry was re-derived every pass from Mirror Node's transactions-by-account index, which is
   *intermittent* for new accounts — measured returning 5 transactions once and 0 both before and
   after, minutes apart. A failed fetch weighted the counterparty **independent**, and the loop
   attacker went uncaught on its first full run because of exactly this.

   Observed facts now go on the **ceiling topic** as `graphFact` messages, and `factsFromMessages`
   merges monotonically — once a funder is known, later silence cannot erase it. So an outage now
   costs a cheaper answer rather than a wrong one. **Not `@tab/db`, deliberately:** a private
   database would have put the graph's inputs somewhere a stranger cannot see, which is why
   `verify-ceiling` could check a ceiling's arithmetic but never its graph. It also needs no
   database, which matters given there is no budget.

   **The second half — v3.** The residual was an account *never successfully observed*: nothing to
   remember, so absent ancestry still read as absent relationship and the counterparty was
   weighted INDEPENDENT. `UNVERIFIED_FUNDING` now discounts it to **50%**. A discount and not a
   block, because blocking would turn routine Mirror Node lag into a simultaneous refusal for
   every counterparty — the original fail-open existed partly for that reason and the reason was
   sound, only its magnitude was wrong. It is self-healing: the moment provenance IS observed it
   is published, and a published fact is never forgotten, so it cannot apply to the same account
   twice. The starter floor still binds for a new or small agent, so it cannot stop one opening.

   **Nothing here is unhandled any more.** What remains is a *documented property*, not a gap: a
   counterparty whose provenance we have never seen counts for half rather than nothing, which is
   a deliberate calibration and is stated in `v3.ts`, in the console's config view, and on the
   Counterparties evidence panel.
2. **No registration flow.** Nothing writes a `register` message, so one Starter Tab per funding
   root is unenforced and bulk-minting agents to farm Starter Tabs is not prevented. The README
   labels it OPEN as of 2026-09-08. `@tab/graph` already resolves funding roots, so the check is
   cheap once a registration flow exists.
3. **No spend-side concentration cap.** The cap that exists measures REVENUE concentration on the
   earn leg — a different rule. A spend-side version needs a minimum-volume floor first, or a new
   tab's first spend is 100% concentrated by definition and every opening call is refused. README
   labels it OPEN.
4. **The double-settlement damage is still on the receipt topic.** `verify-tab` exits non-zero on
   it, correctly — window 5962288 really was paid twice, by a bug since fixed. Live data state, not
   a code bug.
5. **`FLOAT_TOTAL_USDC` is on no topic**, so the full float invariant is not stranger-checkable.
   Publish it at bootstrap.

**Scaling. Named honestly in `docs/NETWORK_IMPACT.md`, none of it demo-blocking.**

6. **The gateway is SINGLE INSTANCE** — holds live in process memory, so two instances would each
   allow up to the ceiling. `@tab/cache` fixes it; measured p99 **1.5ms**, 33× inside the 50ms
   budget.
7. **Ceiling publication is not serialised.** Two workers publishing for one agent make the topic
   ambiguous. Needs a job key per agent.
8. **One hold message per attempted spend** triples topic volume. Production wants a rolling batch
   commitment.
9. **Replay cost grows with topic length** — every worker boot and every `verify-tab` replays from
   sequence 1. Needs periodic checkpoints.

**Test debt. `mirror` is DONE; `gateway` is now the largest untested surface.**

| Package | Untested | Why it matters |
|---|---|---|
| ~~`mirror`~~ | ~~1,060~~ | **49 tests as of 2026-09-09**, and they found a real bug — see the log |
| ~~`gateway`~~ | ~~1,646~~ | **36 tests as of 2026-09-09**, and they found a fifth private copy of a shared function |
| ~~`settlement`~~ | ~~963~~ | **26 tests as of 2026-09-09** — all three of its historic incidents locked down |
| `hedera` | 629 | Every chain write. **Now the biggest**, and the hardest to unit-test honestly: it is a thin wrapper over `@hiero-ledger/sdk`, so a mock would assert that we called the SDK the way we already know we call it. The probes cover it against a real chain |
| `x402` | 404 | Four separate bugs already hid here, and every one was a LIVE behaviour a mock would have reproduced wrongly (`paymentFlow` vs `assetTransferMethod`, V1 vs v2 field names, a 10s connect timeout surfacing as a signature error) |

**Presentation.**

10. ~~`apps/web` is partly live~~ — **all eight views read live data as of 2026-09-09.** The
    console states `LIVE` / `MOCK DATA` / `GATEWAY UNREACHABLE` on screen, and two views
    (`ceiling`, `agents`) deliberately have NO mock fallback: a fabricated ceiling with a
    fabricated input hash, or an invented list of agents under a "Registry" heading, are the two
    screens where mock data would actively mislead rather than merely stand in.

    Wiring them found **eleven invented figures on screens that were already live**, which is
    the real lesson: a view marked LIVE is not the same as a view whose every figure is live.
    Worst three were a `MODEL_VERSION` that appears on no topic, a `window spend` tile reading a
    hardcoded `0.62 / 1.00` beside a live balance, and a **"Recompute and verify" button that
    flipped a boolean and stamped VERIFIED in green.**
11. **No demo video, no user-testing evidence.** Only the user can produce these.
12. **The plan's demo script is stale in two places**: it says the attack collapses the ceiling
    (it does not — the fake revenue never inflates it), and "ramp 15% → 30%" (it reads 25% → 40%).
    `docs/DEMO.md` has the corrected beats.

---

### What is next, in order

1. ~~Wire `apps/web` THROUGH `@tab/sdk`~~ — **DONE 2026-09-09. All eight views are live.**

   Four things worth knowing from that work:
   - The console printed `MODEL_VERSION = ceiling-v0.4.1` in five places. Every published ceiling
     says `tab-v2`, and `verify-ceiling` picks the frozen parameter set by that field, so a
     verifier reading the console was hunting a set that does not exist. `config` now derives every
     row from `@tab/params`.
   - The ceiling view had a **"Recompute and verify" button that flipped a boolean and stamped
     VERIFIED in green.** It recomputed nothing and could not — `web` cannot import
     `@tab/scoring`. Deleted. In its place: seq, model id, input hash, a HashScan link and
     `pnpm verify-ceiling`, with a sentence saying this panel is not the verifier. A checker
     running inside the thing it checks proves nothing.
   - The settlements banner printed `checked 43 · matched 43 · repaired 0` from a mock. It now
     derives from the rows and surfaces the **real double settlement** (window 5962288, seq 1 and
     seq 2, two transaction ids). HCS is append-only; printing CLEAN over a permanent scar was the
     more dishonest option.
   - The `agents` view was headed **"Registry"**, with a `registered` column and a green
     `STARTER TAB ISSUED` stamp — for a registration flow that **does not exist** (gap #2). It now
     lists the tabs the gateway saw on the receipt topic and states the unenforced rule at the top.
     `GET /v1/tabs` carries `registrationEnforced: false` on the response so no consumer can make
     that mistake again, and the SDK reads a *missing* field as false.
2. ~~Fix the false attack-catalogue claims~~ — **done 2026-09-08.** Five lines corrected; two moved
   from *Caught* to *OPEN*. The spend-side concentration cap and the registration flow are the two
   genuinely unbuilt rules, and both are now labelled OPEN in the README.
3. ~~`@tab/db`~~ — **not needed for the fail-open, and not built.** Facts on HCS closed it
   without a database and left the graph's inputs stranger-checkable, which a private store would
   not. `@tab/db` is still the right answer for *replay cost* (gap 9) rather than for correctness.
4. ~~Tests for `mirror`~~ — **done 2026-09-09, 49 tests.** `gateway` is now the largest untested
   surface at 1,132 lines.
5. **v3, to close the residual fail-open** — discount a counterparty whose provenance has never
   been observed, instead of trusting it. A policy change that moves ceilings, so it needs a new
   frozen parameter set rather than an edit; `paramsForVersion` and the freeze machinery already
   exist.
6. ~~`@tab/sdk` → `@tab/mcp`~~ — **DONE 2026-09-09.** 7 tools, 12 tests through a real MCP client,
   verified over JSON-RPC on stdio against the live gateway. Three lines in
   `claude_desktop_config.json` and Claude Desktop is spending on a Hedera tab. The README's open
   question (standalone server vs documenting an Agent Kit plugin path) is settled in favour of
   standalone, with the reasoning recorded there. `cli` and `agentkit-plugin` are still not worth
   it.
7. ~~Tests for `settlement`~~ — **done 2026-09-09, 26 tests.** The matching had to be extracted to
   `matching.ts` first: `reconcile.ts` reads `process.env` and throws at module level, so importing
   the pure function ran the whole CLI.
8. **Not worth building:** `fastpath`, `observability`. Their absence is documented as named limits
   with causes, which reads better to a judge than a half-built version.

### Read these before you write code

Each of these cost real hours and will cost them again if rediscovered.

**Network and API behaviour**

1. **Node's `fetch` has a 10s connect timeout no `AbortController` can extend.** Mirror Node needs
   5–15s from a high-latency link. Every entry point must call `configureGlobalHttp()` from
   `@tab/mirror` **before any HTTP**. Skip it and x402 reports
   `invalid_exact_hedera_payload_signature_invalid` — a signature error for a network problem.
2. **Mirror Node returns empty pages mid-result-set.** Stop only on `links.next === null`; use
   `walk()`.
3. **Never diff Mirror Node account balances to prove value moved** — they are snapshots. Fetch the
   transaction and assert on `result` plus the transfer list. Use `getBalanceSnapshot` when you need
   the `asOf` timestamp, which any INVARIANT does.
4. **`/transactions?account.id=` is INTERMITTENT for a new account** — not merely lagging. Measured
   returning 5 rows once and 0 both before and after, minutes apart, while the balance endpoint was
   correct throughout. **Never derive a security input from it.** Resolve ancestry by point lookup:
   `/accounts/{id}` for `created_timestamp`, then `/transactions?timestamp=<exact>`.
5. **Read a transaction's payer from the transaction ID's own prefix**, never from the transfer
   list — fee collectors (`0.0.98`, `0.0.802`) appear there with POSITIVE amounts, so "most negative
   entry" is a heuristic that works until it does not.
6. **Schedule state comes from Mirror Node, not `ScheduleInfoQuery`** — a consensus node that did
   not see the create returns `INVALID_SCHEDULE_ID`.

**x402**

7. **A payment needs THREE distinct accounts** — payer, `payTo`, fee payer. The scheme rejects a
   transfer the fee payer is party to.
8. **The Hedera exact scheme's default `authorization` flow settles AFTER the handler.** A resource
   server that credits revenue in its handler is crediting a payment that has not settled. The earn
   route declares `extra: { paymentFlow: 'upfront' }`. The key is `paymentFlow` —
   `assetTransferMethod` is a different axis and fails at boot.
9. **The settlement id is on `header.transaction`**, not `settlement.transaction`. Reading the
   wrong one made every debit fall back to `unsettled:` for days, and an inline `as {...}` cast hid
   it: **a cast asserts a shape rather than checking it.**
10. **A hardcoded client-side spend cap silently rejects everything when the endpoint price
    changes**, reported as `All payment requirements were rejected by spendControls` — which reads
    like a protocol fault. Bit two demo runs.

**Our own design, learned the hard way**

11. **The agent's tab holds no key, so it can NEVER be a funder.** `FUNDED_BY_AGENT` is
    structurally unreachable for a Tab agent; `COMMON_FUNDER` is the rule that fires.
12. **A rule is not working just because it is written.** THREE control rules were unreachable
    because nobody asked them: `FUNDED_BY_AGENT` (impossible), the tab's own ancestry (never
    fetched), and `SHARED_FUNDING_ROOT` (facts only one hop deep). Verify a rule FIRES before
    trusting it.
13. **`MODEL_VERSION` covers the FORMULA, not only the parameter numbers.** Changing
    `computeCeiling`'s behaviour without a bump makes published ceilings unreproducible.
    `verify-ceiling` caught exactly that.
14. **Anything replaying tab history must merge the receipts AND settlements topics.** Replaying
    only receipts made every closed window look unsettled forever and re-paid it every pass.
15. **A DEFAULT is zero; being NEW is the starter floor.** Keying the zero on `tier === 'Unrated'`
    meant a brand-new agent could never earn its way up — no revenue → Unrated → ceiling 0 → cannot
    spend → cannot earn.
16. **`--dry-run` must move nothing.** Suppressing only the receipt write made a "dry run" execute a
    real transfer and omit the receipt marking the window settled, leaving the next pass ready to
    pay it twice.
17. **On testnet nothing we create is genuinely independent** — every account descends from our
    faucet account. The demo distinguishes direct control from indirect relation, not control from
    true independence. Say so.

### Environment

| | |
|---|---|
| `REDIS_URL` | set — Upstash **us-east-1**. Use a **local Redis for the demo** (`redis-server --port 6380`, already installed) or the 50ms claim is not demonstrable |
| `DATABASE_URL` | set — Supabase **pooler, session mode 5432** (the direct host is IPv6-only and this machine has no IPv6). Still unused: `db` is unwritten |
| `TAB_ACCOUNT_ID` | **required** by the gateway and the settlement worker, and must differ from the float |
| `PER_CALL_CAP_USDC` / `STARTER_CEILING_USDC` | optional **overrides**; the defaults now come from `@tab/params` v2 |
| `TRAILING_WINDOWS` | how many closed windows the revenue average spans. `1` for the demo |
| `DEMO_PAYER_ACCOUNT_ID` / `_KEY` | written by `pnpm demo:payer`, never printed |
| Real USDC | not obtained. Circle's faucet reported drips that never arrived. Proven not to block anything — `TUSD` stands in |

### Track board

**No assigned owners. Everyone is equal — claim a track, work it, release it.** Put your name in
*Claimed by* when you start and clear it when you stop, so two people never edit the same package in
parallel. That is the only rule, and it is about merge conflicts, not authority.

| Track | Scope | Claimed by | Status |
|---|---|---|---|
| **P0** | `tools/probes` → `docs/probes.md` | — | **done** — all 5 answered plus Probe 6 (HIP-423) |
| **G** | `tools/guards` | — | **done** — 5 guards, negative-tested, pre-commit hook |
| **F1** | `money` · `protocol` · `params` | — | **done** — 41 tests. `params` at **v2**; v1 frozen beside it |
| **F2** | `ledger` | — | **done** — 39 tests. No generative property tests yet |
| **F3** | `scoring` · `graph` | — | **done** — 55 tests. The loop attack is caught by `graph` |
| **A1** | `hedera` · `observability` | — | hedera **done** incl. HIP-423 schedules. `observability` unwritten and **not worth building** |
| **A2** | `mirror` · `db` | — | mirror **done but UNTESTED (1,060 lines)** — highest-risk surface. `db` unwritten and **closes the fail-open exposure** |
| **A3** | `x402` | — | **done** — both roles live on testnet. `paymentFlow: 'upfront'` on the earn leg |
| **A4** | `cache` | — | unwritten. **Read Probe 5 first**: co-located p99 1.5ms; the hold reserve cannot be cached away |
| **FAST** | `fastpath` · `apps/gateway` | — | gateway **done** — both legs, holds published, consumes ceilings from HCS. `fastpath` unwritten; checks are inline |
| **SLOW** | `apps/engine` · `apps/settlement` | — | **both done and live.** No BullMQ/indexer; ceiling publication not serialised |
| **S1** | `sdk` · `cli` | — | `sdk` **done** — 14 tests, verified live. `cli` unwritten and **low value** |
| **S2** | `agentkit-plugin` | — | unwritten. **The README falsely claims this exists** — build it or correct the line |
| **S3** | `apps/web` | — | **4 views LIVE** (tab, receipts, refusals, counterparties) through `@tab/sdk`. `settlements`, `ceiling`, `agents` need gateway endpoints; `config` can read `@tab/params` directly |
| **S4** | `mcp` | — | unwritten. The one agent-surface package with real demo value |
| **D1** | `tools/verify` | — | **done** — 11 tests. Both commands run; caught two of our own mistakes |
| **D2** | `agents/honest-agent` | — | **done** — zero dependencies, spends and earns |
| **D3** | `agents/loop-attacker` | — | **done** — runs the attack live on public surfaces only |

### Blocked / open questions

| What | Blocking whom | Owner |
|---|---|---|
| **Demo video, user-testing evidence** — a large share of the rubric, still zero | submission | **needs the user** |
| **Publish holds in batches, or keep one message per attempted spend?** One-per-spend triples topic volume and slows every replay | `protocol`, `gateway` | — |
| **Publish `FLOAT_TOTAL_USDC` at bootstrap** so the float invariant is fully stranger-checkable | `bootstrap`, `protocol`, `verify` | — |
| Test against a **third-party public** x402 seller — ours is stock, which tests "unmodified" but not a public facilitator accepting HTS | `x402`, `gateway` | — |
| Standalone MCP server, or load our plugin into the official Agent Kit MCP server? | `mcp` scope | — |
| `AGE_FULL_DAYS` is tuned to 7 for testnet and said out loud in the config dump. Right value for mainnet? | `params` | — |
| ~~`DATABASE_URL` not set~~ | `db` | **set** — Supabase pooler, session mode 5432 |
| ~~Probe 5: fast-path latency~~ | `cache` | **answered** — co-located 1.5ms; the demo must use local Redis |
| ~~Match `x402-hedera-receipts` or go bespoke?~~ | `protocol` | **decided: bespoke** — log 2026-08-22 |
| ~~Settlement schedule timing~~ | `settlement` | **decided** — at window close, [ADR-0009](docs/adr/0009-settlement-schedule-timing.md) |
| ~~Whether to publish holds at all~~ | `protocol` | **decided: yes** — the write-ahead order is now provable |
| ~~Lower the starter floor?~~ | `params` | **decided: yes, as v2** — v1 made "credit is earned" untestable |

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
| 2026-09-08 | **COUNTERPARTY WEIGHTS ARE PUBLISHED — `weightUpdate` (`t: 'weight'`) on the ceiling topic.** The engine computed these and published them NOWHERE; the three-way weight table that is the demo's strongest artifact existed only in engine stdout. **ONE MESSAGE PER COUNTERPARTY**, because an array inside the ceiling message hits the **1024-byte single-chunk limit** with a handful of them and `encode()` refuses anything larger. Verified live: seq 11, `bp=3360`, `why=[SHARED_FUNDING_ROOT, YOUNG_ACCOUNT, CONCENTRATED]` — and `3360` is reproducible as `0.7 × 0.6 × 0.8` | `protocol`, `engine`, `gateway`, `sdk`, `web` |
| 2026-09-08 | **`WEIGHT_REASONS` MOVED FROM `@tab/graph` TO `@tab/protocol`.** They are a published interface, like `REFUSAL_CODES` — they go on HCS and are rendered in the console, and `apps/web` may not import `graph`. Keeping them in graph forced the console to invent its own vocabulary, and it did: **seven names, two of which existed, and no `COMMON_FUNDER`** — the rule that actually fires. Its `chipTone` matched `HARD_BLOCK*`, so every real hard block would have rendered as a mere caution | `protocol`, `graph`, `sdk`, `web` |
| 2026-09-08 | **EVERY reason is published and rendered, not just the first.** Three fire at once on live data and their PRODUCT is the weight. One reason leaves a number nobody can reproduce | `protocol`, `web`, `engine` |
| 2026-09-08 | **Weights are published BEFORE the ceiling.** The ceiling is the conclusion and the weights are its evidence, so a reader who sees a ceiling can already find the reasons. The other order leaves a window where the console shows a collapsed ceiling and no reason for it | `engine` |
| 2026-09-08 | **`firstSeen`, `ageDays`, `direction` and `hops` are NOT published.** The engine knows all four. The console renders `—` rather than inventing them, and the Evidence panel returns null for a live row rather than showing an empty funding chain that would imply the graph found no ancestry. Publishing the funding path is the obvious next protocol addition | `engine`, `protocol`, `web` |
| 2026-09-08 | **THE CONSOLE IS WIRED TO LIVE DATA THROUGH `@tab/sdk`** — `tab`, `receipts` and `refusals` now poll the gateway. **It states its source on screen**: `LIVE` when `NEXT_PUBLIC_TAB_ACCOUNT_ID` is set, `MOCK DATA` styled as a warning otherwise, plus `GATEWAY UNREACHABLE` on a failed poll. A console that silently falls back to invented numbers is one that will be filmed showing invented numbers | `web`, demo |
| 2026-09-08 | **`NEXT_PUBLIC_*` IS READ FROM THE MONOREPO ROOT `.env` VIA `next.config.ts`.** Next loads `.env` relative to the APP directory and inlines `NEXT_PUBLIC_*` at BUILD time — so a root-level `.env` was invisible and the console rendered mock data while appearing configured. Only the two `NEXT_PUBLIC_` keys are lifted; forwarding `.env` wholesale would put private keys in a browser bundle | `web` |
| 2026-09-08 | **Entries carry `seq` and `requestHash` now** — the HCS sequence number and the published request hash, both optional because an entry created in-process has neither yet. The console shows the real sequence number instead of a counter of its own, and renders `pending` rather than inventing one. Live: `seq` present on all 35 entries, `token` on the 8 written since `tok` existed | `ledger`, `sdk`, `gateway`, `web` |
| 2026-09-08 | **The UI's `Leg` type had THREE values; the topic has SIX.** `HOLD`, `REPAIR` and `SETTLEMENT` were unrenderable. A `HOLD` row immediately before its `DEBIT` is the write-ahead ordering visible on screen — the property a viewer would otherwise have to take on trust | `web`, `protocol` |
| 2026-09-08 | **REAL TESTNET USDC IS IN THE FLOAT — `USDC_TOKEN_ID=0.0.429274`.** The faucet worked all along; it delivered 20.000000 USDC to the OPERATOR (`0.0.11920 → 0.0.8812188`), not to a wallet. `TUSD` is no longer needed. Real USDC is **6 decimals, same as the stand-in**, so `MicroUsdc` is unchanged. Also markedly faster: a spend settles in **4-5s** against 25-39s on TUSD | everyone; `NETWORK_IMPACT.md` fee/latency figures |
| 2026-09-08 | **RECEIPTS NOW CARRY `tok` — the token every amount is denominated in.** They previously recorded amounts with NO currency: each figure meant "whatever `USDC_TOKEN_ID` was configured when it was written". Invisible with one token, and the moment a deployment switches, the topic holds two currencies with nothing distinguishing them — a stranger replaying it would be **summing TUSD and USDC and reporting the total as money**. `Entry.token` carries it, and **`verify-tab` filters on it and reports what it excluded** | `protocol`, `ledger`, `verify`, `gateway`, `settlement`, `engine` |
| 2026-09-08 | **THE GATEWAY DEBITED THE CAP, NOT THE SETTLED AMOUNT.** `amount: micro(-request.max)` — so a spend capped at `0.200000` against a seller charging `0.040000` debited the agent `0.200000` and the float kept `0.160000`. Invisible for as long as every demo set `max` equal to the price. `@tab/x402`'s `call()` now returns `amountPaid`, captured from the requirement the client accepted; the gateway debits that and warns loudly when x402 reports no price | `gateway`, `x402`, `settlement`, `verify` |
| 2026-09-08 | **x402 v2 `PaymentRequirements` uses `amount`; `maxAmountRequired` is the V1 field.** Reading the V1 type found no price and silently fell back to the cap — the exact overstatement above. Both are checked now | `x402` |
| 2026-09-08 | **Mirror Node returns `decimals` as a STRING from `/tokens/{id}` and a NUMBER from `/accounts/{id}/tokens`.** `@tab/mirror` declares the union honestly (`string | number`); the caller must normalise. Comparing it with `!== 6` produced the memorable error *"USDC has 6 decimals, not 6"* | `bootstrap`, anyone reading token info |
| 2026-09-08 | **`0.0.10845404` is a MAINNET account.** A testnet faucet cannot pay it — separate ledgers, separate account-number namespaces, and the same seed gives a different id per network. A transfer to it fails `INVALID_ACCOUNT_ID`, proven. You cannot activate a non-existent account number by sending to it; only an ALIAS (public key or EVM address) auto-creates, and the network picks the number | demo, docs |
| 2026-09-08 | **AMOUNT FIELDS IN THE GATEWAY'S JSON USE `toWire`, NEVER `format`.** `format` is a DISPLAY function — 4 decimals and a U+2212 minus. The API served it, so `1.234567` went out as `"1.2345"` and parsed back as `1234500`: **67 micro-USDC silently lost per value.** A dashboard built on that cannot match HashScan, which is the one thing a dashboard must do. Prose messages may embed `format` inside a sentence | `gateway`, `sdk`, `web` |
| 2026-09-08 | **`usdc()` is TOO PERMISSIVE to be a wire parser** — it accepts a U+2212 minus and pads a 4-decimal value, so the loss above was undetectable. `@tab/sdk` validates `/^-?\d+\.\d{6}$/` BEFORE parsing and rejects a display string with a message naming the cause. The tolerance in `usdc()` is right for human input and wrong for a wire boundary | `sdk`, `money`, anyone parsing amounts |
| 2026-09-08 | **The gateway now rebuilds through `entriesFromMessages` from `@tab/ledger`.** It had its own `toEntry` with no `case 'hold'`, so **published holds were silently dropped on every restart** — a pending hold vanished from the projection, `available` came back overstated, and the agent could spend headroom that was reserved. Verified fixed: a restart now replays `hold: 2`. **THIRD message type lost to a private replay copy**, after settlements in the worker. There is one decode; use it | `gateway`, `settlement`, `engine`, `verify` |
| 2026-09-08 | **`@tab/sdk` is written, and `web` may only read through it** (`allow: ['money','protocol','params','sdk']`). Wiring the dashboard with direct `fetch` calls would make that boundary decorative, which is why the SDK came before the frontend. A refusal is a VALUE, not an exception; guidance comes from `@tab/protocol`, never from the wire; retries are transport-only and report an **UNKNOWN** outcome rather than claiming nothing was spent | `sdk`, `web`, `mcp`, `cli`, `agentkit-plugin` |
| 2026-09-07 | **`@tab/params` v2 IS THE SET IN FORCE (`tab-v2`). One change from v1: the starter floor `1.000000 → 0.250000`.** v1 made the product's central claim untestable — earned credit for one young customer is `0.2352` against a `1.0000` floor, so the GRANT dominated the EARNING for an agent's whole early life. `v1.ts` is byte-identical and stays forever; its frozen hash test is unchanged. **`pnpm verify-ceiling` still PASSES all six ceilings published under `tab-v1`**, because it resolves each message's own `model` field — the frozen-set claim demonstrated, not asserted | `params`, `scoring`, `engine`, `verify` |
| 2026-09-07 | **The gateway's starter ceiling now comes from `@tab/params`, not a local env default.** It read `STARTER_CEILING_USDC ?? '1.000000'`, a SECOND source of truth for a policy number params exists to own — and it showed immediately: v2 lowered the floor to 0.25 and the gateway kept granting 1.0. Same for the per-call cap. The env vars remain as explicit demo overrides | `gateway`, `params` |
| 2026-09-07 | **The engine RESUMES its in-force ceiling from the ceiling topic on a cold start.** It used to seed from its own fresh computation, which was a hole in the asymmetry rule: a restart accepted whatever it had just computed, so a growth the running engine would have HELD became effective simply because the process bounced. The published ceiling is the durable record of what is in force | `engine`, `verify` |
| 2026-09-07 | **`ceilingsFromMessages` lives in `@tab/ledger`** — the gateway enforces the ceiling and the engine seeds from it, and both had a copy. `tools/verify` deliberately keeps a FOURTH reader, because it needs the `inputs` object verbatim to rehash and a typed round-trip risks changing key order. That difference is real and is not consolidated away | `ledger`, `gateway`, `engine`, `verify` |
| 2026-09-07 | **THE ATTACK DOES NOT CAUSE A CEILING COLLAPSE, and the plan's 1:10 beat is wrong about why.** Manufactured revenue is worth ZERO from the first engine pass that can see the funding edge, so the ceiling never inflates and there is nothing to collapse. The detector is faster than the demo script assumed. The honest beat is "the manufactured revenue counts for zero and the ceiling does not move — the attack buys nothing" | `web`, demo, `loop-attacker` |
| 2026-09-07 | **`SHARED_FUNDING_ROOT` was unreachable — the THIRD rule of that family.** `facts` only held one `fundedBy` per account, so the traversal saw one hop each side and never the chain between. `apps/engine` now walks ancestry to `params.fundingAncestryHops`, memoised. Verified live: the indirect customer went from 48% (young × concentrated) to **33%** (0.7 × 0.6 × 0.8) once the shared root was visible | `engine`, `graph`, `verify` |
| 2026-09-07 | **v1's STARTER FLOOR PINS A NEW AGENT'S CEILING.** Earned credit for one young customer is `1.0000 × 0.336 × 1.0 × 0.70 = 0.2352`, against a floor of `1.0000` — so the floor, not the underwriting, decides the ceiling for an agent's whole early life. Beating it needs **>4.25 raw revenue** (~9 calls at 0.50) from a single customer. **Lowering the floor is a `v2`, not an edit** — ceilings are already published under `tab-v1`. User's decision, laid out in `docs/DEMO.md` | `params`, `scoring`, demo |
| 2026-09-07 | **On testnet nothing we create is genuinely independent.** Every account descends from our faucet account, so `COMMON_FUNDER` fires on every payer we make. `pnpm demo:payer` builds an INDIRECTLY related one (operator → intermediary → customer) whose immediate funder differs, so it is discounted not blocked. The demo therefore distinguishes **direct control from indirect relation**, NOT control from true independence — say so out loud | demo, `graph`, `bootstrap` |
| 2026-09-07 | **A client-side x402 spend cap that is hardcoded silently rejects everything when the endpoint price changes**, and x402 reports it as `All payment requirements were rejected by spendControls` — which reads like a protocol fault. Bit two demo runs. `PAYER_MAX_PER_CALL_USDC` and `ATTACK_MAX_PER_CALL_USDC` are configurable now | `testkit`, `loop-attacker`, `x402` |
| 2026-09-07 | **`pnpm demo:payer` writes its key straight to gitignored `.env` and never prints it.** `pnpm payer:create` still prints its key; it should follow. A private key in terminal scrollback is a private key in the screen recording, and these scripts run during a demo | `bootstrap`, demo |
| 2026-09-07 | **HOLDS ARE PUBLISHED, and the gateway AWAITS consensus on the hold before paying.** `reserve → pay → commit` is now verifiable by a stranger: same `holdId`, hold strictly before debit on the topic (proven live — seq 28 hold, seq 29 debit, 36s apart). **The await is the point** — publishing after the payment, or not awaiting, puts the two messages on the topic in an order that proves nothing. The spend FAILS CLOSED if the hold cannot be published: paying with no published authorisation produces exactly the debit-from-nowhere this removes | `gateway`, `protocol`, `ledger`, `verify` |
| 2026-09-07 | **Cost of publishing holds, measured not guessed:** one extra message per attempted spend, ~2-4s of consensus on a spend path already taking 25-39s on x402 HTS settlement — about 10%. It does NOT touch the 50ms authorization budget, which is the cache read before it. At high volume this triples topic size and slows every replay; the production answer is a rolling batch commitment, not one message per hold | `gateway`, `fastpath`, `cache` |
| 2026-09-07 | **`checkPublicLedger` takes `holdsPublishedFrom`, and debits before it are EXCLUDED from the hold rule and COUNTED.** Holds were added after receipts already existed, so asserting the new rule against old data marked every historical debit as having "bypassed reserve" — eleven red lines that were not defects and which buried the one finding that was. A stranger derives the cutover the same way `verify-tab` does: the consensus timestamp of the first `hold` message. With NO cutover given the rule is strict — an absent option must never silently disable a check | `verify`, `ledger` |
| 2026-09-07 | **`LOCAL_ONLY_INVARIANTS` is now EMPTY**, and `verify-tab` still prints the line. "Nothing was skipped" is a claim a stranger needs made explicitly — silence is indistinguishable from a verifier that forgot to mention what it left out. If a future invariant needs private state, it goes back in that list | `verify`, `ledger` |
| 2026-09-07 | **`MODEL_VERSION` COVERS THE FORMULA, NOT ONLY THE PARAMETER NUMBERS.** `verify-ceiling` caught me breaking this: I changed `computeCeiling`'s Unrated/`hasDefaulted` behaviour without a version bump, so ceiling seq 1 — published under `tab-v1` — no longer reproduces under today's `tab-v1`. Its hash still MATCHES, so the record is authentic; the code that produced it changed. **Any change to `computeCeiling`'s behaviour is a version bump, exactly like a parameter change** | `params`, `scoring`, `engine`, `verify` |
| 2026-09-07 | **Two kinds of verify-ceiling failure, and they mean OPPOSITE things.** `hash_mismatch` — the published inputs do not hash to the published hash; the record contradicts itself, suspect the publisher. `not_reproducible` — the hash matches but today's code gives a different number; the record is genuine and OUR release process failed. Conflating them would send a reader to the wrong conclusion about whether to trust the topic | `verify`, `web` (the verify button) |
| 2026-09-07 | **`checkLedger` CANNOT be run against an HCS replay — use `checkPublicLedger`.** `@tab/protocol` has no hold message: holds live in gateway memory and never reach a topic, so a replay has debits with no holds and `debit_has_hold` fails for EVERY debit on a correct ledger. `verify-tab` printed FAIL for all three tabs, which a stranger would read as fraud. The invariant set now splits public (assertable from receipts alone) from local (needs the in-process hold table), and `verify-tab` names what it cannot check instead of skipping it silently | `verify`, `ledger`, `gateway`, `engine` |
| 2026-09-07 | **OPEN DECISION: publish holds, or not.** Publishing them makes the write-ahead `reserve → pay → commit` ordering auditable by a stranger; it costs an HCS message per ATTEMPTED spend — including every hold that expires unused — on the latency path the fast/slow split exists to protect. Currently NOT published, so that ordering is not externally verifiable. Worth a decision rather than a default | `protocol`, `gateway`, `verify` |
| 2026-09-07 | **`FLOAT_TOTAL_USDC` is the one number a stranger cannot derive.** Not on any topic, so `verify-tab` asserts the full float invariant only when told it. That is a real gap in the transparency claim, not a config detail — the fix is to publish the float total at bootstrap so the starting balance is as auditable as everything built on it | `verify`, `bootstrap`, `protocol` |
| 2026-09-07 | **`getBalanceSnapshot` returns a balance AND its `asOf` timestamp.** Use it for any INVARIANT; `getUsdcBalance` is for funding checks. `verify-tab` bounds its replay to the OLDER of two account snapshots, because comparing a stale balance to receipts replayed to now fails on a correct ledger | `mirror`, `verify`, `engine` |
| 2026-09-06 | **`FUNDED_BY_AGENT` CAN NEVER FIRE FOR A TAB, and the hard block the design leaned on was dead code.** An agent's tab holds no key by design — it receives settlement payouts and signs nothing — so a tab cannot fund anybody. The reachable control shape is one operator behind both accounts, now `COMMON_FUNDER`: the same account funded the tab AND the counterparty. Hard block. Honest limitation documented in `clusters.ts`: if a public exchange funded both, it fires wrongly, which is defensible only because a Tab is funded by the gateway's float rather than an exchange | `graph`, `engine`, `web`, `verify` |
| 2026-09-06 | **Mirror Node's `/transactions?account.id=` index is INTERMITTENT for a new account, not merely lagging.** Against a real attacker account it returned 5 transactions once and 0 both before and after, minutes apart, while `/accounts/{id}/tokens` showed the funded balance correctly the whole time. **The loop attacker ran end to end and was NOT CAUGHT because of it** — the engine fails open. Never derive a security input from that index | `engine`, `graph`, `verify`, `db` |
| 2026-09-06 | **`funderOf` is a POINT LOOKUP now**: `/accounts/{id}` for `created_timestamp`, then `/transactions?timestamp=<exact>` for the CRYPTOCREATEACCOUNT, and the funder is the transaction id's own payer prefix. Read the payer from the ID, never from the transfer list — fee collectors (`0.0.98`, `0.0.802`) appear there with POSITIVE amounts and "most negative entry" is a heuristic that works until it does not. Also more correct: "who created this" ≠ "earliest inbound transfer" | `engine`, `verify`, `graph` |
| 2026-09-06 | **A DEFAULT is zero; being NEW is the starter floor.** `computeCeiling` keys on `hasDefaulted`, not on `tier === 'Unrated'`. Zeroing on the tier meant a brand-new agent had no revenue → Unrated → ceiling 0 → could not spend → could never earn the revenue that would rate it. **The starter floor existed for exactly that case and was unreachable.** `hasDefaulted` is published as `def` in the ceiling inputs because it changes the output on its own | `scoring`, `engine`, `verify`, `web` |
| 2026-09-06 | **The ceiling message carries `computed` when the asymmetry rule holds a growth back.** `ceil` is what the fast path enforces; `hash` is over `inputs`, which recompute to the formula's result. Without a separate field those two claims contradict each other and `verify-ceiling` would report a mismatch that looks like fraud but is only the safety rule working. **`verify-ceiling` checks the inputs against `computed ?? ceil`** | `protocol`, `engine`, `verify`, `web` |
| 2026-09-06 | **The gateway CONSUMES published ceilings from HCS** (`replayCeilings`, polled every `CEILING_POLL_MS`, default 15s) and applies them to the fast path. Nothing private passes between engine and gateway — the ceiling in force is read from the same public record a stranger reads, which is what makes the attack demo mean anything | `gateway`, `engine`, `web` |
| 2026-09-06 | **A CEILING IS PUBLISHED TO HCS AND THE HASH VERIFIES FROM OUTSIDE THE REPO.** Ceiling topic `0.0.10182697` seq 1. The hash was recomputed in a throwaway Python script from nothing but the on-chain message — no repo, no database — and matched. The canonical rule is keys sorted, no whitespace, amounts as decimal strings, rates as integer basis points. **Anything that changes `ceilingInputRecord` changes every future hash**, so build the record field by field, never by spreading `CeilingInputs` | `engine`, `verify`, `web` (the verify button), `protocol` |
| 2026-09-06 | **v1 tier multiples CORRECTED to `A 30000 · B 20000 · C 10000 · Unrated 0`.** They were `C 12500 · Unrated 10000`, which contradicted the documented formula and made the engine print `Unrated ×1`. Nothing was mispriced — `computeCeiling` short-circuits Unrated to zero — but the published `mult` input claimed 1x for a tier that gets nothing. Legitimate to change because **no ceiling had ever been published under v1**; once one has, v1 is frozen and this would be a v2 | `params`, `scoring`, `verify` |
| 2026-09-06 | **`entriesFromMessages` moved to `@tab/ledger`.** `apps/engine` importing `apps/settlement/src/entries.ts` is a cross-app dependency `boundaries.json` refuses, and rightly — two apps needing the same logic means it belongs in a package. The FETCH stays duplicated in both apps because ledger may not import `@tab/mirror`; five lines of `readTopic` twice is a far smaller cost than a pure accounting package that can make network requests | `engine`, `settlement`, `ledger`, `verify` |
| 2026-09-06 | **`@tab/mirror` and `@tab/graph` BOTH export a type called `TransferEdge` and they are not the same shape** — mirror has `consensusTimestamp`, graph wants `at`. A spread compiles fine and hands the graph an edge with an undefined timestamp, which nothing downstream notices because the time-based graph rules fail open. Map field by field | `engine`, `verify`, anyone joining the two |
| 2026-09-06 | **The engine holds ceiling state in process and Mirror-derived ancestry FAILS OPEN.** An account whose funding ancestry cannot be fetched is treated as independent, which is the unsafe direction; and ceiling state does not survive a restart. Both are consequences of `@tab/db` not existing yet, both are named in `main.ts`, and both are fixed by a persisted graph rather than by more retries | `engine`, `db`, `graph` |
| 2026-09-06 | **`MODEL_ID` (`tab-v1`) is the published model identifier**, not `MODEL_VERSION`. The protocol types the field as a string of 3-32 chars, so a bare `1` or `v1` fails validation — at publish time, after the ceiling was already computed | `params`, `engine`, `verify` |
| 2026-09-06 | **A WINDOW SETTLES AT MOST ONCE — `checkWindowSettledOnce` is now a ledger invariant, and the worker refuses to run when it fires.** The worker replayed only the receipts topic, so it never saw the settlement receipts that live on the SETTLEMENTS topic: every closed window looked unsettled forever and each pass re-paid it. Not a slow leak — one extra pass double-pays, ten passes pay eleven times. It really happened on testnet (window 5962288, two schedule ids, 0.1100 paid twice). **Anything replaying tab history must merge BOTH topics** | `settlement`, `gateway`, `verify`, `web`, `engine` |
| 2026-09-06 | **A duplicate settlement needs NO money repair.** A clean settlement subtracts its net, so a window settled twice subtracts twice and the ledger already records the tab as owing the surplus back — it nets out against future windows. Writing a correcting repair would double-correct. The violation is a bug signature, not a mis-statement; `--acknowledge-duplicates` continues once the cause is fixed | `settlement`, `verify` |
| 2026-09-06 | **The earn route declares `extra: { paymentFlow: 'upfront' }`.** x402's default `authorization` flow VERIFIES before the handler and SETTLES in the response hook afterwards — so `earn.ts`'s stated premise ("the money has ALREADY moved by the time we are called") was FALSE, and it wrote attested credits for payments that had not settled. `upfront` settles first, which is what the code always assumed. Note the key is `paymentFlow`; `assetTransferMethod` is a different axis and setting `upfront` there fails at boot | `x402`, `gateway` |
| 2026-09-06 | **`unsettled:` is FIXED — both legs now record real transaction ids.** Spend: `processResponse` returns `{ status, paymentStatus, body, header }` and the id is on `header.transaction`; the client read `processed.settlement?.transaction`, a property that never existed, so `tx` was always undefined. An inline cast asserted the shape rather than checking it, which is why the compiler never objected. Earn: the route now reads `request.x402Context.beforeHandlerSettlement.result`. Only a `success` settle is trusted — a failed one still carries an id. **The reconciler now reports `matched 1 · violations 0 · questions 0`** | `x402`, `gateway`, `settlement` |
| 2026-09-06 | **THE TAB IS ITS OWN ACCOUNT.** `TAB_ACCOUNT_ID` is now required by the gateway and the settlement worker, and it MUST differ from the hot float. It used to default to the operator id, which made the tab and the float one account: settlement scheduled a transfer from `0.0.8812188` to `0.0.8812188`, consensus executed it, and the worker printed CLEAN with a schedule id having moved nothing between two parties. `tick` now throws rather than build a self-transfer. Four accounts are distinct and each has a reason — float fronts and pays out · tab receives · payer is the agent's CUSTOMER · fee payer co-signs. `pnpm tab:create` makes one | `gateway`, `settlement`, `testkit`, `bootstrap`, any demo |
| 2026-09-06 | **`@tab/params` exists, and window bucketing lives there.** `windowOf(epochSeconds, windowSeconds)` is the single source; the gateway's inline `Math.floor(now / windowSeconds)` is gone. Two copies agree until one is handed milliseconds, and then the gateway files receipts into a window the worker never settles. `windowOf` throws on a millisecond timestamp for that reason | `gateway`, `settlement`, `fastpath`, `web` |
| 2026-09-06 | **`TIER_APR_BP` moved from `@tab/ledger` to `@tab/params`** (`aprBpFor(tier)`). Ledger cannot import params by design — it takes `aprBp` as an argument, so it does the arithmetic and never decides the policy. A rate change is now a params version bump touching no math. `RAMP_*` steps stay in ledger because `planSettlement` uses them internally | `ledger`, `settlement`, `scoring`, `verify` |
| 2026-09-06 | **v1 parameters are FROZEN and hash-pinned.** `packages/params/src/params.test.ts` fails if any v1 number changes — that is the test working, not a test to update. A ceiling published under v1 must stay recomputable by `verify-ceiling` forever. Add `v2.ts` and bump `MODEL_VERSION` instead | everyone; `verify` especially |
| 2026-09-06 | **`SettlementEntry` carries `rampFromBp` / `rampToBp`**, and `rampAfter(entries)` derives the ramp in force from the last settlement. The ramp lives nowhere but the receipt topic, so a replay that dropped it silently reset every agent's earned credit to the starting ramp on each worker deploy | `ledger`, `settlement`, `web`, `scoring` |
| 2026-09-06 | **A dry run must move nothing.** `tick` takes `{ execute }`; `--dry-run` passes `false`. The first version suppressed only the receipt write, so a "dry run" scheduled and executed a real transfer AND omitted the receipt that marks the window settled — leaving the next real pass ready to pay it a second time. A dry run that moves money is worse than none, because the flag is what convinced you it was safe | `settlement`, anyone adding a `--dry-run` |
| 2026-09-06 | **The reconciler reads the SETTLEMENTS topic too.** A netted payout is an outflow from the float that is receipted on a different topic; without this every clean settlement was listed as an unreceipted outflow, so the healthier the rail, the more open questions its own audit tool raised. Matched by transaction id, never by amount — two windows can net to the same figure | `settlement`, `verify` |
| 2026-09-06 | **A placeholder env value is UNSET.** `process.env.X ?? fallback` accepts `0.0.xxxxx` because it is a non-empty string; the worker announced `float 0.0.xxxxx`. Check `includes('xxxxx')` the way `requireEnv` does | everyone reading .env directly |
| 2026-09-06 | **`repairReceipt.why` gained `missing_transfer`**, and **`@tab/ledger` now routes a repair by the SIGN of its amount**, not by kind. A `missing_transfer` repair REVERSES a debit, so its amount is positive; the old code filed every repair under `debits`, which is documented negative. The net came out right, so a window would have misreported silently | `protocol`, `ledger`, `settlement`, `web` (window display) |
| 2026-09-06 | **The reconciler is idempotent, and must stay that way.** It skips a debit that already has a `missing_transfer` repair on the topic. Without that check `--repair` rewrites a reversal on every run — a −0.04 error becomes +0.36 after ten runs. **If you add a repair kind, add its already-repaired check in the same commit** | `settlement` |
| 2026-09-06 | **An unreceipted float outflow is a QUESTION, not a violation.** The float legitimately makes operational transfers (funding a payer, topping up an account) that correctly have no debit receipt. Only the reverse — a debit receipt with no on-chain transfer — is a hard invariant. Reporting the first as a violation made the reconciler's first run cry wolf 16 times on a healthy ledger | `settlement`, `verify`, `web` |
| 2026-09-06 | **A Hedera transaction id is spelled two ways**: `0.0.x@s.n` in our receipts, `0.0.x-s-n` by Mirror Node. Use `normalizeTransactionId` / `sameTransaction` from `@tab/mirror` on BOTH sides of any comparison | `mirror`, `settlement`, `verify`, `engine` |
| 2026-09-06 | **`reconcile` is window-bounded** (`--since=<seconds.nanos>`, else `RECONCILE_LOOKBACK_SECONDS`, default 3600). Walking the float's full history hung at 5–15s/page and gets slower forever; the spec's unit is the window | `settlement` |
| 2026-09-06 | **OPEN DEFECT — the spend path writes `unsettled:<holdId>` as the debit's transaction id** whenever the x402 facilitator returns no settlement transaction. Those debits can never be reconciled: there is no id to match. The reconciler counts them as `unreconcilable` rather than skipping them, but **the fix belongs in `apps/gateway`** — write the real id once the transfer lands, or emit a follow-up receipt carrying it. Until then the reconciler has never made a single positive match, so the demo's proof-of-reconciliation is not yet demonstrated | `gateway`, `x402`, `settlement`, demo |
| 2026-09-09 | **A private copy of a shared function or type has now hidden or re-created a defect FIVE times.** Three replay decoders each lost a message type; `whoami.ts`'s inline `{decimals: number}` re-created the string-decimals bug; `spend.ts` carried its own `toWire` while `server.ts` in the same app imported the shared one. The last was byte-equivalent — the point is that it was the SETUP for drift. If a package exports it, import it | everyone |
| 2026-09-09 | **Anything that influences a published ceiling belongs in `@tab/params`, and "influences" includes the WEIGHT steps.** They lived in `apps/engine` and the engine's own comment named it as a gap for days. The consequence was not stylistic: a weight message said `bp 3360 · why [...]` and no stranger could check that 3360 followed from those reasons. v3 moved them; `verify-ceiling` now reproduces weights | `params`, `graph`, `engine`, `verify` |
| 2026-09-09 | **A version bump must never back-fill a new field into a frozen set.** v1 and v2 genuinely had no weight policy, so `weights` is OPTIONAL and pre-v3 weights report NOT VERIFIABLE. Filling it in would claim a historical weight is reproducible from the frozen record when it is not — the same class of mistake as taking a newer funder in `factsFromMessages`. Absence of proof is not evidence of a problem, and the two must not print the same | `params`, `verify` |
| 2026-09-09 | **A verifier must re-implement, not import.** `tools/verify/src/reweigh.ts` duplicates `@tab/graph`'s discount ORDER on purpose: calling the function that produced a number proves only that it is deterministic. If the copy drifts, the check fails — which is the signal wanted. `boundaries.json` bars `verify` from `graph` for this reason | `verify`, anyone "de-duplicating" it |
| 2026-09-09 | **Mirror Node's `decimals` is a STRING from `/tokens/{id}` and a number from `/accounts/{id}/tokens`.** A strict `!== 6` against `"6"` throws `Token 0.0.429274 has 6 decimals, not 6` — a sentence that has now cost an hour twice. Coerce with `decimalsOf` before ANY comparison; it returns NaN rather than a default, so an unreadable token is refused instead of assumed to be USDC | anyone reading a token balance |
| 2026-09-09 | **A private copy of a shared shape has now hidden a defect FOUR times.** Three replay copies each lost a message type (holds on gateway restart, settlements in the worker, `weightUpdate` in the console), and `whoami.ts`'s inline `{ decimals: number }` dodged the fix above while keeping the bug. If a type exists in a package, import it — a local copy that typechecks is not a local copy that is right | everyone |
| 2026-09-09 | **`pnpm whoami` does not work and never did** — pnpm has a builtin of that name and shadows any script, failing with `401 Unauthorized` from the npm registry, which reads as an auth problem. Use `pnpm chain:status` | anyone following a doc comment |
| 2026-09-09 | **Graph facts are on the CEILING TOPIC, and the reader is MONOTONIC.** Once a funder is published for an account, a later message that omits it must not erase it — a reader keeping "newest per account" would let one Mirror Node outage wipe a correctly observed funding edge and un-catch the loop attacker through the mechanism meant to catch it. Absence means NOT OBSERVED, never "has no funder"; a *different* funder is rejected and reported, because an account has one creating payer forever | `ledger`, `engine`, anyone reading the ceiling topic |
| 2026-09-09 | **The published settlement `debits` and `interest` are NEGATIVE**, and `net = credits + debits + interest`. `@tab/protocol`'s comment said `credits − debits − interest`, which describes positive magnitudes and is not what any producer writes. A console built on that comment negated `debits` and showed a netting panel summing to 0.190000 above a published net of 0.110000 | anyone rendering or auditing a settlement |
| 2026-09-09 | **NO BUDGET — everything must be free, and everything is.** Hedera *testnet* only: HBAR from the portal faucet, USDC from the Circle testnet faucet (the 20.000000 in the float came free). Mirror Node is the public endpoint, no key. Supabase free tier for `@tab/db`, local Redis or Upstash free for `@tab/cache`, Vercel hobby for the console. Declining The Graph also avoided the one paid indexer. **The only thing that would cost money is mainnet, which we do not touch** | everyone; check before adding any dependency or service |
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

### 2026-09-09 (very late) — Claude — settlement tested; the test-debt table is effectively closed

**What I did.** 26 tests for `apps/settlement`, the last large untested surface and the site of the
three worst incidents this project has had.

**An extraction had to come first.** `reconcile.ts` reads `process.env` and throws at module level,
so importing the pure matching function ran the whole CLI. The matching moved to `matching.ts`
unchanged — the third time this shape has come up, after `recheck.ts` and `ancestry.ts`. The rule
is now clear enough to state: **if a file both computes and prints, the computing half will need to
be extracted the moment anyone tries to test it.** Worth doing at write time rather than later.

**The three incidents, now locked down:**

- **The dry run that moved money.** The first `--dry-run` suppressed only the receipt write, so it
  scheduled and executed a real transfer and then omitted the receipt marking the window settled —
  leaving the next real pass ready to pay it again. The test's fake Hedera and Mirror clients
  **throw on any property access**, so if `execute: false` ever stops short-circuiting the test
  fails loudly rather than quietly scheduling a transfer. That is deliberate: the original was bad
  precisely because the flag is what convinced you it was safe.
- **The self-transfer that reported CLEAN.** Two tests — that it is refused, and that the refusal
  happens BEFORE anything is scheduled, asserted by checking the error is the config error and not
  "the chain must not be touched".
- **The window paid twice.** The merge fix lives in `main.ts`; the test asserts the question itself
  is right once a settlement entry is present, plus that a window with only a hold or only a
  refusal is not settleable, because nothing moved.

**Idempotence is tested across BOTH transaction id spellings**, which matters: idempotence that
worked for only one spelling would silently repair twice, and that is the money bug of the worst
kind — `--repair` turning a −0.04 error into +0.36 after ten runs.

**Verified live after the refactor.** `pnpm reconcile` runs and reports correctly. Over a wide
window: `checked 4 outbound · matched 1 · violations 6 · questions 1` plus 1 unreconcilable — all
pre-existing live-data state, not introduced. Over the default 3600s window it prints "NOTHING TO
RECONCILE ... This is NOT a clean bill of health", which is the window-bounded behaviour refusing to
call an empty range a pass.

**On the two packages left untested, and why I am stopping here rather than continuing.** `hedera`
(629 lines) and `x402` (404) are thin wrappers over `@hiero-ledger/sdk` and `@x402/*`. A unit test
for either would assert that we call the SDK the way we already know we call it — and every bug
those two have had was a LIVE behaviour a mock would have reproduced wrongly: `paymentFlow` vs
`assetTransferMethod`, V1 vs v2 field names, a 10s connect timeout surfacing as a signature error.
`tools/probes` covers them against a real chain, which is the only place that class of bug shows
up. Writing mocks here would raise the test count and lower the signal.

**Next.** Nothing on the ranked list is both correctness-critical and unbuilt. What remains is
scaling (`@tab/cache` for multi-instance, checkpoints for replay cost), the registration flow — the
biggest remaining FUNCTIONAL gap and the thing a sharp reviewer finds first — and the two items only
the user can do: the demo video and user-testing evidence.

### 2026-09-09 (late night) — Claude — @tab/mcp, and the gateway finally has tests

**What I did.** Two things off the ranked list: the MCP server, and 36 tests for the component that
moves money.

## @tab/mcp — the product-evidence gap, narrowed

Until now "agents use Tab" was demonstrated by OUR demo scripts. A judge could watch it and not
drive it. Three lines in `claude_desktop_config.json` and any MCP-capable runtime is transacting on
a tab, holding no key and signing nothing.

**The README's open question, settled: standalone server, not an Agent Kit plugin path.** Option 2
is the better ecosystem story and it is not the one to ship first — it depends on two things that do
not exist (the plugin is unwritten) plus an external server accepting third-party plugins in a shape
nobody here has verified, and it cannot be driven by a judge in one step. It is additive later; a
plugin can wrap the same `@tab/sdk` verbs whenever that path is confirmed.

**The invariant: a refusal is a structured RESULT, not an error.** `isError: true` makes a client
surface a failure and invites a model to retry — and a `CEILING_EXCEEDED` retried immediately is
refused again for the same reason. So a refusal returns the rule, the evidence, and the guidance
from `@tab/protocol` (not strings invented in the server), plus the line that stops a retry loop.
A `failed` outcome IS an error and hands back the hold id, because nobody knows whether the seller
was paid and a retry with a new key would be a second payment.

Only `tab_spend` moves money, and it is annotated `destructiveHint: true · idempotentHint: false`
so a client knows which tool to confirm with a human. Every read tool asserts `readOnlyHint: true`
in a test — marking a money-moving tool read-only would let a model spend without the decision ever
surfacing.

**12 tests, driven through a REAL MCP client** over an in-memory transport pair. Asserting against
our own idea of the protocol would prove only that we are self-consistent.

**Verified over actual JSON-RPC on stdio** against the live gateway and topics — `tab_ceiling`
returned `0.2500 bound by starter_floor · model tab-v3 · HCS seq 35`, and `tab_counterparties`
returned the three-way table WITH its evidence:
`funded by 0.0.8812188 · tab funded by 0.0.8812188 ← SAME, which is what COMMON_FUNDER tests`.

That is the demo beat: ask a model *"why is my ceiling only 0.25?"* and it answers with the
funding-graph evidence and the two account ids that decided it.

## The gateway: 36 tests, and a fifth private copy

1,646 lines, no tests, and it moves the money. Reading it to write them turned up `spend.ts`
carrying its own `toWire` while `server.ts` — the same app — imported `@tab/money`'s. Byte-
equivalent, so nothing was wrong yet. That is the point: it was the SETUP for drift, and it is the
fifth private copy of something shared to appear here. Now a lessons row.

Each test names the failure its rule came from. The ones worth knowing:

- **The debit is the CHARGE, not the cap** — and the first *fix* for that bug read
  `maxAmountRequired`, the x402 V1 field name, so it silently fell back to the cap and reproduced
  the bug behind a patch that looked like it worked.
- **A failed hold write fails CLOSED**, asserted by counting calls on the fake client rather than
  by reading the code.
- **A seller that throws leaves the hold standing and writes no debit** — the money may or may not
  have moved, and the ledger must not claim it did.
- **Every JSON amount is six decimals**, checked with a regex across every amount field.
- **Placeholder env values count as missing** — `.env.example` ships `0.0.xxxxx`, and treating one
  as real is worse than an empty string.

Also fixed a `guard:money` false positive honestly rather than with an annotation: a test asserted
`doesNotMatch(line, /1000000/)`, and the literal is now derived from `usdc('1.000000')`. The guard
is right to flag a bare raw micro-unit string in a money path.

## Where the product stands, since I was asked

Strong on verifiability, weak on user evidence. A stranger can reproduce a ceiling AND a weight from
public data with no access to us; `0.7 × 0.6 × 0.8 = 0.336` matching seq 34 is a real artifact. What
a sharp reviewer will push on, correctly: no registration flow (the Sybil story has a known hole,
labelled OPEN everywhere), single-instance gateway, no users, no demo video.

**Hosting, decided:** only the gateway needs Render (free web service, ONE instance — holds live in
process memory). The console belongs on Vercel hobby, not Render, because it is a Next app. `engine`
and `settlement` are not servers; run them locally for the demo, since Render cron is a paid
feature. Two gotchas: a free Render service spins down after ~15 min and the gateway's cold start
replays the whole receipt topic, so warm it before demoing; and `NEXT_PUBLIC_*` is inlined at BUILD
time, so the gateway URL must be set before the console is built.

**Next.** `settlement` (961 lines) is the largest untested surface and it moves money.

### 2026-09-09 (night) — Claude — v3: the weight steps join the frozen record, and a weight becomes checkable

**What I did.** Closed the residual half of gap #1, and in doing so closed a transparency gap that
had been sitting in a code comment for days.

## The two turned out to be the same problem

The residual fail-open was an account never successfully observed: nothing to remember, so absent
ancestry read as absent relationship and the counterparty was weighted INDEPENDENT. Fixing it means
adding a discount, and a discount is a parameter — which is when I noticed that the five discount
steps *already in use* were not parameters at all. They lived in `apps/engine/src/recompute.ts`,
and the comment sitting there had been naming it as a gap since it was written: *"they influence a
published ceiling, so by the rule this project set itself they belong in the versioned parameter
set where verify-ceiling can find them."*

So v3 does both, because they are one version bump.

**The consequence of the old arrangement was not stylistic.** A weight message says
`bp 3360 · why [SHARED_FUNDING_ROOT, YOUNG_ACCOUNT, CONCENTRATED]`, and no stranger could check
that 3360 follows from those reasons, because the steps were nowhere readable. `verify-ceiling`
proved the last step of the calculation and none of the steps that decided it.

## `UNVERIFIED_FUNDING`, and why 50%

- **Not 0.** Blocking would turn routine Mirror Node lag into a simultaneous refusal for every
  counterparty — an outage caused by an index. The original fail-open existed partly for that
  reason and the reason was sound; only its magnitude was wrong.
- **Not gentler than the unattested discount (60%).** "I cannot tell you who this counterparty is"
  is a weaker position than "money arrived without a receipt", so it must not count for more.
  Pinned by a test so a future version cannot quietly loosen it.
- **Self-healing**, which is what makes a discount this size safe to impose: the moment provenance
  IS observed it is published, and a published fact is never forgotten, so it cannot apply to the
  same account twice. An agent is not permanently penalised for our indexer's bad day. The starter
  floor also still binds for a new or small agent, so it cannot stop one from opening.

Applied FIRST in `@tab/graph`'s ORDER, and the position is frozen too — multiplication commutes,
integer truncation does not.

## The decision I nearly got wrong

The schema's stated rule is that every field is required, because *a default is a parameter nobody
chose*. Adding `weights` as required would have meant back-filling it into v1 and v2 — and their
frozen hashes are pinned in `params.test.ts` with the comment *"that is not a test to update"*.

I checked whether those hashes are on a topic. They are not; they exist only in the test file. So
back-filling would have broken nothing externally verifiable, and I could have routed around my own
rule with no consequence.

The reason not to is better than the tripwire: **v1 and v2 genuinely had no frozen weight policy.**
Recording one would claim a weight published under `tab-v1` is reproducible from the frozen record
when it is not. That is rewriting history rather than recording it — the same class of mistake as
taking a newer funder in `factsFromMessages`. So `weights` is the schema's one optional field, with
the exception's reason written next to it, and pre-v3 weights report NOT VERIFIABLE.

`weightPolicyFor` returns `undefined` for pre-v3 while an unknown *version* still throws: a lookup
bug and a fact about history must not present identically.

## Weights are now verifiable

`weightUpdate` gained `model`, and `verify-ceiling` gained a weights section. Live:

    PASS  seq 34 · 0.0.10393567 · window 5963123
          published        3360bp · discount
          reasons          SHARED_FUNDING_ROOT × YOUNG_ACCOUNT × CONCENTRATED
          recomputed       3360bp  (frozen parameter set v3)

    9 of 9 verifiable weight(s) reproduce · 4 not verifiable (no frozen policy before v3)

`reweigh` re-implements the arithmetic rather than importing `@tab/graph`. Calling the function that
produced the number would prove only that it is deterministic; a verifier has to reach the answer
independently, as a stranger with a spreadsheet would. The ORDER array is a deliberate second copy —
if it drifts, the check fails, which is the signal wanted.

`not_verifiable` is NOT counted as a failure, unlike an unverifiable ceiling, and the distinction is
load-bearing: an unverifiable ceiling means a published claim cannot be checked, while a pre-v3
weight is unverifiable because of a limitation we document. Marking it FAIL would make the tool cry
wolf.

The blocking consistency check runs BEFORE the version lookup, because zero is zero in every
version — so an old message with no model can still fail it. Checked both ways: a blocking reason
with a non-zero weight is a hard block that did not block, and a zero weight with no blocking
reason is a refusal nobody can explain.

## Tests: 266 → 299

The ones worth having are the negative ones. Inflating `bp` while keeping the reasons fails;
keeping `bp` while DROPPING a reason fails (the same fraud, other direction); shuffling the reason
array still passes, because the checker applies its own frozen ORDER rather than the message's, so
a publisher cannot shift a number by a micro-unit through presentation.

**Live check that mattered most:** `pnpm verify-ceiling` passes ceilings under `tab-v1`, `tab-v2`
AND `tab-v3`, each against its own frozen set. A version bump that broke historical verification
would have defeated the entire point of having versions.

**Next.** `gateway` (1,132 lines) is the largest untested surface. Everything else on the ranked
list is presentation or scaling, none of it demo-blocking.

### 2026-09-09 (later) — Claude — the graph fail-open closed on HCS, and 49 tests for `mirror`

**What I did.** Gap #1 and the top of the test-debt table, in that order. Both had been sitting on
this page for days as the two things that mattered most and were not presentation.

## The fail-open, closed — on a topic rather than in a database

The independence graph re-derived funding ancestry every pass from Mirror Node's
transactions-by-account index, which is *intermittent* for new accounts. A failed lookup meant no
`fundedBy`, so `COMMON_FUNDER` could not fire, so one operator on both sides of a trade looked
like independent demand. **The loop attacker went uncaught on its first full run because of exactly
this**, and the code named `@tab/db` as the fix in three separate comments.

I did not build `@tab/db`. Observed facts now go on the **ceiling topic** as `graphFact` messages.
Reasons, in the order they actually decided it:

1. A private database puts the graph's inputs somewhere a stranger cannot see. Every other input to
   a ceiling is on a topic — which is precisely why `verify-ceiling` could check a ceiling's
   arithmetic but never its graph. Fixing a transparency gap by adding a private store would have
   been the wrong direction.
2. It needs no database, and there is no budget.
3. The engine is not on the latency path, so an HCS write costs nothing that matters.
4. It is a derived index of already-public data. Every field is readable by anyone from Mirror
   Node; publishing reveals nothing private, it only saves the next reader from an index that may
   not answer.

**The merge is the actual fix, not the publishing.** `factsFromMessages` merges rather than
replaces. A reader that kept the newest message per account would reintroduce the bug through the
mechanism meant to close it: an outage publishes a fact with no funder, that message is newest, and
an edge correctly observed a week ago is erased. So a funder is sticky, absence means "not
observed", and a message claiming a *different* funder is rejected and reported — an account has
one creating payer forever, and taking the newer would let a later writer rewrite its origin.

The same rule applies on a *successful* fetch that finds no funder — a 200 from the accounts
endpoint with nothing from the transactions index. Taking that at face value is the same bug wearing
a different hat, and it is the case I would have got wrong without writing the test.

**Extracted to `ancestry.ts` so it could be tested.** The walk was inline in `main.ts`, and the
branch that matters most — Mirror down, topic answering — is the one a live run is *least* likely
to exercise, because Mirror usually works. A security rule that fails open should not be trusted on
a coincidence. The tests drive a Mirror Node that is down for specific accounts: without a memory
the shill resolves to no funder, with one it resolves to the operator, keeps walking past the
remembered edge to the shared root, and cites the seq that established it.

**Also fell out of it:** `funderOf` and `isYoung` each made their own `getAccount` call — three
requests per counterparty to answer two questions from the same document, and the two answers could
disagree when one call succeeded and the other failed. `observeAccount` answers both from one pair,
`isYoungFrom` is pure so a *remembered* birth time answers the age question too, and both old
functions are deleted rather than left exported.

**Live:** 7 facts published, seq 13-19. `0.0.2` — a genesis account — correctly got a birth time
with no funder invented. A second pass printed `facts none new`, so the gating works.

**The residual, stated precisely:** an account never successfully observed, during an outage, is
still weighted independent. There is nothing to remember. Closing that needs a policy change
(discount the unverifiable rather than trust it), which moves ceilings, which needs v3.

## The Evidence panel is real

Publishing the facts also fixed the thing the code had flagged as "the obvious next protocol
addition". The Counterparties Evidence panel returned `null` for every live row and the table showed
`firstSeen —` and `age 0d`, so the strongest claim in the demo displayed with none of its supporting
values. A viewer could read the verdict and had no way to check it.

It now shows the two values the rule actually compared, verbatim, with the seq that established
them. Live: two counterparties show `funder == tabFunder == 0.0.8812188` beside their
`COMMON_FUNDER` blocks, and a third shows a *different* funder — which is why it gets
`SHARED_FUNDING_ROOT` at bp 3360 = 0.7 × 0.6 × 0.8 rather than a block.

No hop chain on live rows, deliberately: it is reconstructible from the published facts, but walking
it in the console would make it re-derive part of the graph, and one wrong path beside a correct
reason is worse than no path.

## 49 tests for `mirror`, and they found a bug

1,060 lines, zero tests, and the highest-risk surface in the repo — every bug found across these
sessions came through it. Its doc comments are a catalogue of rules learned the expensive way and
not one was enforced by anything but a comment.

47 of 49 passed first run, which is what I expected from comments written from live failures rather
than from documentation. The two that did not:

- **`getUsdcBalance` rejected a perfectly good 6-decimal token.** Mirror returns `decimals` as a
  string from one endpoint and a number from another; a strict `!== 6` against `"6"` throws
  `Token 0.0.429274 has 6 decimals, not 6`. That sentence cost an hour in an earlier session where
  it was blamed on a script — it is reproducible straight from this function.
- **`whoami.ts` dodged the type fix by declaring its own inline copy of the shape.** Fourth time a
  private copy of a shared shape has hidden a defect.

Both are now lessons rows. So is `pnpm whoami`, which pnpm shadows and which therefore never worked
despite being the documented command in that file for its whole life.

**Next.** v3 to close the residual fail-open is the top correctness item. `gateway` (1,132 lines) is
now the largest untested surface. Everything else on the ranked list is unchanged.

### 2026-09-09 — Claude — the console reads real data, and a fake VERIFIED stamp is gone

**What I did.** Wired the last three mocked console views — `config`, `settlements`, `ceiling` —
which took a protocol read, two gateway endpoints, two SDK verbs and one deletion I should have
made much earlier. Then ran the gateway against the real topics, which found three more bugs that
typechecking could not.

Seven of eight views now read live data. `agents` is the last, and it needs multi-tab support
rather than an endpoint.

**The deletion, first, because it is the one that mattered.** The ceiling view had a
"Recompute and verify" button. It flipped a boolean and stamped VERIFIED in green. It recomputed
nothing, compared nothing, and had no access to anything that could — `apps/web` cannot import
`@tab/scoring`, by design. On the one screen whose entire purpose is the claim *you do not have to
trust us*, that was the worst thing in this console, and it would have been filmed.

It is gone. In its place: the sequence number, the model id, the canonical input hash, a HashScan
link to the topic, `pnpm verify-ceiling` with a copy button, and a sentence saying plainly that
this panel is **not** the verifier. A checker that runs inside the thing being checked proves
nothing.

**Three things the console was asserting that were false.**

1. `MODEL_VERSION = 'ceiling-v0.4.1'`, in five places including the docs header. Every published
   ceiling carries `tab-v2`, and `verify-ceiling` resolves each message's own `model` field to
   pick the frozen set to recompute against — so the console was sending a verifier looking for a
   parameter set that does not exist. `config` now derives every row from `@tab/params`. Four
   other values were also wrong: `AGE_FULL_DAYS` said 3 (it is 7), `STARTER_CEILING` said 1.0000
   (it is 0.250000), and the ramp clamp and hold TTL were absent entirely.
2. The reconciliation banner printed `checked 43 · matched 43 · repaired 0`, three numbers from a
   mock. It now derives from the rows and surfaces the **real** finding: window 5962288 appears
   twice, seq 1 and seq 2, two transaction ids. HCS is append-only — the scar is permanent, and
   printing CLEAN over it was the more dishonest of the two options.
3. `SETTLE_MODE` and `MAX_SNAPSHOT_AGE_S` were in the config table. Those are gateway
   environment, not model parameters, and the console cannot read the gateway's environment.
   Dropped rather than invented — showing made-up values would leave the table exactly as
   trustworthy as the mock it replaced.

**What the topics now carry to a reader.** `PublishedCeiling` gained `inputs` and `seq`, so a
ceiling arrives with the arithmetic that produced it: a `0.0000` with no numbers beside it reads as
a bug, while the same zero next to `tier Unrated · ×0 · cause graph_change` reads as the rail
working. `ceilingHistoryFromMessages` returns the whole series ascending, because a collapse is
only visible next to what it collapsed from — and `replayCeilings` now derives "the ceiling in
force" as the last element of that series rather than reading it separately, so the number and the
chart cannot disagree.

`SettlementEntry` gained the gross legs. The settlements view exists to make one claim — many
receipts became one transfer — and `net` alone shows the transfer while hiding the netting. They
are optional on the entry, and both paths render `—`, never `0.0000`: a window whose credits were
genuinely zero and one that never recorded its credits are different facts.

The gateway finally opens `TOPIC_SETTLEMENTS`, which had been in its environment since the first
commit and never read. Read-only, on its own 120s timer, and never consulted by `spend` — the
gateway makes no claim about whether a window settled, so it must not appear to.

**Then I ran it, and found three more.**

1. **Mine, an hour old.** I assumed the topic stored `debits` as a positive magnitude and negated
   it. It does not: `@tab/ledger`'s `WindowNet` documents both `debits` and `interest` as negative
   and defines `net = credits + debits + interest`. The negation turned a debit into a credit on
   screen and made the panel sum to 0.190000 above a published net of 0.110000. I was misled by
   `@tab/protocol`'s own comment, which read `credits − debits − interest` — now corrected, with
   the sign stated on the field. Verified against all five settled windows: every one sums exactly.
   The panel now **checks** the sum rather than assuming it, and says so when it fails.
2. **The ceiling chart drew a flat line.** I seeded the scale with `inputs.cap`, thinking that was
   safer. On live data the cap is 100.000000 while no ceiling this tab ever held exceeded 1.000000,
   so the entire eleven-point series — including the one collapse worth showing — rendered a pixel
   off the bottom axis. Scales from the largest ceiling actually published now.
3. **The gateway's boot log rendered as garbage** —
   `ceilings          settlements       settlements boot  5 window(s)` — because the ceiling sync
   only logs a tab whose ceiling *changed*, so a restart resuming the ceiling it already had
   printed nothing after its progress prefix.

**Live evidence.** Both endpoints work against the real topics. `/ceiling` returns 11 publications
spanning `tab-v1` and `tab-v2` on one tab, which is exactly why parameter sets are frozen and never
edited; seq 8 is the one time earned credit actually bound (`computed 0.352800`). A tab with no
published ceiling returns `published: false` with the enforced starter ceiling and a note, not a
404 — that is the normal state for a tab's first minutes, and a 404 would render an error for a
healthy tab while hiding that a real limit is in force.

**Also.** One poller (`usePolled`) replaced the third copy of the same cancelled-flag / interval /
keep-last-good effect. The duplication was harmless; each copy independently having to get the
failure behaviour right was not — blanking a table on a transient timeout reads as "no
settlements", a very different claim from "the last poll failed".

**Tests: 181 → 197.** ledger 39 → 47, sdk 16 → 24. The new ones assert what a reader may not
invent: absent gross legs stay absent, an unknown tier degrades to `Unrated` and an unknown outcome
to `carried` (both the conservative side, never the permissive one), and history sorts by window so
a late settlement cannot reorder the table.

**Budget, confirmed explicitly.** Nothing in this design costs money, and that is structural rather
than lucky — see the new lessons row. Testnet only, public Mirror Node, free tiers everywhere,
and the one paid thing we were tempted by (The Graph) was declined last session.

**Then I did `agents` too, and it was the worst of the eight.** Not because it was hard — a
`GET /v1/tabs` route over `state.tabs()`, an SDK verb, one hook — but because the view was headed
**"Registry"**, with a `registered` column reading `4d ago` / `4s ago`, a green
`STARTER TAB ISSUED` stamp, and the sentence *"the funding-root check means minting a hundred
agents from one wallet yields one Starter Tab, not a hundred"*. Nothing writes a `register`
message; that check is gap #2 on this very page. The screen was describing the one rule the system
does not have.

It now lists the tabs the gateway saw on the receipt topic and states the unenforced rule in a
caution card at the top. `registrationEnforced: false` rides on the endpoint response rather than
being left to a caller's assumption, and the SDK reads a *missing* field as false — an older
gateway that omits it has no registration flow either, and defaulting the permissive way round
would let a stale server silently license the heading.

Two of the three live tabs have never had a ceiling published, so their tier comes back absent and
renders as **`not published`** with a footnote: a tab the engine has never run for has no tier,
while `Unrated` is the tier that carries a ×0 multiple and therefore no credit at all.

**And three more hardcodes on the tab view, which was already LIVE** — which is the lesson worth
carrying: a view marked LIVE is not a view whose every figure is live. `window spend` read the
string `0.62 / 1.00` beside a live balance; `tier` read the character `C`; the stale banner read
`snapshot age 41s · max 15s`, two numbers nothing measured. The STARTER TAB ISSUED panel rendered
*always*, including beside a tab with 37 receipts.

Eleven invented figures across screens already shipped as live. Worth re-reading any view before
trusting its badge.

**Next.** The ranked gaps are unchanged and the presentation gap is closed: `@tab/db` to close the
fail-open exposure, then tests for `mirror` (1,060 lines, still zero). The registration flow is
now the most visible open gap, since the console names it on screen — and `@tab/graph` already
resolves funding roots, so it is cheap.

### 2026-09-08 (night) — Claude — the independence table is on the public record

The engine computed counterparty weights and published them **nowhere**. The three-way weight table
— the strongest single artifact in the demo — existed only in engine stdout, which means nobody
could check it. It is on HCS now, and it renders in the console.

Verified live, end to end:

```
  seq 11  t=weight  cp=0.0.10393567  bp=3360  block=false
    why=['SHARED_FUNDING_ROOT','YOUNG_ACCOUNT','CONCENTRATED']
    rev=1.000000  share=10000bp  tok=0.0.429274
```

`3360` is reproducible by hand as `0.7 × 0.6 × 0.8`, which is the point: HCS → gateway → SDK →
console, with every reason intact at each hop.

**One message per counterparty, and the reason matters.** An array of weights inside the ceiling
message was the obvious design and it is wrong: it hits the **1024-byte single-chunk limit** as soon
as an agent has a handful of counterparties, and `encode()` refuses anything larger because a
chunked payload read partially parses as truncated JSON. Per-counterparty messages are small,
incremental and cannot overflow. The cost is N messages per window — the same trade as holds, and
the same answer at scale: a batch commitment, not a bigger message.

**Weights publish BEFORE the ceiling.** The ceiling is the conclusion, the weights are its evidence.
Published the other way round there is a window — small but real — where the console shows a
collapsed ceiling with no reason for it, which is the one thing the Counterparties view exists to
prevent.

**The console had invented its own reason vocabulary, and this is what forced it out.**
`WEIGHT_REASONS` lived in `@tab/graph`, which `apps/web` may not import — so the UI had defined
seven names of its own. Two existed in the system. There was **no `COMMON_FUNDER` at all**, the rule
that actually fires on live data, and `chipTone` classified hard blocks by matching a `HARD_BLOCK*`
prefix that no real reason has — so every genuine hard block would have rendered as a mere caution.
The vocabulary now lives in `@tab/protocol` beside `REFUSAL_CODES`, where a published interface
belongs, and the mock was updated to use the real names too: a mock that disagrees with reality
hides a bug rather than standing in for one.

**Every reason is shown, not just the first.** Three fired at once and their product IS the weight.
Showing one leaves a number a viewer cannot reproduce, which defeats the purpose of showing it.

**What is deliberately blank:** `firstSeen`, `ageDays`, `direction` and `hops` are not published,
though the engine knows all four. They render as `—`, and the Evidence panel returns null for a live
row rather than drawing an empty funding chain that would imply the graph found no ancestry.
`YOUNG_ACCOUNT` already carries the age finding that affected the number. Publishing the funding
path would make that panel real and is the obvious next addition.

**Verified:** the weight is on the topic, the gateway serves it, the SDK parses it with unknown
reasons dropped rather than cast, and the page takes the live branch. I have **not** seen the
rendered rows — the view is a client component, so `curl` sees only the loading state. The data path
is proven; the pixels are not.

181 tests, 5/5 guards.

### 2026-09-08 (evening) — Claude — the console is on live data

`tab`, `receipts` and `refusals` now render figures polled from the gateway through `@tab/sdk`.
Builds clean, 13 routes, and verified end to end: the tab id and gateway URL are inlined into the
client bundle, and the gateway answers `balance=3.750000 ceiling=0.250000` with 35 entries.

**The architecture made this far smaller than expected.** Every view reads one `useConsole()`
context fed by a single hook, so live data meant writing one replacement hook with the same shape —
not touching eight views. `useLiveTab` mirrors `useReceiptStream` exactly and the provider picks
between them, which also keeps the mock usable: a demo sometimes has to run with no gateway, and a
mock that has drifted out of shape is a mock nobody can fall back to.

**The console states where its numbers came from, always.** `LIVE`, or `MOCK DATA` styled as a
warning, plus `GATEWAY UNREACHABLE` when a poll fails. On a failed poll the last good figures STAY
on screen marked stale rather than blanking — a reader glancing at a zeroed balance and ceiling
would read a liquidated tab, not a lost connection.

**Three things had to be fixed to make it honest rather than merely working:**

1. **`NEXT_PUBLIC_*` was invisible.** Next loads `.env` relative to the app directory and inlines
   those values at BUILD time, so our root `.env` never reached the bundle — the console rendered
   mock data while appearing configured, which is precisely the failure the `LIVE` badge exists to
   prevent, happening to the badge itself. `next.config.ts` now reads the root file and lifts ONLY
   the two `NEXT_PUBLIC_` keys; forwarding `.env` wholesale would put private keys in a browser
   bundle.
2. **The UI's `Leg` had three values where the topic has six.** `HOLD`, `REPAIR` and `SETTLEMENT`
   could not be rendered at all. Showing a `HOLD` immediately before its `DEBIT` puts the
   write-ahead ordering on screen, which is otherwise a property a viewer must take on trust.
3. **`seq` and `requestHash` were required fields the mock had to invent.** They are real data —
   the HCS sequence number and the published `req` hash — so they are surfaced from
   `entriesFromMessages` through the SDK instead, and are now OPTIONAL because an entry the gateway
   created a moment ago genuinely has neither. The table renders `pending` rather than a fabricated
   number. Live: `seq` on all 35 entries, `token` on the 8 written since `tok` existed — the honest
   boundary of the token switch, visible in the data.

**Still mocked, and each blocked on a data source that does not exist yet, not on UI work:**

| View | What it needs |
|---|---|
| `counterparties` | **Per-counterparty weights are computed by the engine and published nowhere.** The strongest artifact in the demo is currently only visible in engine stdout |
| `settlements` | A gateway endpoint over the settlements topic, and an SDK verb |
| `ceiling` | A gateway endpoint exposing the ceiling snapshot it already consumes, with the published inputs and hash |
| `agents` | Multi-tab support; the gateway serves one tab at a time |
| `config` | Can read `@tab/params` directly — the smallest of these by far |

**Next:** publishing counterparty weights is the highest-value one, because it turns the
independence table from stdout into a screen.

### 2026-09-08 (later) — Claude — real USDC, and the two bugs the switch exposed

**The faucet had worked all along.** It delivered **20.000000 real testnet USDC** to the OPERATOR
(`0.0.11920 → 0.0.8812188`), not to a wallet — so `TUSD` is no longer needed and
`USDC_TOKEN_ID=0.0.429274`. Same 6 decimals, so `MicroUsdc` is untouched, and **markedly faster**:
a spend settles in **4-5s** against 25-39s on the stand-in token.

Two side findings on the way: `0.0.10845404` is a **mainnet** account, which is why a testnet
faucet could never pay it (proven — a transfer fails `INVALID_ACCOUNT_ID`, and you cannot activate
a non-existent account NUMBER by sending to it; only an alias auto-creates one). And Mirror Node
returns `decimals` as a string from `/tokens/{id}` but a number from `/accounts/{id}/tokens`, which
produced the error *"USDC has 6 decimals, not 6"* when I compared the union with `!== 6`.

**Switching tokens exposed two real bugs, and the first one blocked the switch.**

**1. Receipts recorded amounts with no currency.** Every figure on the topic meant "whatever
`USDC_TOKEN_ID` was configured when this was written". Invisible with one token — and the moment a
deployment switches, the topic holds two currencies with nothing distinguishing them. A stranger
replaying it would be **summing TUSD and USDC and reporting the total as money**, which directly
undermines the claim that the topic is independently verifiable. Every receipt now carries `tok`,
`Entry.token` surfaces it, and `verify-tab` **filters on it and reports the 38 pre-`tok` receipts it
excluded** rather than quietly including them.

**2. The gateway debited the CAP, not the settled amount.** `amount: micro(-request.max)`. So a
spend capped at `0.200000` against a seller charging `0.040000` debited the agent `0.200000` and the
float kept the difference. Confirmed on chain: two such spends left the seller holding exactly
`0.08` while the ledger said `0.40`. Invisible for as long as every demo set `max` equal to the
price, and wrong the instant they differed — which is a normal way to call a paid API.

`@tab/x402`'s `call()` now returns `amountPaid`, captured from the payment requirement the client
actually accepted via `paymentRequirementsSelector`. The selector preserves the default choice
exactly and only records it, because changing the choice would be a behaviour change smuggled in
behind a bug fix.

**And the fix was wrong the first time, in a way worth recording:** I read `maxAmountRequired`,
which is the x402 **V1** field. v2 `PaymentRequirements` uses `amount`. The wrong field found no
price and fell back to the cap — reproducing the exact bug. Verified fixed live: a spend with
`max: 0.200000` now reports `amount: "0.040000"`.

The fallback still exists for the case where x402 reports no price, but it now **warns loudly** and
says the debit is an upper bound the reconciler will flag. A silent fallback is what let this run
for days.

Also added `pnpm fund <account> [amount]` — provisioning a payer in the configured token, which a
token switch makes necessary. It reads the token from the environment rather than taking it as an
argument, so it cannot fund the wrong token while the system is configured for another.

179 tests, 5/5 guards.

### 2026-09-08 — Claude — @tab/sdk, and two bugs it forced into the open

**The SDK came before the frontend, and not by choice.** `web`'s allow list is
`['money', 'protocol', 'params', 'sdk']` — "reads through the SDK only" — and `@tab/sdk` did not
exist. Wiring the dashboard with direct `fetch` calls would have made that boundary decorative, so
the SDK is the prerequisite. 14 tests, 179 total.

`spend` · `quote` · `state` · `holds` · `receipts` · `health`, defined once because the same
surface appears in the Agent Kit plugin, MCP and the CLI. Thin and browser-safe: no Hedera SDK, no
Redis, no database driver, and **no way to pass a key** — the claim that the agent signs nothing
should rest on a check anyone can run, not on us not having used a capability we shipped.

**Writing it immediately exposed two real bugs.**

**1. The gateway served DISPLAY strings as API values.** Every amount went through `format()` — 4
decimals and a U+2212 minus. So `1.234567` left the gateway as `"1.2345"` and parsed back as
`1234500`: **67 micro-USDC lost per value, silently.** A dashboard built on that could never match
HashScan, which is the one thing a dashboard must do. Every amount field now uses `toWire()`.

And the reason it had gone unnoticed is worth recording separately: **`usdc()` is too permissive to
be a wire parser.** It accepts the U+2212 minus and pads a 4-decimal value, so the loss round-trips
without an error. A test I wrote expecting rejection failed, which is how I found it. The SDK now
validates the shape before parsing and names the cause; the tolerance in `usdc()` is right for
human input and wrong at a wire boundary.

**2. The gateway dropped published holds on every restart.** Its `rebuild` used a private
`toEntry` with no `case 'hold'`. So a pending hold vanished from the projection, `available` came
back overstated, and the agent could spend headroom that was actually reserved — a double-spend
window that opened exactly when the process bounced. It now rebuilds through
`entriesFromMessages`, the same decode the worker, the engine and `tools/verify` use. Verified: a
restart replays `hold: 2` where it previously replayed none.

**That is the THIRD message type lost to a private replay copy** — after settlements in the
settlement worker and the tab's own ancestry in the engine. The pattern is consistent enough to
state as a rule: *a private copy of a shared decode will miss a message type, and the miss will be
silent.*

Verified live against the running gateway: exact bigint parsing, `quote` correctly predicting
`CEILING_EXCEEDED` for `0.30` against a `0.25` ceiling and affordable at `0.10`, 25 receipt rows.

**Next:** wire `apps/web` through this SDK. The UI's own `WeightReason` enum does not match
`@tab/graph`'s — it has no `COMMON_FUNDER`, which is the rule that actually fires — so reconciling
that vocabulary is the first task, and the UI should render the real codes rather than a
translation.

### 2026-09-08 — Claude — the attack catalogue now matches the code

Corrected five of eleven lines in README-TAB.md's attack catalogue. Two moved from **Caught** to
**OPEN**; three had the right verdict and the wrong reason.

**Moved to OPEN — claimed but never built:**

- **Concentrating SPEND at one seller.** Sharper than I first reported: this is not "the cap exists
  but in the slow path". The cap that exists measures **revenue** concentration on the earn leg
  (`concentration()` literally throws on negative input because it takes revenue). A spend-side cap
  is a **different rule that exists nowhere**. It also needs a minimum-volume floor before it can
  work at all — a new tab's first spend is 100% concentrated by definition, so a naive version
  refuses every agent's opening call.
- **Bulk-minting agents to farm Starter Tabs.** `registration` is a message schema nothing writes,
  so one-Starter-Tab-per-funding-root is unenforced. `@tab/graph` already resolves funding roots, so
  the check is cheap once a registration flow exists.

**Right verdict, wrong reason:**

- "Spend at a seller the agent controls" said *funding ancestry within 3 hops*. That rule is
  **structurally unreachable** — a tab holds no key and can never be a funder. It is caught by
  `COMMON_FUNDER`, verified live at 0%.
- "Wash revenue from self-funded payers" said *shared funding root → discount to zero*. A shared
  root alone is a **0.7 discount**; `COMMON_FUNDER` is what zeroes. The two were conflated.
- "Fake revenue via plain transfers" said *discounted 0.6*. The reality is **stronger**: revenue is
  read from credit RECEIPTS, so a plain transfer with no served request contributes nothing at all.
  The 0.6 applies to an inflow the gateway saw but could not attest. Corrected in our own favour,
  which is worth doing for the same reason as the others — a reader who checks one claim and finds
  it loose discounts every other claim.

Also marked "Seller whose only counterparty is the agent" as implemented and unit-tested but **not
yet observed on live data**, because it has not been.

A catalogue whose Caught column is aspirational is worse than one with more gaps, because the gaps
are the part a reader can actually verify. Five lines are OPEN now and the README says so.

No code changed.

### 2026-09-07 (session close) — Claude — HANDOFF rewritten to match reality

*Current State* had gone badly stale: it claimed **47 tests** (actually 165) and listed `params`,
`scoring`, `graph`, `engine`, `settlement` and `verify` as "still only a README" when all six are
written and live. It also said the ceiling and settlement topics were empty; they hold 9 and 5
messages. A stale handoff is worse than none, because it gets trusted — so it is rewritten rather
than patched.

**What the rewrite adds, beyond correcting numbers:**

- **A GAPS section, ranked**, because the gaps are not equal and treating them as a flat list hides
  the two that matter. Correctness and security first, then scaling, then test debt, then
  presentation.
- **Two FALSE CLAIMS in the README, named as such.** "Bulk-minting agents to farm Starter Tabs" is
  listed *Caught* in the attack catalogue and is not — nothing anywhere writes a `register`
  message, so one Starter Tab per funding root is unenforced. And the 40% concentration cap is in
  the SLOW path, not the fast path as the plan states. Both are claims a judge may test.
- **The fail-open exposure stated as a live security gap**, not a footnote. The independence graph
  re-derives ancestry from an index measured to be intermittent, and the loop attacker went uncaught
  on its first full run because of it. Only `@tab/db` closes it.
- **The findings list grew from 3 to 17**, grouped: network/API behaviour, x402, and our own design.
  The most reusable of the new ones is #12 — *a rule is not working just because it is written.*
  Three separate control rules were unreachable because nobody had asked whether they fired.
- **The track board reflects what is actually done**, and marks `mirror` as done-but-untested with
  1,060 lines, which is the highest-risk surface in the repo.
- **Blocked/open questions now records six DECISIONS** that were previously open: bespoke receipts,
  Probe 5, settlement timing, publishing holds, the v2 floor, and `DATABASE_URL`.

**What is next, in order, with the reasoning in the doc:** wire `apps/web` to live data (the video
depends on it, and a mocked dashboard on camera is a credibility risk); fix the two false claims;
`@tab/db`; tests for `mirror`; `sdk` → `mcp` if time. `fastpath` and `observability` are marked
**not worth building** — their absence is already documented as named limits with causes, which
reads better to a judge than a half-built version.

No code changed in this entry.

### 2026-09-07 (end of day) — Claude — v2 published, and the refusal OBSERVED

Two things asked for, both done and both measured.

**1. `@tab/params` v2.** One change from v1: the starter floor `1.000000 → 0.250000`.

The reason is not the demo, it is that **v1 made the product's central claim untestable.** Tab's
thesis is that credit is EARNED. Earned credit for one young customer computes to
`1.0000 × 0.336 × 1.0 × 0.70 = 0.2352`, against a `1.0000` floor — so the grant dominated the
earning for an agent's entire early life, and no amount of honest revenue could move the number.

`v1.ts` is byte-identical and stays forever; its frozen hash test is unchanged at
`59b1d9f6…`. The decisive check afterwards: **`pnpm verify-ceiling` still passes all six ceilings
published under `tab-v1`**, because it resolves each message's own `model` rather than using
whatever is current. That is the frozen-set claim demonstrated rather than asserted, and it is a
demo beat in its own right.

Two second-sources-of-truth fell out of it. The gateway read
`STARTER_CEILING_USDC ?? '1.000000'` — so v2 lowered the floor and the gateway carried on granting
`1.0000`. Now from params, with the env var kept as an explicit override. Same for the per-call cap.

**2. The refusal, observed end to end.**

```
CEILING_EXCEEDED — Spend of 0.3000 refused. Outstanding 0.0000 plus holds 0.0000
plus the request would pass the 0.2500 ceiling.   shortfall 0.0500
```

The sequence, with the numbers as they appeared:

| Step | Measured |
|---|---|
| 4 calls at 0.5000 | 2.0000 raw revenue |
| window closes, engine recomputes | revenue `0.5040` (1.50 raw × 0.336) |
| **earned credit exceeds the floor** | ceiling **`0.3528` bound by `computed`** |
| gateway polls HCS | `1.0000 → 0.3528`, seq 8 |
| agent spends into the headroom | `0.3000` paid, receipt 37 |
| next window, revenue ages out | revenue `0.0000`, tier `Unrated` |
| shrink applies immediately | `shrink 0.3528 → 0.2500` |
| next spend | **`CEILING_EXCEEDED`, shortfall `0.0500`** |

**`bound by computed` is the line that matters.** It means the ceiling was decided by what the agent
EARNED. Under v1 that read `bound by starter_floor` for every agent, always.

**What produced the refusal, stated precisely: NOT the attack.** The ceiling fell because the
revenue that justified it aged out of the trailing window. That is a real product behaviour and it
is the mechanism to name on camera. Conflating it with the attack is the one dishonest move
available here, and the attack's own beat — "the manufactured revenue counts for zero and the
ceiling does not move" — is strong enough without it.

**A third hole closed on the way.** The engine now resumes its in-force ceiling from the topic on a
cold start (`resumed in-force 0.3528 from 0.0.10182697`). It used to seed from its own fresh
computation, so a restart accepted whatever it had just computed — a growth the running engine would
have held became effective simply because the process bounced. And `ceilingsFromMessages` moved into
`@tab/ledger`, since the gateway and the engine both had a copy; `tools/verify` keeps its own
deliberately, because it needs the `inputs` object verbatim to rehash.

165 tests, 5/5 guards. `docs/DEMO.md` now marks the refusal beat RUNS, OBSERVED.

**Next:** wire `apps/web` to live data — the dashboard is where the video lives, and a mocked
dashboard on camera is a credibility risk if any number fails a HashScan cross-check.

### 2026-09-07 (later still) — Claude — the demo refusal: reachable, and NOT where the plan put it

Chased the `CEILING_EXCEEDED` refusal the plan schedules at 1:10. It is reachable, but not from the
attack — and finding out why was worth more than the beat.

**The attack cannot cause a ceiling collapse, because the fake revenue never inflates the ceiling.**
It is worth zero from the first engine pass that can see the funding edge. The plan's beat describes
a system that first *believes* the manufactured revenue and then discovers the edge; ours never
believes it. The detector is faster than the script assumed, so there is nothing to collapse.

The honest beat is *"the manufactured revenue counts for zero and the ceiling does not move — the
attack buys nothing"*, which is arguably the stronger claim and is the one the evidence supports.

**Then a third unreachable rule, same family as the first two.** `SHARED_FUNDING_ROOT` could never
fire: `facts` held one `fundedBy` per account, so the traversal saw one hop on each side and never
the chain between them. `apps/engine` now walks ancestry to the hop limit, memoised. Verified live —
the indirect customer went **48% → 33%** once the shared root became visible, exactly
`0.7 × 0.6 × 0.8`.

That produces the strongest single artifact in the demo, all measured:

| Counterparty | Funding | Weight | Rules |
|---|---|---|---|
| attacker's shill | operator → shill, **directly** | **0% BLOCKED** | `COMMON_FUNDER` |
| indirect customer | operator → intermediary → customer | **33% counted** | `SHARED_FUNDING_ROOT`, `YOUNG_ACCOUNT`, `CONCENTRATED` |
| truly unrelated | unrelated root | 100% | `INDEPENDENT` |

**The third row has never been produced and cannot be on testnet** — every account we create
descends from our faucet account. The demo distinguishes direct control from indirect relation, not
control from true independence. `docs/DEMO.md` says so rather than letting a viewer assume the
stronger claim.

**And the reason the refusal did not happen, which is a parameter decision and not a bug.** With v1,
earned credit for one young customer is `1.0000 × 0.336 × 1.0 × 0.70 = 0.2352` against a
`1.0000` starter floor. The floor decides a new agent's ceiling for its entire early life; beating
it needs >4.25 raw revenue from a single customer, about 9 calls. **A ceiling that never rises
cannot visibly fall.**

Lowering the floor to `0.250000` fixes the demo — and it is a **v2, not an edit**, because ceilings
are already published under `tab-v1` and `verify-ceiling` catches exactly this. It caught me once
already. Both options are laid out in `docs/DEMO.md`; the choice is the user's, since it changes
every future ceiling.

**I did not tune anything to force a refusal.** `docs/DEMO.md` marks that beat NOT YET OBSERVED.

Two smaller finds, both of which cost a demo run each: a hardcoded client-side x402 spend cap
silently rejects everything when the endpoint price changes, reported as
`All payment requirements were rejected by spendControls` — which reads like a protocol fault rather
than the payer's own limit doing its job. Configurable now in both payers. And `pnpm demo:payer`
writes its key into gitignored `.env` instead of printing it, because I argued exactly that in
`tab-create.ts` and `pnpm payer:create` still prints.

161 tests, 5/5 guards.

### 2026-09-07 (late) — Claude — docs/NETWORK_IMPACT.md, measured rather than asserted

The network-impact doc, which was the largest unclaimed share of the rubric and had nothing in it.

**Every number came from our own transactions.** No fee schedule quoted from memory, no projection
from a model. The fee table is the median `charged_tx_fee` over 100 consecutive SUCCESS transactions
on the operator, split by type — because the MEAN was badly skewed: one 63.5M-tinybar outlier pulled
HTS token transfers to 5.9M when the median is 1.36M. A mean would have overstated our own costs by
4x, in the doc whose entire credibility is that its numbers are real.

Tinybar is presented as the exact measurement and USD as an explicitly assumed $0.05/ℏ conversion.

| Unit of work | HCS | HTS | Schedules | ℏ | USD |
|---|---|---|---|---|---|
| One agent spend | 2 | 1 | — | 0.01896 | $0.00095 |
| One inbound call | 1 | 1 | — | 0.01627 | $0.00081 |
| Window close, per tab | 2 | 1 | 1 | 0.13968 | $0.00698 |

**The number that matters: ~2.4% of a 4¢ call, and ~9.5% of a 1¢ call.** That is the viability
argument and its limit in one line — Tab works for per-request payments down to roughly a cent and
not below. Stated in the doc rather than left for someone to compute.

**One claim I deliberately narrowed.** "Ten thousand calls become one transfer" is easy to
overclaim. Tab does NOT reduce the number of seller payments — x402 pays per request by design and
those transfers are the product working. What collapses to one transfer is the AGENT's settlement,
its net position against the float. So 10,000 calls produce 10,000 HTS payments, 20,000 HCS
messages, and **three** window-level operations. The doc says this explicitly.

The scaling section lists only limits, with causes and the package that fixes each: single gateway
instance (holds in memory → `@tab/cache`, p99 1.5ms measured), one hold message per attempted spend
tripling topic volume (→ rolling batch commitment), replay cost growing with topic length (→
checkpoints), and the independence graph failing OPEN because it re-derives from an
eventually-consistent index (→ `@tab/db`).

Also folded in the operational findings that are genuinely useful to other Hedera builders and are
not in any documentation I could find: an x402 payment needs THREE distinct accounts; the Hedera
exact scheme's default `authorization` flow settles AFTER the handler; Node's `fetch` has a 10s
connect timeout no `AbortController` can extend; schedule state must come from Mirror Node; and
Mirror Node's transactions-by-account index is intermittent for a new account.

Linked from README-TAB.md's track justification.

**Next:** demo-parameter pass so the attack produces a REFUSAL, a faucet-funded independent
customer, then `apps/web` against live data.

### 2026-09-07 (night) — Claude — holds are published: the write-ahead order is now provable

`reserve → pay → commit` was the safety property this rail rests on, and it was the one thing a
stranger had to take on trust. `verify-tab` could not assert `debit_has_hold` because holds lived
in the gateway's memory and never reached a topic — an HCS replay showed debits appearing from
nowhere.

Now they do, and the ordering is visible on the public record:

```
  seq 28  at 1788702544.843150104  ->  hold   h_fb2b25485a204c38  0.040000
  seq 29  at 1788702580.124282517  ->  debit  h_fb2b25485a204c38 -0.040000
```

Same hold id, hold strictly first, 36 seconds apart — the x402 settlement in between.

**The await is the whole point.** The gateway publishes the hold and waits for consensus BEFORE
paying. Publishing after the payment, or firing and forgetting, would put both messages on the
topic in an order that proves nothing. And it **fails closed**: if the hold cannot be published the
spend is not attempted, because paying a seller with no published authorisation produces exactly
the debit-from-nowhere this change exists to eliminate — and to a stranger it is indistinguishable
from a gateway inventing debits.

**The cost, measured rather than guessed.** I had said this landed "on the latency path the
fast/slow split exists to protect", and that was wrong in a way that changed the decision: the 50ms
budget is the AUTHORIZATION decision, a cache read that happens before this. The hold write sits
between that and `pay`, and `pay` is a 25-39s x402 HTS settlement. So the real cost is ~2-4s on
~30s — roughly 10%, not a 60x blowup. At high volume it triples topic size and slows every replay,
so production wants a rolling batch commitment rather than one message per hold. Recorded, not
pretended away.

**Then it immediately over-fired, and that needed a bounded fix rather than an excuse.** Holds were
added after receipts already existed, so every historical debit references a hold that was real but
never published. `verify-tab` marked eleven of them as having "bypassed reserve" — red lines that
were not defects, and which buried the one finding that was. So `checkPublicLedger` takes
`holdsPublishedFrom`: debits before the cutover are excluded from the hold rule and **counted in
the report**. A stranger derives that cutover the same way the tool does — the consensus timestamp
of the first `hold` message — so the exclusion is checkable rather than asserted. With no cutover
given the rule is strict, because an absent option must never silently disable a check.

`verify-tab` now reads:

```
  holds published   from 1788702544.843150104   debits before this predate the rule
  PASS  tab 0.0.8812188: 8 entr(ies) ... 4 debit(s) predate the first published hold
  PASS  tab 0.0.10385196: 1 entr(ies) ... 1 debit(s) predate
  FAIL  tab 0.0.10390398: window 5962288 has 2 settlement receipts — paid 2 times
  PASS  every invariant in the set was checked — nothing skipped
```

`LOCAL_ONLY_INVARIANTS` is empty now, and the line still prints. "Nothing was skipped" is a claim a
stranger needs made explicitly.

161 tests, 5/5 guards.

**Next:** the network-impact doc, which is untouched and the largest unclaimed share of the rubric.

### 2026-09-07 (evening) — Claude — tools/verify: the trust artifact, and it caught me first

`pnpm verify-tab` and `pnpm verify-ceiling` both run. 11 tests, 156 total.

**verify-ceiling verifies 5 of 6 published ceilings, and the sixth failure is real and mine.**

```
  FAIL  seq 1 · tab 0.0.10390398 · window 5962322
        AUTHENTIC BUT NOT REPRODUCIBLE — the hash matches, so the record is
        genuine; today's formula or parameter set no longer produces it
        published hash   788a5f6a…   recomputed hash  788a5f6a…
        binding          unrated vs computed   MISMATCH
```

I changed `computeCeiling`'s Unrated/`hasDefaulted` behaviour without bumping `MODEL_VERSION`, so a
ceiling published under `tab-v1` no longer reproduces under today's `tab-v1`. **The freeze rule I
wrote covers parameter NUMBERS; it has to cover the FORMULA too**, and the tool built to catch that
caught it within minutes of existing.

That drove the most useful thing in the package: **the two failure kinds mean opposite things.** A
hash mismatch says the record contradicts itself — suspect the publisher. A hash MATCH with a
different recomputed number says the record is authentic and our release process failed. Reporting
both as "FAIL" would send a reader to precisely the wrong conclusion, so each is named.

**verify-tab found something worse, in my own invariant set.** It printed FAIL for all three tabs:

```
  debit_has_hold: debit unsettled:h_8b10… references unknown hold h_8b10… — it bypassed reserve
```

Not a ledger problem. **`@tab/protocol` has no hold message.** Holds live in the gateway's memory
and never reach a topic, so an HCS replay contains debits with no holds and that invariant fails for
every debit, forever, on a perfectly correct ledger — and a stranger would read three red lines as
fraud. The worst possible failure mode for the trust artifact.

So the invariant set now splits by what the evidence can support: **public** (assertable from
receipts alone) versus **local** (needs the in-process hold table). `verify-tab` runs the public set
and NAMES what it cannot check rather than skipping it quietly — a verifier that checks less than it
appears to is worse than one that checks less and says so.

It now reads:

```
  PASS  tab 0.0.8812188: 8 entr(ies) fold to balance −0.0200, outstanding 0.0200
  PASS  tab 0.0.10385196: 1 entr(ies) fold to balance −0.0400, outstanding 0.0400
  FAIL  tab 0.0.10390398: window 5962288 has 2 settlement receipts — paid 2 times
  PASS  not checkable from the public record: debit_has_hold, commit_amount_matches_hold
```

That remaining FAIL is a **true positive**: the double-settlement damage from this morning's bug is
still on the topic, and the tool exiting non-zero on it is correct.

**The tests are the point, not the live run.** "It printed PASS against live data once" tells you
nothing — a checker that cannot fail is not a checker. So `recheck` is extracted from the command
and tested against a TAMPERED record (caught as `hash_mismatch`), an inflated ceiling with authentic
inputs (caught as `not_reproducible` — hash checking alone would pass it), a changed binding, an
unknown parameter version, malformed records, and a float where basis points belong.

**Two gaps stated rather than papered over.** `FLOAT_TOTAL_USDC` — what the float started with — is
not on any topic, so a stranger can derive every input to `verify-tab` except that one and must be
told it; the fix is to publish it at bootstrap. And whether to publish HOLDS is now an open
decision: it would make the write-ahead ordering externally auditable, at the cost of an HCS message
per attempted spend on the latency path.

**Next:** demo parameters so the attack produces a REFUSAL, a faucet-funded independent customer,
and `apps/web` against live data.

### 2026-09-07 (later) — Claude — the loop attack, caught on live testnet — after it wasn't

`agents/loop-attacker` runs the attack against the live gateway using only public surfaces: no test
hook, no privileged endpoint, no seeded row. It stands up a payer it funds, has that payer buy from
the agent's endpoint with **genuine signed x402 payments**, and spends against the ceiling that
revenue inflates.

**The first full run was NOT CAUGHT.** The script reported it as a real result rather than a
failure, which is what it was built to do:

```
  ── 4. wait for the graph to find the edge ──
  ..........................................................................
  NOT CAUGHT within 900s.
```

Three genuine defects sat behind that, and finding them is worth more than a demo that had worked
first time.

**1. `FUNDED_BY_AGENT` can never fire for a Tab agent.** The hard-block rule the whole design leaned
on was dead code. An agent's tab holds no key — it receives settlement payouts and signs nothing —
so **a tab cannot fund anybody**. The reachable control shape is one operator standing behind both
accounts, which is now `COMMON_FUNDER`: the same account funded the tab and the counterparty. Its
false-positive risk (a public exchange funding both) is documented in `clusters.ts` rather than
hidden, and is defensible only because a Tab is funded by the gateway's float.

**2. Mirror Node's `/transactions?account.id=` index is intermittent for a new account, not merely
lagging.** Against the real attacker account it returned 5 transactions once and **0 both before and
after**, minutes apart, while `/accounts/{id}/tokens` showed the funded balance correctly the whole
time. Because the engine fails open, the attacker was weighted as independent. This is the
fail-open risk I had written into `main.ts` as a comment, demonstrated live within the hour.

**3. The engine never fetched the TAB's own ancestry**, so `sharedFundingRoot(tab, …)` returned
false every time — the tab was not in the facts map at all. Neither the shared-root discount nor
the common-funder block was wrong; neither was ever asked.

`funderOf` is now a point lookup — `/accounts/{id}` for `created_timestamp`, then
`/transactions?timestamp=<exact>` for the `CRYPTOCREATEACCOUNT` — and the funder is read from the
transaction id's own payer prefix, never from the transfer list, because fee collectors appear
there with positive amounts. It is both more reliable and more correct: "who created this account"
is a different question from "who first paid it".

**Then it caught the attack, on live data:**

```
  tab funded by 0.0.8812188

  counterparties
    0.0.10392362    0%  BLOCKED
           COMMON_FUNDER: the same account funded both this counterparty and
           the agent's tab — one operator on both sides of the trade

  revenue         0.0000 per window     (0.0720 before the graph saw the edge)
```

Every one of those x402 payments was real, signed and settled. None of them counts.

**And a fourth defect, found the same way.** The tab's ceiling was published as `0` — because
`computeCeiling` zeroed on `tier === 'Unrated'`. But a brand-new agent has no revenue, so it is
Unrated, so its ceiling is zero, so it cannot spend, so it can **never earn the revenue that would
rate it**. The starter floor existed for exactly that case and was unreachable. It now keys on
`hasDefaulted`: a default is zero, being new is the starter floor. `hasDefaulted` is published as
`def` in the ceiling inputs, because it changes the output on its own.

That also corrects the attack's outcome to something more honest than "the ceiling collapses to
zero": the attack returns the agent to **exactly the ceiling any new tab has**. It buys the
attacker nothing. Zero is reserved for a tab that failed to pay.

**What the demo still needs, stated plainly:** a *refusal* on camera needs the attacker to have
spent against an inflated ceiling before the collapse, and with the current parameters
(0.05/call, 0.10/window revenue floor, 1.0000 starter floor) the manufactured revenue never lifts
the ceiling above the floor — so the collapse has nothing to take away. Either the earn price rises
for the demo or the run makes many more calls. **I have not tuned anything to force it**, and the
attack script says so itself rather than adjusting until it looks good.

**Also worth knowing:** by this same rule the *honest* demo payer is inside our control cluster too
— the operator created it with `pnpm payer:create`. That is not a bug in the rule, it is a true
statement about the demo setup, and a genuinely independent customer needs to be faucet-funded
rather than created by our operator.

145 tests, 5/5 guards, 18 of 27 packages.

### 2026-09-07 — Claude — apps/engine: a ceiling on HCS that a stranger can check

**The transparency claim is no longer a claim.** The engine published a ceiling to topic
`0.0.10182697`, and I verified it the way an outsider would: a throwaway Python script, given
nothing but the on-chain message — no repo, no database, no access to anything of ours —
recomputed the input hash and matched it.

```
canonical inputs : {"cap":"100.000000","floor":"0.000000","mult":0,"ramp":7000,
                    "rev":"0.000000","revAtt":"0.000000","revUnatt":"0.000000","tier":"Unrated"}
recomputed hash  : 788a5f6a…dda1b57
published hash   : 788a5f6a…dda1b57   MATCH
```

That is the property `verify-ceiling` is supposed to deliver, demonstrated before the tool exists.

**The engine runs against live testnet data.** One pass: replay both topics, derive each
counterparty's funding ancestry and account age from Mirror Node, weight, score, publish. On real
data it produced:

```
  revenue         0.0120 per window  (attested 0.0720 · unattested 0.0000)
  tier            Unrated  ×0
  counterparties
    0.0.10385196   48%  counted
           YOUNG_ACCOUNT: account is newer than the age threshold
           CONCENTRATED: over the single-counterparty share cap
```

The arithmetic is checkable by hand, which is the point: 0.15 raw attested, weighted to 48%
(young 0.6 × concentrated 0.8) = 0.072, averaged over 6 windows = 0.012 per window, below the
0.10 floor, so Unrated and a ceiling of zero.

**Two real bugs, both found by running it rather than by reading it:**

1. **The trailing span was one window short.** `<= oldest` collected N−1 windows while
   `effectiveRevenue` still divided by N, so the oldest window's revenue was silently dropped and
   every agent's run-rate was understated by a fixed fraction. It surfaced only because
   `TRAILING_WINDOWS=1` collected *nothing* — a smaller span made a bigger noise.
2. **v1's tier multiples contradicted the documented formula** (`C 12500 · Unrated 10000` against a
   spec of `C 1.0 · Unrated 0`), which made the engine print `Unrated ×1`. Nothing was mispriced,
   because `computeCeiling` short-circuits Unrated to zero — but the *published* `mult` said 1x for
   a tier that gets nothing, and an audit record that disagrees with the model is worse than none.
   Correcting v1 was legitimate only because no ceiling had ever been published under it. Once one
   has, that same fix is a v2.

**`guard:money` caught me too**, in display code: `(weight.bp / 100).toFixed(0)`. Harmless in
itself, and the guard is still right — basis points are integers exactly so display never routes a
rate through a float, and the one place a float is harmless today is the place someone copies it
from tomorrow. `@tab/money` already had `formatBpPercent`/`formatBpMultiple`.

**Deferred, and said out loud in `main.ts` rather than buried:** the README specifies a BullMQ
worker over a Postgres graph writing a Redis snapshot. This runs the same compute against Mirror
Node directly, because `@tab/db` and `@tab/cache` do not exist yet. Two honest costs — ceiling state
does not survive a restart, and **Mirror-derived funding ancestry fails OPEN**, so an account whose
ancestry cannot be fetched is treated as independent. That is the unsafe direction, and the fix is a
persisted graph, not more retries. What is NOT deferred is correctness of the published numbers:
they come from the same pure packages a stranger reruns, over the same public data.

19 tests here, 139 total, 5/5 guards, 17 of 27 packages.

**Next:** `agents/loop-attacker` — the math is proven in tests and the engine runs, but nothing yet
performs the attack against a live gateway and gets refused on camera. Then `tools/verify`, which
now has a working example to codify.

### 2026-09-06 (late) — Claude — @tab/graph and @tab/scoring: the underwriting is real

The two packages the differentiator rests on. 49 new tests, 119 total.

**`@tab/graph` — the independence engine.** Funding ancestry, control clusters in BOTH directions,
counterparty weights, the 40% share cap. The spend-leg direction is the one that catches the loop
attacker and the one almost nobody implements: a lender asks whether the PAYER is independent, and
Tab asks the same of the SELLER, because an agent that funds a seller, buys from it, and books the
seller's income as proof of its own creditworthiness has built a circle out of the lender's float.
Every payment in that circle is real, signed and settled — checking payers alone never sees it.

Decisions worth not re-litigating:

- **Traversal is breadth-first**, so `hops` is the shortest path. "Funded within 3 hops" is a claim
  about the closest relationship; depth-first arriving the long way round makes a related account
  look independent.
- **Cycles terminate two ways** — hop limit AND visited set — and it is tested. A→B→C→A is ordinary
  for accounts under one operator and is exactly what an attacker builds. Unbounded here is a hang,
  and a hang in the demo is indistinguishable from a crash.
- **Discounts multiply, they do not take the minimum.** Taking the min lets an attacker stack flaws
  that each sit under the largest and pay for none of them.
- **Integer basis points everywhere.** There is a test for a share of exactly 40% against a 40% cap,
  because `0.4` has no binary representation and a float comparison can fall either side of it on
  identical inputs. A rule that decides differently on the same facts is worse than no rule.
- **Every weight carries a reason, `INDEPENDENT` included** — counting in full is a decision that
  should be as auditable as discounting one. A blocked counterparty reports only its blocking
  reasons, so the dashboard shows the line that explains the refusal rather than noise around it.

**`@tab/scoring` — effective revenue → tier → ceiling.** Purity is the product requirement:
`verify-ceiling` says a stranger recomputes a published ceiling from HCS, the public Mirror Node and
this repo. They do not have our Postgres and they do not have our clock. `CeilingInputs` is the
contract — if a number is not in that type it may not affect the output — and there is a test that
recomputes a ceiling from its own published inputs and hash-matches.

Two bugs caught while writing it, both mine, both in the first draft:

1. **Tier fall-through was wrong.** Failing A's requirements returned "the tier below" without
   checking that tier's own requirements — so a tab with A-grade revenue and *zero* settlement
   history would have been awarded B, which needs a streak of 4. Exactly the profile the streak
   requirement exists to exclude. Now it walks bands high to low and awards the first one FULLY met.
2. **Two divisions instead of one.** `revenue × multiple × ramp` divided by 10000 twice truncates
   twice, and the loss is asymmetric — it lands harder on a low ramp than a high one, for no reason
   visible in the published inputs. One division at the end.

Also pinned: **the asymmetry rule.** `mayApplyMidWindow` — a ceiling may SHRINK mid-window
instantly, and may never GROW mid-window. If growth were allowed the loop attacker's fastest path
is to fake revenue, watch the ceiling rise inside the same window, spend against it before anything
settles, and repeat. Growth waits for a settlement that actually cleared. `apps/engine` enforces
the transition; scoring only supplies the predicate.

**The honest gap, stated in `@tab/graph`'s module doc and staying stated:** a non-reciprocal
collusion ring defeats this engine. Value never flows back, funding roots genuinely separate,
nothing fires — the accounts look independent because on-chain they are, and the relationship lives
somewhere this data cannot see. The claim is that attestation plus independence raises the COST of
faking revenue, not that it reduces it to zero.

**Next:** `apps/engine` wires these to Mirror Node and publishes ceilings to HCS, then
`agents/loop-attacker` demonstrates the refusal on camera.

### 2026-09-06 (night) — Claude — the reconciler finally proves a spend, and a double-payment bug

**`matched 1 · violations 0 · questions 0`.** The reconciler proves a debit against the chain for
the first time. It has run clean before, but only ever by having nothing it could check — this is
the first run where it actually verified a spend and found nothing wrong.

**The `unsettled:` blocker is fixed, and it was a one-word bug.** `processResponse` returns
`{ status, paymentStatus, body, header }` and the settlement id is on `header.transaction`. The
client read `processed.settlement?.transaction` — a property that has never existed on that type —
so `tx` was `undefined` on every single spend and every debit fell back to `unsettled:<holdId>`.
The reason it survived so long: the call site casts the result to an inline type, and **a cast
asserts a shape rather than checking it**, so the compiler had nothing to disagree with. Worth
remembering the next time an `as {...}` looks harmless.

**The earn leg had a worse version of the same problem.** Its route passed no settlement id at all,
and chasing that turned up something more serious: x402's default `authorization` flow only
VERIFIES before the handler and SETTLES in the response hook afterwards. So `earn.ts`'s central
comment — "the money has ALREADY moved by the time we are called" — was **false**, and the handler
was writing `attested: true` credits for payments that had not settled and still might not. The
Hedera scheme supports `upfront`, which settles first; the route now declares it, which makes the
ordering the code always claimed. It is also faster: 25s per call against 46s, one settle phase
instead of two.

**Then the settlement worker paid a window twice.** It replayed only the receipts topic, so it
never saw the settlement receipts — those live on the settlements topic — and every closed window
looked unsettled forever. Window 5962288 settled twice, two schedule ids, `0.1100` paid twice on
testnet. This is not a slow leak: one extra pass double-pays, ten passes pay eleven times.

Three things came out of that, and the last is the one that matters:

1. The worker merges both topics now.
2. `checkWindowSettledOnce` is a ledger invariant (`checkLedger` runs it), and the worker audits
   before scheduling anything. It catches the bug **from the data alone** — no one has to notice
   two schedule ids.
3. **No money repair is due, and writing one would have made it worse.** A clean settlement
   subtracts its net, so a window settled twice subtracts twice: the ledger already records the tab
   as owing the surplus back, and it nets out against future windows. Confirmed against the chain —
   tab holds `0.3200`, net receipts are `0.2700`, ledger balance `−0.0500`, and those agree. The
   violation is a bug signature, not a mis-statement. `--acknowledge-duplicates` continues once the
   cause is fixed.

The instinct to "repair" a flagged violation is exactly the wrong one here, and the ledger being
self-correcting is not luck — it is what double-entry is for.

70 tests, 5/5 guards, 14 of 27 packages.

### 2026-09-06 (evening) — Claude — the loop closes: an agent with no key earned, and consensus paid it

**The settlement worker runs, and the full credit loop completed on testnet.** One window, start to
finish:

```
  window 5962288
    credits        +0.1500      3 calls to the agent's endpoint
    debits         −0.0400      1 call the agent bought
    net            +0.1100
    receipts       4 → 1 transfer
    outcome        CLEAN
    ramp           25% → 40%
    schedule       0.0.10390470
    executed       1788686819.057159551  (by consensus, not by us)
```

`0.11 TUSD` is in the agent's tab account `0.0.10390398` on testnet, and the agent holds no key.
That is the product's central claim, demonstrated rather than described.

Getting there required fixing something embarrassing. **The first settlement moved nothing.** The
gateway used the operator id as the tab id, so the tab and the hot float were the same account and
the scheduled transfer went from `0.0.8812188` to `0.0.8812188`. Hedera accepted it, consensus
executed it, and the worker printed `CLEAN` with a real schedule id. A settlement that looks
flawless on camera and moves zero between two parties is the worst possible bug to ship into a
demo, and nothing in the output would have given it away. `tick` now refuses a self-transfer
outright, `TAB_ACCOUNT_ID` is required, and `pnpm tab:create` makes an account that is deliberately
funded with **nothing** — every micro-USDC in it has to arrive as earnings or a payout, or the
demo would be quietly undermining its own claim.

**`--dry-run` was worse.** It suppressed only the receipt write, so the dry run scheduled and
executed a real transfer — and then omitted the receipt that marks the window settled, leaving the
next real pass ready to pay it again. A dry run that moves money is worse than no dry run, because
the flag is what convinced you it was safe. `tick` now takes `{ execute }`.

**`@tab/params` is written** (14 tests), which was the honest fix for a duplication I kept
stepping over: the gateway and the worker each computed `Math.floor(now / windowSeconds)` inline.
Those agree right up until one is handed milliseconds, and then the gateway files receipts into a
window the worker never settles and the tab silently never settles at all. `windowOf` throws on a
millisecond timestamp for exactly that reason. `TIER_APR_BP` moved there from `ledger`; v1 is
frozen behind a hash-pinned snapshot test so `verify-ceiling` can recompute historical ceilings
forever.

**The ramp now survives a restart.** `SettlementEntry` carries `rampFromBp`/`rampToBp` and
`rampAfter()` derives the ramp in force from the last settlement. The ramp lives nowhere but the
receipt topic; a replay that dropped it reset every agent's earned credit to the starting ramp on
every worker deploy, which would have been invisible and would have made the core credit mechanic
a lie.

**The reconciler reads the settlements topic now**, so a netted payout is verified rather than
listed as a mystery. It reports `settlements 1` against this window's transfer. Before that, the
healthier the rail, the more open questions its own audit tool raised about it — every clean
settlement read as an unreceipted outflow.

**Still open, and unchanged:** `matched 0` for debits. The two spends in this window carry
`unsettled:<holdId>` instead of a settlement transaction id, so they remain unreconcilable. The
reconciler now attributes them correctly instead of hiding them, but the fix is still in
`apps/gateway/src/spend.ts:143`. **This is the next thing.**

67 tests, 5/5 guards, 14 of 27 packages.

### 2026-09-06 (later) — Claude — the reconciler, and the four bugs it found in itself

`apps/settlement` now has a working reconciler. Getting it honest took four rounds, and every round
was the same lesson: **a tool that proves the books is worthless the moment it says something it
cannot support.**

Run 1 reported `17 discrepancies` and hung. Both were my bugs:

1. **Transaction-id spelling.** Receipts store `0.0.x@s.n`; Mirror Node returns `0.0.x-s-n`. I was
   comparing different spellings of the same id, so nothing ever matched. Fixed with
   `normalizeTransactionId` / `sameTransaction` in `@tab/mirror`.
2. **Wrong invariant.** I treated "a transfer with no receipt" as a violation. It is not — the float
   legitimately funds payers and tops up accounts, and those correctly have no debit receipt. 16 of
   the 17 "discrepancies" were healthy operational transfers. Output is now split into
   **violations** (a receipt with no transfer — always wrong) and **questions** (an unreceipted
   outflow — for an operator to confirm). Only one direction is a hard invariant.
3. **Unbounded walk.** It walked the float's entire history at 5–15s/page. The spec says reconcile
   on every window close, so the walk is now bounded (`--since=`, else `RECONCILE_LOOKBACK_SECONDS`).

Then it printed `CLEAN` over a window containing zero receipts, which is the cry-wolf mistake
inverted and worse. Fixing that surfaced two more:

4. **Silent skips.** Debits with an `unsettled:` placeholder id were `continue`d past uncounted, so
   `CLEAN — all 6 receipts have a matching transfer` was printed about 6 receipts of which **0** had
   been checked. They are now counted as `unreconcilable` and reported as an upstream defect. The
   CLEAN claim rests only on `matched + alreadyRepaired`.
5. **Not idempotent.** The report promised "the reconciler writes a repair receipt" and nothing in
   the code wrote anything. Implementing it exposed the real hazard: the violation re-reported after
   the repair landed, so `--repair` would write a fresh reversal every run — a −0.04 error becomes
   **+0.36 after ten runs.** The command whose job is proving the books would have been the thing
   corrupting them. It now reads existing repairs off the topic and skips what is done.

**Writing repairs is opt-in.** `pnpm reconcile` reports; `--repair` writes. A topic is append-only,
and a tool that mutates the public record while you read its output is not one you would run on
camera.

**Protocol and ledger changed together.** `repairReceipt.why` gained `missing_transfer` — the strict
direction had no code, because the enum was written for the direction I later downgraded to a
question. Its repair *reverses* a debit, so its amount is positive, and `netWindow` was filing every
repair under `debits` (documented negative). Now routed by sign. Three tests cover it; the net was
always right, so this would have misreported a window silently. 28 ledger tests, 50 in total.

**Live, on testnet.** One genuine violation found and repaired: debit receipt
`0.0.8812188@1788647712.000000000` for `0.0400` claimed a transfer Mirror Node has no record of
(`found 0` — and the `.000000000` nanos is the tell; a real SDK id has nanosecond precision). Repair
receipt written to topic `0.0.10182696`; re-run reports `violations 0 · 1 already repaired`.

**The honest gap, and it is the important one:** `matched 0`. The reconciler has still never made a
single *positive* match, because every recent debit carries `unsettled:<holdId>` instead of a real
settlement transaction id — `apps/gateway/src/spend.ts:143` falls back to that placeholder whenever
the x402 facilitator returns no transaction. So the diff cannot yet prove the thing it exists to
prove. **This is the next thing to fix, and it is in the gateway, not here.** Two options: get the
real id out of the x402 settle response, or observe it from Mirror and emit a follow-up receipt —
but note that amount-matching a transfer to a receipt is unsafe in general (two spends of the same
price to the same seller are indistinguishable), so a Mirror-side backfill may only accept an
unambiguous single candidate.

Also decided: [ADR-0009](docs/adr/0009-settlement-schedule-timing.md) — schedule at window **close**,
and the README's "without a keeper" claim is qualified to what HIP-423 actually buys: the settlement
is *executed by consensus rather than submitted by us*, and survives the worker's death.

**Next:** the `unsettled:` root cause, then wire `tick.ts` (written, tested, never invoked — there is
no `apps/settlement/src/main.ts` yet).

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
