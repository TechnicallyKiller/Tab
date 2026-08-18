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

**Phase:** 0 — structure and design complete, no implementation yet
**Next action:** run `pnpm probe`. Nothing in `packages/` or `apps/` starts until all five probes are
green. See [docs/probes.md](docs/probes.md).
**Last updated:** 2026-08-18 by Claude (initial scaffold)

### Track board

**No assigned owners. Everyone is equal — claim a track, work it, release it.** Put your name in
*Claimed by* when you start and clear it when you stop, so two people never edit the same package in
parallel. That is the only rule, and it is about merge conflicts, not authority.

Tracks are dependency-ordered — see [docs/BUILD_ORDER.md](docs/BUILD_ORDER.md). Do not start a
phase whose predecessor is unfinished; you would be building against an interface that does not
exist yet.

| Track | Scope | Phase | Claimed by | Status |
|---|---|---|---|---|
| **P0** | `tools/probes` → `docs/probes.md` | 0 | — | open |
| **G** | `tools/guards` | 0 — unblocked, do it early | — | open |
| **F1** | `money` · `protocol` · `params` | 1 | — | open |
| **F2** | `ledger` | 1 | — | open |
| **F3** | `scoring` · `graph` | 1 | — | open |
| **A1** | `hedera` · `observability` | 2 | — | open |
| **A2** | `mirror` · `db` | 2 | — | open |
| **A3** | `x402` | 2 | — | open |
| **A4** | `cache` | 2 | — | open |
| **FAST** | `fastpath` · `apps/gateway` | 3 | — | open |
| **SLOW** | `apps/engine` · `apps/settlement` | 3 | — | open |
| **S1** | `sdk` · `apps/cli` | 4 | — | open |
| **S2** | `agentkit-plugin` | 4 | — | open |
| **S3** | `apps/dashboard` | 4 | — | open |
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
| Probe 5: fast-path latency to in-region Upstash | `cache` LRU design, the 50ms claim | — |
| Standalone MCP server, or load our plugin into the official Agent Kit MCP server? | `mcp` scope | — |
| Settlement schedule: provisional-amount-at-open, or short-expiry-near-close? | `apps/settlement` | — |
| `AGE_FULL_DAYS` testnet value | `graph`, `params`, the config dump | — |

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
