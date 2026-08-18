# Phase 0 — Probes

**Status: NOT RUN.** Nothing else starts until every row is green and this file is filled in.

This file is a template until `pnpm probe` overwrites it. It is committed empty on purpose — per the
README, the probes are written before anything else exists.

Each probe has a **fallback decided in hour one, not hour twenty.** A probe without a pre-decided
fallback is just a way to discover a problem late.

---

## Results

| # | Probe | Status | Evidence | Fallback taken |
|---|---|---|---|---|
| 1 | Obtain testnet USDC (`0.0.429274`) | ⬜ | | |
| 2 | Spend-leg facilitator supports `hedera:testnet` + HTS USDC | ⬜ | | |
| 3 | Associate USDC and receive a transfer | ⬜ | | |
| 4 | Mirror Node history query with explicit timestamp range | ⬜ | | |
| 5 | Fast-path latency to Upstash Redis, in-region | ⬜ | | |

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
