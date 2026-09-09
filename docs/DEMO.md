# Demo — what runs, what it proves, and what it does not

Every number here was observed on Hedera testnet. Where a beat has **not** been run end to end it
says so, because a demo doc that quietly mixes the two is worse than no demo doc.

---

## Configuration

```bash
DEMO_MODE=true
WINDOW_SECONDS=300            # 3600 in normal operation
PER_CALL_CAP_USDC=0.500000    # raised from 0.05 so a few calls move the numbers
TRAILING_WINDOWS=1            # revenue averages over one closed window
```

Parameters come from `@tab/params` **v3** (`MODEL_ID = tab-v3`). Three generations exist and each
changed exactly one thing:

- **v1 → v2** — the starter floor, `1.000000 → 0.250000`. The difference between a demo where the
  ceiling can be seen to *rise* and one where the floor decides everything.
- **v2 → v3** — the independence discount steps moved INTO the set, and one is new
  (`UNVERIFIED_FUNDING`, 50%). Before v3 the five steps lived in `apps/engine`, so a published
  weight of `bp 3360` could not be checked by anyone: the numbers behind it were not in the frozen
  record. They are now, and `0.7 × 0.6 × 0.8 = 0.336` is arithmetic a stranger can do.

`v1.ts` and `v2.ts` stay byte-identical beside v3, with their hashes pinned as a tripwire, and
`pnpm verify-ceiling` passes ceilings published under all three by resolving each message's own
`model` field — which is the frozen-set claim demonstrated rather than asserted. **13 of 14 pass.**
The one failure is seq 1 and is genuine: its hash matches, so the record is authentic, but the
`binding` label it recorded is `unrated` where today's formula says `computed`. `computeCeiling`
changed after publication without a version bump. The ceiling *value* is identical either way, so
no credit decision was affected — and leaving the failure visible is the point of owning a tool
whose job is catching exactly that.

Client-side caps are separate and belong to the payers, because a customer decides what it will
pay: `PAYER_MAX_PER_CALL_USDC` and `ATTACK_MAX_PER_CALL_USDC`. Both were hardcoded once and
silently rejected every call when the endpoint price changed, reported by x402 as
`All payment requirements were rejected by spendControls` — which reads like a protocol fault
rather than the payer's own limit working.

## Setup, once

```bash
pnpm tab:create        # the agent's tab — funded with NOTHING, on purpose
pnpm payer:create      # a customer funded DIRECTLY by the operator
pnpm demo:payer        # a customer funded INDIRECTLY, via an intermediary
pnpm seller            # an unmodified x402 seller
pnpm agent:endpoint    # the agent's own paid endpoint
pnpm start:gateway
pnpm engine -- --publish
```

---

## The independence table — the strongest single artifact

Three counterparties, identical revenue, three different weights. All measured:

