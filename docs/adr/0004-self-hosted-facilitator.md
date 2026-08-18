# ADR-0004 — Self-host the x402 facilitator for the earn leg

**Status:** Accepted · **Date:** 2026-08-18

## Context

`@x402/hedera@2.22.0` exports three entry points — `exact/client`, `exact/server` and
`exact/facilitator`. The facilitator class is constructible from our own signer, so running one
is a configuration decision rather than a protocol implementation project.

The README treats self-facilitation as the *fallback* if Probe 2 finds no public facilitator
advertising `hedera:testnet`, and lists "facilitator down → earn leg queues" in the failure
matrix.

## Decision

Self-host the facilitator for the **earn leg**, where Tab is the resource server. Treat a
public facilitator as the fallback rather than the primary.

On the **spend leg** we are the client and must use whichever facilitator the seller advertises
in its 402 response. That is not our choice to make, and self-hosting does not help there.

## Consequences

**What we gain.** The earn leg no longer has a third-party liveness dependency, which removes a
row from the failure matrix and a category of demo risk. Verification and settlement of inbound
payments happen in our process, so an attested credit receipt can be written in the same code
path that settled the payment — which is exactly the attestation claim, and it gets tighter
rather than looser.

**What it costs.** We become the fee payer for inbound settlement, since the facilitator submits
the transaction. That means the gateway needs an HBAR balance for earn-leg gas, monitored
separately from the USDC float. Add it to `verify-tab`'s health output; an earn leg that stops
because we ran out of HBAR would be an embarrassing way to lose a demo.

**Asymmetry to state out loud.** Tab pays gas when it earns, and the seller's facilitator pays
gas when Tab spends. This is a property of the Hedera exact scheme, not something we chose, but
it belongs in the docs because it is surprising.

**Probe 2 still runs.** It is now scoped to the spend leg: which facilitator do our chosen
demo sellers actually use, and does it support HTS USDC or only HBAR.
