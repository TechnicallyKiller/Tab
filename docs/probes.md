# Phase 0 — Probes

**Status: 4 of 5 answered · Probe 2 PASSING as of 2026-09-05.**
Operator `0.0.8812188` · three HCS topics live · money moving between accounts ·
only Probe 2 (spend-leg facilitator) and Probe 5 (Redis latency) outstanding.

Each probe has a **fallback decided in hour one, not hour twenty.** A probe without a pre-decided
fallback is just a way to discover a problem late.

---

## Results

| # | Probe | Status | Evidence | Fallback taken |
|---|---|---|---|---|
| 1 | Obtain testnet USDC (`0.0.429274`) | ✅ **FALLBACK TAKEN** | Circle faucet reported a successful drip; nothing arrived. Polled 10× over 2 min — the account had never had *any* token relationship, so the drip never reached it. Minted the stand-in instead. | **Yes** — `TUSD` `0.0.10182853`, 6 dp, 1000 supply |
| 2 | x402 loop settles on `hedera:testnet` | ✅ **PASS** | `pnpm probe:x402` — 402 challenge → signed retry → verify → settle → 200 with the seller's body, in 2.4s. Buyer −0.5000 ℏ, seller +0.5000 ℏ exactly. Self-hosted facilitator, stock seller. | none needed |
| 3 | Associate USDC and receive a transfer | ✅ **PASS** | `pnpm probe3` — created a fresh account with **0** auto-association slots, confirmed the transfer fails with `TOKEN_NOT_ASSOCIATED_TO_ACCOUNT`, associated it, paid `0.0400`, and confirmed both balances from Mirror Node. | none needed |
| 4 | Mirror Node history query with explicit timestamp range | ✅ **PASS** | `pnpm --filter @tab/mirror test:live` — 7 checks green. See findings below. | none needed |
| 5 | Fast-path latency to Upstash Redis, in-region | ⬜ | Needs an Upstash database | — |

## Also proven, beyond the original five

| What | Evidence |
|---|---|
| **HCS topics create and accept messages** | `pnpm bootstrap` created `0.0.10182696` (receipts), `0.0.10182697` (ceilings), `0.0.10182698` (settlements), each with an ED25519 submit key so the log is append-only and Tab-owned |
| **A message round-trips through consensus** | Submitted to the receipt topic, appeared on Mirror Node within ~2s, reassembled and parsed back |
| **Bootstrap is idempotent** | Second run recreated nothing and skipped the probe write |

## Findings that changed the code

**Settlement is native HBAR, and never needed USDC.**
`asset: "0.0.0"`, tinybars. `@x402/hedera` supports HTS too, but HBAR is the documented default —
so the primary track requirement was provable with HBAR we already held. Considerable time went to
a USDC faucet that was not blocking it.

**ADR-0004's gas asymmetry, now measured.** The buyer moved exactly the price and no fee; the
facilitator's fee payer absorbed it. So the seller's facilitator pays gas when Tab **spends**, and
Tab pays gas when it **earns** and self-facilitates. The gateway needs an HBAR balance monitored
separately from its USDC float.

**x402 ships client-side spend controls, defaulting to USD-pegged assets only.**
`findDefaultAsset` knows USDC, not HBAR, capped at `$1`. HBAR needs an explicit `allowedAssets`
entry with an atomic (tinybar) cap. Notable beyond the fix: it is x402's own version of a per-call
cap, and it is **client-side and advisory** — the agent sets it — which is exactly why Tab's cap
lives in the gateway. Independent support for the design.

**The facilitator fee payer must be a funded ECDSA account, separate from the seller.**
Same account for both nets to price-minus-fee and reads like a wrong price.

**Mirror Node returns empty pages in the middle of a real result set.**
Measured: 7 of 8 pages empty, 1 page with data, `links.next` non-null throughout. An indexer that
stops on the first empty page silently truncates history — and truncated history is a wrong
counterparty graph, which is a wrong credit decision. `@tab/mirror` stops **only** when
`links.next` is null, and reports rather than hides a `maxPages` truncation.

**HCS messages above ~1KB are chunked.**
Each chunk carries its own sequence number plus `chunk_info: {number, total}`. Parsing a lone chunk
yields truncated JSON — loud if you are lucky, silent if you are not. Every topic read goes through
`reassembleChunks()`, which drops and reports incomplete groups rather than parsing them.
This constrains `@tab/protocol`: **keep a receipt under 1KB** so the common path stays single-chunk.

**Failed transactions are returned by the transactions endpoint.**
`result` must be filtered to `SUCCESS`. A reverted transfer never moved value, and counting one puts
a phantom edge in the independence graph.

**Hedera transfer lists are net-settled per transaction.**
One transfer can debit several accounts and credit several others. `toTransferEdges()` pairs them
proportionally so edge amounts sum back to the total moved; the common 1:1 case is exact.

