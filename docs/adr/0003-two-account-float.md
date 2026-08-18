# ADR-0003 — Two-account float: cold Treasury and hot Float

**Status:** Accepted · **Date:** 2026-08-18 · **Supersedes** the README's single-float description

## Context

The README puts the house float in one account secured by a threshold `KeyList`, and presents
that as the answer to custody risk.

Reading the published types for `@x402/hedera@2.22.0` shows why that cannot work as stated. In
the Hedera `exact` scheme, the **client** builds a `TransferTransaction` debiting itself, signs
it, and base64-encodes it as the payment payload; the **facilitator** verifies and submits it as
fee payer. On Tab's spend leg the gateway *is* the client, paying the seller from house float.

So the paying account must produce a signature **per request, inside the request**. A threshold
`KeyList` means collecting m-of-n signatures inside a path budgeted at under 50ms. Either the
latency budget goes or the KeyList is decorative.

## Decision

Split the float across two accounts with different key material and different jobs.

| Account | Key | Holds | Signs |
|---|---|---|---|
| **Cold Treasury** | threshold `KeyList` | the bulk of the float | top-up transfers to Hot Float. Never signs per-request |
| **Hot Float** | single key, held by the gateway | a capped working balance | every spend-leg x402 payment, and the settlement tick |

The cap on Hot Float is a published operational parameter. When its balance falls below a
refill threshold, the settlement service requests a top-up from Treasury — an m-of-n signature
event that happens on a human timescale, where a KeyList is genuinely useful.

## Consequences

**What we gain.** The latency budget survives, because the hot path signs with one key. The
custody claim becomes honest and quantified: the blast radius of a compromised gateway is the
Hot Float cap, not the whole float, and that cap is a number we publish rather than an
assurance we offer.

**What we give up.** We can no longer say the paying account is multi-sig, because it is not.
The [Trust and Security Model](../README-TAB.md) section of the README must be corrected —
"single signer in v1" becomes literally true of the account that pays sellers, with the KeyList
protecting the reserve behind it. Saying this plainly is better than a claim a judge can
disprove by reading `@x402/hedera`'s types.

**Follow-on.** `verify-tab`'s float invariant now spans two accounts:
`treasury + hot_float == float_total + outstanding`. Both balances are readable from Mirror
Node, so the invariant stays checkable by a stranger. See [KEYS.md](../KEYS.md).
