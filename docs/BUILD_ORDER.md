# Build Order

Dependency-ordered, so nobody is blocked waiting on someone else's package. The tier system makes
this straightforward: **build bottom-up, and the tiers are the phases.**

**No assigned owners.** Everyone here is equal and anyone can take any track. What follows are
*tracks*, not job descriptions — self-serve. Claim one in the board in
[HANDOFF.md](../HANDOFF.md), work it, release it when you are done or bored.

Two constraints that are about the code, not about hierarchy:

- **One person per track at a time.** Not because anyone is in charge, but because two people
  editing `@tab/protocol`'s schemas in parallel produces two conventions and a merge conflict in
  every downstream package. Claim it, or work a different track.
- **Phases are ordered by dependency.** Skipping ahead means building against an interface that
  does not exist yet. The order is the compiler's opinion, not a manager's.

## Phase 0 — nobody writes product code yet

**Whoever gets to it first — half a day, one person. Everyone else reads.**

`tools/probes` → all five green → `docs/probes.md` filled in.

One person, because five probes do not parallelise usefully and they share a Hedera account. Anyone
can be that person. Everyone else spends this time on [RESEARCH.md](RESEARCH.md),
[ARCHITECTURE.md](ARCHITECTURE.md), and the ADRs. This is not idle time — the six research findings
change what several packages do, and finding that out on day three is expensive.

**Gate:** no `packages/` or `apps/` work starts before this. Probe 5 in particular can force an
architectural change to `@tab/cache`, and you want that on day one.

## Phase 1 — the foundation (parallel, 3 people)

Tier 0 and 1. All pure, all independently testable, **no infrastructure needed**, so three people
can work simultaneously with no coordination cost.

| Track | Packages | Why it is one track and not three |
|---|---|---|
| **F1** | `money` → `protocol` → `params` | One mind on serialization and rounding. Split it and you get two conventions |
| **F2** | `ledger` | The accounting core. `reserve → pay → commit`, netting, interest, invariants |
| **F3** | `scoring` + `graph` | The ceiling engine. The only genuinely novel work in the project |

**Do this first, together, before splitting up:** agree the HCS message shapes in
`@tab/protocol`. Everything downstream reads and writes them, and a change on day four touches
every package. Half a day of shared design here saves two days later.

**Gate:** `@tab/money` and `@tab/protocol` are stable. Everyone else is blocked on them, so they
ship first even if incomplete elsewhere.

## Phase 2 — adapters (parallel, 3 people)

Tier 2. Needs Supabase and Upstash provisioned.

| Track | Packages |
|---|---|
| **A1** | `hedera` + `observability` |
| **A2** | `mirror` + `db` |
| **A3** | `x402` — **read [packages/x402/README.md](../packages/x402/README.md) first.** The exact scheme's signing model is not obvious and it drove two ADRs |
| **A4** | `cache` — small, but the LRU-in-front-of-Redis decision shapes the latency budget. Worth pairing on |

**Gate:** `pnpm bootstrap` works end to end. Topics exist, USDC associated, hot float funded.

## Phase 3 — the two paths (parallel, 2 pairs)

This is the critical path and the two halves genuinely do not block each other — they meet only at
the Redis snapshot, whose shape is fixed in `@tab/cache`. **Fix that shape before splitting.**

| Track | Builds | The hard part |
|---|---|---|
| **FAST** | `fastpath` → `apps/gateway` | both x402 legs, the self-hosted facilitator, `reserve → pay → commit`, and holding the latency budget |
| **SLOW** | `apps/engine` → `apps/settlement` | indexer idempotency, the shrink-now/grow-later transition, HIP-423 scheduling, the reconciler |

Two tracks, and each is big enough for two people if you have them.

**Gate:** an agent can spend against a hardcoded ceiling and a receipt lands on HCS. That is the
first moment the product exists, and it should happen well before the demo is due.

## Phase 4 — surfaces (parallel, 3 people)

| Track | Builds |
|---|---|
| **S1** | `sdk` → `apps/cli` |
| **S2** | `agentkit-plugin` — the distribution play for the primary track |
| **S3** | `apps/web` — **start with the Refusals view** |
| **S4** | `mcp` — but **read [packages/mcp/README.md](../packages/mcp/README.md) first.** An official Agent Kit MCP server exists; loading our plugin into it may be the better answer and costs an hour to find out |

`S4` depends on `S1`, so whoever finishes the SDK is best placed to pick it up — or hand it off.

Refusals first is not arbitrary: it is what is on screen at 1:10 in the demo, the moment the whole
pitch is built around. Views built last are built badly.

## Phase 5 — the demo, and `tools/verify`

| Track | Builds |
|---|---|
| **D1** | `tools/verify` — **the trust artifact.** Runs on camera at 3:50 |
| **D2** | `agents/honest-agent` |
| **D3** | `agents/loop-attacker` — the 1:10 moment |

**Do not leave `tools/verify` to the end.** It is what replaces a smart contract, and it will surface
real bugs in the ledger and in scoring — bugs you want found in phase 5 with time to fix, not while
recording. Consider pulling it into phase 3 as soon as receipts land.

---

## Things to do earlier than feels necessary

Each of these is cheap now and expensive later:

- **`tools/guards`** — day one. Boundary violations get harder to unwind every day, and the whole
  structure is decoration without them.
- **`db.rebuild()`** — with the first schema. A rebuild first attempted in week three does not work,
  and it is the check that keeps HCS-as-truth honest.
- **The demo script, as a runnable script** — not a document. It should be `pnpm demo:honest` and
  `pnpm demo:attack` from early on, so it is exercised continuously rather than trusted once.
- **`tab config`** — trivial to write, and it is the answer to the `AGE_FULL_DAYS` question a judge
  will ask.
- **The latency test in CI** — the under-50ms number is a published claim, so it belongs in the
  build, measured against real in-region Redis.

## Things to cut if time runs short

In this order, and be honest about it in the video rather than quietly shipping less:

1. **`mcp`** — the Agent Kit plugin already covers the agent-surface requirement, and the official
   Agent Kit MCP server may cover this for free.
2. **HCS-14 UAID** — explicitly bonus tier in the README, and a Draft standard.
3. **Dashboard polish** — but not the Refusals or Ceiling views. Those two are the demo.
4. **The third demo seller** — two unmodified sellers make the same point as three.

**Never cut:** `tools/verify`, `tools/guards`, the reconciler, or the loop-attacker demo. Those four
are what distinguish this from a submission that shows an agent can pay.