**Mirror Node 404s on an entity that already exists on consensus.**
A just-created account reaches consensus seconds before it reaches the mirror, and the 404 in
between means "not indexed yet", not "does not exist". `getTokenRelationship` now treats 404 as
"no relationship" and `waitForAccount()` polls until the entity appears. Anything that creates an
account or token and reads it straight back must wait.

**The association failure is real, and silent unless you look for it.**
Probe 3 demonstrates it deliberately: a fresh account with 0 slots refuses the transfer with
`TOKEN_NOT_ASSOCIATED_TO_ACCOUNT`. Mirror Node predicts this *before* sending — which is what makes
`canReceiveToken()` worth having in the spend leg's preflight.

**The Circle faucet reported success and delivered nothing.**
Worth knowing before the demo: do not assume a faucet drip landed. Check the balance on-chain.

**Portal accounts now ship with unlimited auto-association.**
`max_automatic_token_associations: -1`. This softens the README's "fails silently if skipped"
warning for portal-created accounts — but accounts **we** create in bootstrap must set it
explicitly, so Probe 3 stays on the list.

Record **evidence**, not just a checkmark: the response body, the transaction id, the measured
number. A green tick with no evidence is not a finding.

---

## Probe 1 — testnet USDC

**Question.** Can we obtain testnet USDC at `0.0.429274`? Try the Circle faucet, the Hedera portal,
and the Hedera Discord.

**Fallback.** Mint our own 6-decimal HTS token. Costs one line in the pitch, nothing structural —
every claim in the design is about credit mechanics, not about which token.

**Already settled.** The token id and 6 decimals are exported as constants by `@x402/hedera`, so
they need no confirmation. Only availability is in question.

## Probe 2 — spend-leg facilitator

**Question.** `curl <facilitator>/supported`. Which facilitator advertises `hedera:testnet`, and
does it support **HTS USDC** or only HBAR (`HBAR_ASSET_ID = "0.0.0"`)?

**Narrowed since the README wrote this.** `@x402/hedera` exports its facilitator class, so we
self-facilitate the **earn** leg — that is now the plan, not the fallback
([ADR-0004](adr/0004-self-hosted-facilitator.md)). This probe is only about the **spend** leg, where
Tab is the client and must use whatever facilitator the seller advertises. Self-facilitating does
not help there.

Ask it as: *which facilitator do our chosen demo sellers actually use, and for which asset?*

**Fallback.** Pick different demo sellers, or stand up our own stock-x402 sellers with a facilitator
we choose. That weakens "unmodified third-party seller" slightly, so prefer real ones — note the
compromise if we take it.

## Probe 3 — token association

**Question.** Associate an account with the HTS token and receive a transfer.

**This fails silently if skipped and has no Solana or Stellar equivalent.** It is the single most
common way a Hedera integration breaks for someone who has not hit it before.

**Fallback.** Explicit association in `pnpm bootstrap`, or configure auto-association slots.

**Partly handled for us.** `@x402/hedera` exports `createHederaPreflightTransfer()`, which checks
via Mirror Node that the payer holds the asset and `payTo` is associated or has a free
auto-association slot. Its own doc note says consensus-node token queries no longer return that
data dependably — Mirror Node is the source. So a seller that forgot to associate fails preflight
with a reason instead of silently. Our own accounts still need association at bootstrap.

## Probe 4 — Mirror Node history

**Question.** One history query with an explicit timestamp range. Confirm page size and measure lag
behind finality.

**Expect.** 100 rows per page, a few seconds of lag. Both are fine — the projection is eventually
consistent by design and the fast path reads a cache snapshot, never Mirror Node.

**Fallback.** Walk history in explicit 60-day chunks.

**Also record** `created_timestamp` from the accounts endpoint. Exact account age is a direct input
to Sybil scoring and is better than a first-operation heuristic.

## Probe 5 — fast-path latency (added after research)

**Question.** Round-trip latency from the gateway to managed Upstash Redis, same region, under a
realistic snapshot read.

**Why this is new.** The README assumed a local Redis. With a managed one, network round trip is a
real part of the under-50ms budget, which is a published claim
([ADR-0005](adr/0005-managed-infrastructure.md)).

**Fallback.** Lengthen the in-process LRU TTL in `@tab/cache`, bounded by how fast a mid-window
ceiling **shrink** must take effect — a shrink is a safety action and must not wait out a cache.
That trade-off is the real content of this probe, and if the numbers do not fit, the answer is
architectural. Which is exactly why it belongs in hour one.

---

## Sign-off

Nothing in `packages/` or `apps/` gets built before every row above is green or has a fallback
recorded and taken.

- [ ] All five probes run
- [ ] Evidence recorded for each
- [ ] Fallbacks taken where needed, and noted in the affected package README
- [ ] `AGE_FULL_DAYS` testnet value chosen and recorded in `@tab/params`