| Counterparty | Funding | Weight | Rules that fired |
|---|---|---|---|
| `0.0.10392362` (attacker's shill) | operator → shill, **directly** | **0%** — BLOCKED | `COMMON_FUNDER` |
| `0.0.10393567` (indirect customer) | operator → intermediary → customer | **33%** — counted | `SHARED_FUNDING_ROOT`, `YOUNG_ACCOUNT`, `CONCENTRATED` |
| a genuinely unrelated customer | unrelated root | 100% | `INDEPENDENT` |

The arithmetic is checkable by hand: `0.7 × 0.6 × 0.8 = 0.336`. Revenue of `1.0000` from that
customer became `0.3360` of effective revenue.

**The third row has never been produced, and cannot be on testnet.** Every account we can create
descends from our own faucet account, so nothing we make is genuinely independent. The demo
therefore distinguishes **direct control from indirect relation** — not control from true
independence. That is worth saying out loud rather than letting a viewer assume the stronger claim.

---

## Beats

### 0:20 — an agent with no key spends money it does not have · **RUNS**

Tab `0.0.10390398` holds no key it needs, and `pnpm tab:create` funds it with nothing. It calls an
unmodified x402 seller and gets an answer. The seller is paid on chain; the agent signed nothing.

Starter ceiling `0.2500` under v2, bound by `starter_floor`.

### 1:10 — the attack · **RUNS, with a corrected claim**

```bash
pnpm attack
```

The attacker is a second operator with a real wallet. It funds a payer it controls, and that payer
buys from the agent's endpoint with **genuine signed x402 payments** — real signatures, real
settlement, real service delivered. Nothing is forged. Only public surfaces: no test hook, no
privileged endpoint, no seeded row.

Result, measured:

```
  0.0.10392362    0%  BLOCKED
        COMMON_FUNDER: the same account funded both this counterparty and
        the agent's tab — one operator on both sides of the trade

  revenue  0.0720  →  0.0000
```

**The plan's beat was "the ceiling collapses to zero mid-window and the next spend is refused".
That is not what happens, and the reason is that the detector is faster than the plan assumed.**
The manufactured revenue is worth zero from the first engine pass that can see the funding edge, so
the ceiling never inflates — there is nothing to collapse. The attack does not get caught out; it
never works in the first place.

The honest beat is therefore: *the manufactured revenue counts for zero, and the ceiling does not
move. The attack buys nothing.* Arguably a stronger claim than the original, and it is the one the
evidence supports.

**One caveat that must be said.** On the first full run the attack was **NOT caught**, and the
cause was real: Mirror Node's `/transactions?account.id=` index is *intermittent* for a newly
created account — it returned 5 transactions once and 0 both before and after, minutes apart. The
engine fails **open**, so during that window the attacker was weighted as independent. Fixed by
resolving ancestry through a point lookup on `created_timestamp`, but the underlying exposure — a
security rule that fails open while depending on an eventually-consistent index — is only properly
closed by a persisted graph (`@tab/db`). It is a live gap, not a closed one.

### 2:20 / 3:10 — the honest agent at scale · **PARTIALLY RUNS**

Both legs work and are proven. What has **not** been run is the plan's volume: 40 calls across
**three** unmodified sellers, and three independent payers. Today there is one testkit seller and
one indirect customer. The mechanism is demonstrated; the scale is not.

### 3:50 — one netted transfer, and verify on camera · **RUNS**

```bash
pnpm settle            # window close
pnpm verify-tab
pnpm verify-ceiling
```

Measured: four receipts netted to `+0.1100`, one HIP-423 schedule
([`0.0.10390470`](https://hashscan.io/testnet/schedule/0.0.10390470)) **executed by consensus** at
`1788686819.057159551`, ramp `25% → 40%`.

`verify-ceiling` recomputes every published ceiling from its own published inputs and compares
hashes. `verify-tab` replays the topics, asserts the ledger invariants, and states that nothing was
skipped.

**Two things it will show that are true and unflattering.** One tab fails
`window_settled_once` — a window really was settled twice, by a bug since fixed, and the damage is
still on the topic. And the full float invariant needs `FLOAT_TOTAL_USDC`, which is on no topic, so
a stranger must be told that one number. Both are visible in the output. Leave them visible.

**The plan says "ramp 15% → 30%".** The parameter sets start the ramp at 25%, so it reads
`25% → 40%`. The parameters are right and the plan's line is stale.

### 4:30 — what is not solved · **RUNS**

Non-reciprocal collusion rings, custodial float, single signer, no dispute arbitration — plus the
three found while building: the fail-open ancestry exposure above, `FLOAT_TOTAL_USDC` not being
published, and one hold message per attempted spend not being viable at volume.

---

## The refusal beat — **RUNS, OBSERVED**

```json
{
  "refused": {
    "rule": "CEILING_EXCEEDED",
    "reason": "Spend of 0.3000 refused. Outstanding 0.0000 plus holds 0.0000 plus the request would pass the 0.2500 ceiling.",
    "evidence": { "requested": "0.3000", "ceiling": "0.2500", "shortfall": "0.0500" },
    "guidance": "Earn first, or wait for settlement to clear outstanding.",
    "retryable": true
  }
}
```

From the real fast path, reading a ceiling the real engine published to HCS. The full observed
sequence, with the numbers as they appeared:

| Step | What happened | Measured |
|---|---|---|
| 1 | Customer makes 4 calls at 0.5000 | 2.0000 raw revenue |
| 2 | Window closes; engine recomputes | revenue `0.5040` (1.50 raw × 0.336 weight) |
| 3 | Earned credit now exceeds the floor | ceiling **`0.3528` bound by `computed`** — not by the floor |
| 4 | Engine publishes; gateway polls | seq 8, gateway moves `1.0000 → 0.3528` |
| 5 | Agent spends into the headroom | `0.3000` paid, receipt 37 |
| 6 | Next window: the revenue ages out of the trailing average | revenue `0.0000`, tier `Unrated` |
| 7 | Ceiling falls back to the floor, **shrink applies immediately** | `shrink 0.3528 → 0.2500` |
| 8 | The next spend | **`CEILING_EXCEEDED`, shortfall `0.0500`** |

**What produced the refusal, stated precisely.** Not the attack — the ceiling fell because *the
revenue that justified it aged out of the trailing window*. That is a real product behaviour and it
is the mechanism to name on camera. Conflating it with the attack would be the one dishonest move
available here, and the attack's own beat is strong enough without it.

**Step 3 is the beat that matters most, and it only exists because of v2.** `bound by computed`
means the ceiling was decided by what the agent EARNED, not by what it was granted. Under v1 that
line read `bound by starter_floor` for every agent, forever — the grant dominated the earning and
the product's central claim was untestable.

**Step 7 also proves the restart hole is closed.** The engine logged
`resumed in-force 0.3528 from 0.0.10182697 (window 5962359)` — it read the ceiling in force from
the topic rather than seeding from its own fresh computation. Seeding from the computation was a
hole in the asymmetry rule: a restart would accept whatever it had just computed, so a growth the
running engine would have held became effective simply because the process bounced.

## Reproducing the independence table

```bash
pnpm demo:payer                        # indirect customer
pnpm attack                            # direct shill
# wait for the window to close, then:
pnpm --filter @tab/engine recompute    # prints the weight and every reason
```
