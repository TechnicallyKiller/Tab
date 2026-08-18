# @tab/probes

**Phase 0. Runs first. Nothing else starts until all four are green and written to
[`docs/probes.md`](../../docs/probes.md).**

Four questions that could invalidate the plan. Each has a fallback decided **in hour one, not hour
twenty** — a probe without a pre-decided fallback is just a way to discover a problem late.

## The four probes

| # | Question | Fallback if it fails |
|---|---|---|
| 1 | Can we obtain testnet USDC (`0.0.429274`)? Circle faucet, Hedera portal, Discord | Mint our own 6-decimal HTS token. One line in the pitch, nothing structural |
| 2 | Which facilitator advertises `hedera:testnet` in `/supported`, and for which asset? | Self-facilitate. Already partly decided — see below |
| 3 | Associate an account with the HTS token and receive a transfer | Explicit association in bootstrap, or auto-association slots. **Fails silently if skipped** |
| 4 | One Mirror Node history query with an explicit timestamp range | Walk history in 60-day chunks. Expect 100 rows/page and seconds of lag |

## What research already settled — do not re-probe these

From `@x402/hedera@2.22.0`'s published constants:

- `HEDERA_TESTNET_USDC = "0.0.429274"` — the README's value is correct
- `HEDERA_USDC_DECIMALS = 6`
- `HEDERA_TESTNET_CAIP2 = "hedera:testnet"`
- `HEDERA_TESTNET_MIRROR_NODE_URL`

**Probe 2 is now narrower.** The facilitator class is exported from
`@x402/hedera/exact/facilitator`, so self-facilitating the **earn** leg is the plan, not the
fallback — see [ADR-0004](../../docs/adr/0004-self-hosted-facilitator.md). Probe 2 is only about
the **spend** leg, where we are the client and must use whatever facilitator the seller advertises.
Rewrite it as: *which facilitator do our chosen demo sellers use, and does it support HTS USDC or
only HBAR?*

**Probe 3 still matters even though `createHederaPreflightTransfer()` checks association for us.**
Our own accounts need association at bootstrap regardless. What the library buys is that a seller
which forgot to associate fails preflight with a reason instead of silently.

## Add a fifth probe

**Fast-path latency to managed Redis, in-region.** The 50ms budget is a claim in the README, and
with Upstash instead of a local Redis the network round trip is a real part of it. Measure it
before building around the number, because if it does not fit, the answer is architectural (a
bigger in-process cache) and you want to know that in hour one.
See [ADR-0005](../../docs/adr/0005-managed-infrastructure.md).

## Contents

| Path | Holds |
|---|---|
| `src/01-usdc.ts` … `src/05-latency.ts` | one file per probe |
| `src/report.ts` | writes `docs/probes.md` — result, evidence, and fallback taken |

## Invariants

- **Output is committed.** `docs/probes.md` is written before any other code exists, per the README.
- **Each probe records evidence**, not just pass/fail — the response body, the transaction id, the
  measured latency. A green checkmark with no evidence is not a finding.
- **A failed probe records which fallback was taken and why**, immediately. That is the whole
  design of Phase 0.
