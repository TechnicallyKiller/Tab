# @tab/testkit

**Dev-only · never a runtime dependency of an app**

Fixtures and fakes. Right now, one thing that matters.

## The unmodified seller

```bash
pnpm seller     # :4055 — /rank /summarise /classify, 0.0400 TUSD each
```

Built from stock `@x402/hedera/exact/server` with **zero Tab awareness**. That is the whole point:
the strongest property in the design is *works with any unmodified x402 endpoint*, and testing
against a seller written with Tab in mind would prove nothing.

**Why it lives here and not in `agents/honest-agent`.** A seller needs a key to receive and settle;
the agent must not have one. `boundaries.json` bans the Hedera SDK from `honest-agent` so that
"the agent holds no key" is a check rather than a claim — and when I first put the seller there,
the guard rejected it. The rule worked without anyone having to remember it.

## Not written yet

The spec calls for more, and none of it exists:

- `fake-payer.ts` — needed before the earn leg can be demonstrated
- graph fixtures encoding the attack catalogue, including the OPEN ones labelled as such
- a deterministic clock, so window boundaries and interest do not depend on wall time
- ledger entry fixtures with crash-shaped gaps
- testcontainers helpers for Postgres and Redis
