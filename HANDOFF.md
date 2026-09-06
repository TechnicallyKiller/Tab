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

**Next action:** demo-parameter pass so the attack produces a REFUSAL (currently the manufactured
revenue never lifts the ceiling above the starter floor, so the collapse has nothing to take away);
a faucet-funded independent customer so the honest demo is not itself inside our control cluster;
then `apps/web` against live data. Still open: bump `MODEL_VERSION` before the next formula change.

**Last updated:** 2026-09-07 by Claude (network-impact doc — every figure measured from our own transactions)

### Written: 19 of 27 packages

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
