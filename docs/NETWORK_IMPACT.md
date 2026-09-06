# Network Impact

**What Tab puts on Hedera, measured rather than asserted.**

Every number in this document was taken from our own testnet transactions through the public Mirror
Node. Nothing is quoted from a fee schedule, and nothing is projected from a model. Where a figure
is an assumption it is labelled as one.

---

## Summary

Tab is a credit rail for autonomous agents. An agent holds no key and no balance; it spends against
a ceiling underwritten by revenue the gateway can attest to, and the whole ledger lives on HCS.

Its contribution to Hedera is not "another app that transacts". It is a **per-request payment
pattern that only closes at Hedera's fee level**, exercising four native services with no contract
anywhere in the system:

- **HCS is the accounting store.** Not an audit log beside a database — there is no other ledger.
- **HTS carries every payment** — seller payouts on the spend leg, customer payments on the earn
  leg, netted settlement at window close.
- **Schedule Service executes the settlement tick by consensus**, so the tick survives our worker
  dying (HIP-423, `wait_for_expiry`).
- **Mirror Node is the entire read path** — replay, independence graph, reconciliation, and the
  verifier a stranger runs.

---

## Live on testnet now

| Artifact | Id | State |
|---|---|---|
| Receipt topic | [`0.0.10182696`](https://hashscan.io/testnet/topic/0.0.10182696) | 29 messages — holds, debits, credits, refusals, repairs |
| Ceiling topic | [`0.0.10182697`](https://hashscan.io/testnet/topic/0.0.10182697) | 6 published ceilings, each with its input hash |
| Settlement topic | [`0.0.10182698`](https://hashscan.io/testnet/topic/0.0.10182698) | 5 settlement receipts |
| Settlement token | [`0.0.10182853`](https://hashscan.io/testnet/token/0.0.10182853) | `TUSD`, 6 decimals — stands in for testnet USDC |
| Hot float | [`0.0.8812188`](https://hashscan.io/testnet/account/0.0.8812188) | fronts every agent spend |
| Agent tab | [`0.0.10390398`](https://hashscan.io/testnet/account/0.0.10390398) | **holds no key it needs** — receives, never signs |
| Executed settlement | [`0.0.10390470`](https://hashscan.io/testnet/schedule/0.0.10390470) | executed by consensus at `1788686819.057159551` |

Four more schedules have executed the same way (`0.0.10390303`, `0.0.10390637`, `0.0.10392071`).

**The one artifact worth opening first** is the ceiling topic. Take any message, hash its `inputs`
field canonically, and compare to its `hash`. It matches — with no access to our database, our
gateway, or our cooperation. That is the whole no-contract argument, and it is checkable in about
thirty seconds.

---

## Transaction profile, per unit of work

This is the quantitative core. Derived from the code paths, each confirmed against the live topics.

| Unit of work | HCS messages | HTS transfers | Schedules |
|---|---|---|---|
| **One agent spend** (reserve → pay → commit) | 2 — hold, debit | 1 — to the seller | — |
| **One refused spend** | 1 — refusal | 0 | — |
| **One inbound call** (the agent earns) | 1 — credit | 1 — customer → float | — |
| **Window close, per tab** | 2 — settlement, ceiling | 1 — netted position | 1 |

Two properties matter here, and they pull in opposite directions.

**Per-call cost is flat and small.** A spend is three chain operations regardless of the amount,
the agent, or how many other agents are active. There is no global state to contend on, no queue,
no lock.

**Window cost is fixed, not per-call.** A window with 10,000 calls closes with the *same* one
schedule, one transfer and two messages as a window with one call. That is the netting claim, and
it is worth stating precisely because it is easy to overclaim:

> Tab does **not** reduce the number of seller payments. x402 pays per request by design, and
> those transfers are the product working, not overhead. What collapses to one transfer is the
> **agent's own settlement** — its net position against the float. Without that, an agent
> transacting 10,000 times would need 10,000 reconciliation events with whoever funded it.

So: 10,000 calls in a window produce 10,000 HTS payments and 20,000 HCS messages, plus **three**
window-level operations. The per-agent settlement burden is O(1) in call volume.

---

## Measured fees

Medians from 100 consecutive `SUCCESS` transactions on our operator account, read from Mirror
Node's `charged_tx_fee`. Tinybar is the exact measurement; the USD column is a conversion at an
**assumed** ℏ price of $0.05 and is illustrative only.

| Operation | n | Median fee (tinybar) | ℏ | USD @ $0.05/ℏ |
|---|---|---|---|---|
| HCS `submitMessage` | 38 | 269,409 | 0.00269 | $0.000135 |
| HTS token transfer | 38 | 1,357,481 | 0.01357 | $0.000679 |
| `ScheduleCreate` | 8 | 12,340,751 | 0.12341 | $0.006170 |
| HBAR-only transfer | 13 | 249,004 | 0.00249 | $0.000125 |

Composed into the units above:

| Unit of work | ℏ | USD @ $0.05/ℏ |
|---|---|---|
| One agent spend | 0.01896 | **$0.00095** |
| One inbound call | 0.01627 | $0.00081 |
| Window close, per tab | 0.13968 | $0.00698 |

**At our demo price of 0.0400 USDC per call, chain fees are ~2.4% of transaction value.** Window
overhead amortises to nothing above ~100 calls.

That ratio is the entire viability argument, and it is worth being blunt about where it breaks: at
a **1¢** call price the same fees are ~9.5%, and below that the pattern stops making sense. Tab is
viable for per-request payments down to roughly a cent, not to arbitrarily small amounts.

---

## Why this does not work elsewhere

Not a comparison table — a specific dependency on three Hedera properties, each of which we hit in
practice rather than in theory.

**Fees are USD-denominated and sub-cent.** The table above is the argument. A per-request rail
where the fee is a variable fraction of a 4¢ payment cannot be underwritten, because the ceiling
math would have to price fee volatility. Hedera's fees being fixed in USD is what makes
`0.0400 − fees` a number the ceiling engine can treat as known.

**Finality matches the settlement tick.** A window is 300–600s; consensus is ~3s. Our measured
end-to-end x402 HTS settlement is **25–39s**, dominated by the payment protocol's round trips
rather than by consensus. That slack is why publishing a hold *before* paying — and awaiting
consensus on it — costs ~10% of a spend rather than doubling it.

**HCS gives ordering we would otherwise have had to build.** The ledger is a replay of
consensus-ordered messages. There is no sequence-number authority, no clock to trust, and no
migration path to get wrong. `verify-tab` folds the same messages through the same pure package the
gateway uses, which is why a stranger's replay and ours cannot disagree.

**And a fourth, discovered the hard way:** Mirror Node's `/transactions?account.id=` index is
**intermittent for a newly created account** — it returned 5 transactions once and 0 both before
and after, minutes apart, while the balance endpoint was correct throughout. Our independence graph
initially failed *open* because of it, and the loop attacker went uncaught. The fix was a point
lookup on `created_timestamp`. This is a real operational property of the network that anyone
building underwriting on Mirror Node should know, and it is documented rather than smoothed over.

---

## What scales, and what does not

Stated as limits rather than as a roadmap, because a scaling section that lists only strengths is
not a scaling section.

**Scales as built:**

- Per-call chain cost is flat and contention-free.
- Settlement is O(1) per tab per window in call volume.
- The read path is Mirror Node, which we do not operate.

**Does not scale as built, and why:**

| Limit | Cause | What it needs |
|---|---|---|
| **One gateway instance** | Holds live in process memory, so two instances would each allow up to the ceiling | `@tab/cache` — an atomic reserve in co-located Redis. Measured p99 **1.5ms**, 33× inside the 50ms budget |
| **Publishing one hold per attempted spend** triples topic volume | Every hold is its own message, including ones that expire unused | A rolling batch commitment — one message covering many holds — preserving the ordering proof at O(1) messages |
| **Replay cost grows with topic length** | `verify-tab` and every worker boot replay from sequence 1 | Periodic state checkpoints published to HCS, so a replay starts from the last checkpoint |
| **Independence graph re-derives from Mirror every pass** | No persisted graph, so a fetch failure fails **open** | `@tab/db` — record the funding edge when observed and never forget it. A security rule that fails open must not depend on re-deriving its inputs from an eventually-consistent index |
| **Ceiling publication must not run concurrently** | Two workers publishing for one agent produce two ceilings with identical inputs and different sequence numbers, making the topic ambiguous | A job key per agent |

The fee floor above is the honest ceiling on the whole pattern: **roughly one cent per call.**

---

## Contributions back to the ecosystem

Reusable independently of Tab, and written as packages rather than as internals for that reason:

- **A working x402 integration on `hedera:testnet`, both directions** — paying and being paid,
  self-facilitated. `@tab/x402`. Two findings in it are not in any documentation we could find:
  an x402 payment needs **three distinct accounts** (payer, `payTo`, fee payer — the scheme rejects
  a transfer the fee payer is party to), and the Hedera exact scheme's default `authorization` flow
  settles **after** the handler, so a resource server that credits revenue in its handler is
  crediting a payment that has not settled. `paymentFlow: 'upfront'` fixes it.
- **A typed Mirror Node client** with the pagination, chunk-reassembly and timeout behaviour the
  API actually requires — including that Node's `fetch` has a **10-second connect timeout no
  `AbortController` can extend**, which surfaced as a spurious x402 signature error for hours.
  `@tab/mirror`.
- **HIP-423 keeper-free settlement, proven end to end** — including that schedule state must be
  read from Mirror Node, because a consensus node that did not see the create returns
  `INVALID_SCHEDULE_ID`. `@tab/hedera`.
- **A no-Solidity CI guard.** `pnpm guard` fails the build on any `.sol` file or EVM tooling, and
  reports which native services are in use. Copyable by any project making the same claim.
- **`docs/probes.md`** — every Phase 0 probe with its result, including the ones that failed first
  and why.

---

## What we are not claiming

- **Not decentralised.** The float is custodial and the gateway is a single signer. Receipts make
  operator misbehaviour *detectable*; they do not make it *preventable*. Listed OPEN by design.
- **Not a throughput record.** Tab's contribution is a pattern that closes economically, not a
  benchmark. The measured volume above is a demo's worth of traffic.
- **Not viable at arbitrary micro-amounts.** ~2.4% of a 4¢ call, ~9.5% of a 1¢ call. Below a cent
  the fees dominate.
- **Not a complete defence against fabricated revenue.** A non-reciprocal collusion ring — value
  never flowing back, funding roots genuinely separate — defeats the independence graph. The honest
  claim is that attestation plus independence raises the *cost* of faking revenue, not that it
  reduces it to zero.

---

## Reproducing every number here

```bash
pnpm verify-tab            # replay HCS, assert the ledger invariants
pnpm verify-ceiling        # recompute every published ceiling, compare hashes
pnpm guard                 # no Solidity, one SDK, no float money, no secrets
```

The fee table came from one Mirror Node request:

```
GET /api/v1/transactions?account.id=0.0.8812188&limit=100&order=desc
```

aggregating `charged_tx_fee` by `name` over `result == SUCCESS`. No credentials required, and no
part of it depends on anything we run.
