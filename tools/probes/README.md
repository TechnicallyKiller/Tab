# @tab/probes

**Phase 0. Answers the questions that could invalidate the plan, against the real chain.**

```bash
pnpm probe:x402    # Probe 2 — the full x402 loop on Hedera testnet
```

## Probe 2 — x402, PASSING

Proves the primary track requirement: an unmodified x402 seller is paid over the protocol and
settled on-chain, through our own facilitator.

```
unpaid request      HTTP 402  (402 challenge)
paid request        HTTP 200  in 2.42s
seller returned     {"ranked":["alpha","beta","gamma"], ...}
buyer   0.0.8812188   −0.5000 ℏ
seller  0.0.10379572  +0.5000 ℏ
```

Three roles in one process for the spike; they split into real services later.

| Role | Account | Notes |
|---|---|---|
| Buyer | `0.0.8812188` | the operator, standing in for Tab's hot float |
| Seller | `0.0.10379572` | stock `@x402/hedera/exact/server`. Knows nothing about Tab |
| Facilitator fee payer | `0.0.10379287` | **ECDSA, funded.** Co-signs and submits |

## What this measured

**Settlement is native HBAR, and that was never blocked on USDC.**
`asset: "0.0.0"`, amounts in tinybars. `@x402/hedera` supports HTS tokens too, but HBAR is the
documented default — so the track requirement was provable with the HBAR we already held. A lot of
time went into chasing a testnet USDC faucet that did not need to block this.

**ADR-0004's gas asymmetry, confirmed by measurement.**
The buyer moved exactly `−0.5000 ℏ` — the price, no fee — and the seller received exactly `+0.5000 ℏ`.
The facilitator's fee payer absorbed the network fee. So on the **spend** leg the seller's
facilitator pays gas and Tab pays only the price; on the **earn** leg Tab self-facilitates and
therefore pays the gas itself. That asymmetry is real, and the gateway needs an HBAR balance
monitored separately from its USDC float.

**x402 has its own client-side spend controls, and they default to USD-pegged assets only.**
`findDefaultAsset` recognises USDC, not HBAR, with a `$1` per-payment cap. Paying in HBAR needs an
explicit `allowedAssets` entry with an **atomic** cap (tinybars, not `"$1"`).

This matters for Tab beyond the fix: it is x402's built-in equivalent of our per-call cap, and it is
**client-side and advisory** — the agent configures it, so a compromised agent can raise it. That is
precisely why Tab's cap lives in the gateway where the agent cannot reach it. Worth citing as
independent support for the design rather than duplicated work.

**The seller must be a different account from the fee payer.**
Otherwise one account both receives the price and pays the fee, netting to price-minus-fee, which
reads like the price was wrong. First run showed `+0.4975 ℏ` for a `0.5 ℏ` price for exactly this
reason. `pnpm seller:create` makes a dedicated one.

## Known gaps

- **Three roles in one process.** Real Tab splits them, and the skill's rule that a resource server
  must never hold the facilitator key does not apply cleanly to us: Tab *is* both, by design
  ([ADR-0004](../../docs/adr/0004-self-hosted-facilitator.md)). The honest framing is that the float
  is custodial anyway ([ADR-0003](../../docs/adr/0003-two-account-float.md)).
- **Not tested against a third-party seller.** Ours is stock `@x402/hedera/exact/server`, which is
  the right test of "unmodified seller", but it does not answer whether a *public* seller's
  facilitator accepts HTS tokens. That half of Probe 2 is still open.
- **Not tested with an HTS token.** Only native HBAR. Tab is USDC-denominated, so the HTS path needs
  its own run once a token is funded.
- **`processResponse` reports no `kind`.** The payment demonstrably worked (402 → 200 → on-chain
  settlement), so this is our reading of the result object, not a protocol failure.
- **`exactOptionalPropertyTypes` is relaxed in this package only.** `@x402/core`'s own
  `getSupported()` widens `network` to `string` where its `FacilitatorClient` interface requires
  `` `${string}:${string}` `` — a mismatch inside the library's types. `packages/` and `apps/` keep
  the strict setting.
