# honest-agent

**Demo actor · holds no key · holds no token · signs nothing · zero dependencies**

An agent that pays for things it cannot afford.

```
pnpm seller        # unmodified x402 seller, in another terminal
pnpm dev:gateway   # the gateway, in another
pnpm demo:honest
```

## It works

```
before    available 0.9200 · outstanding 0.0800

 1. /rank        PAID 0.0400 · seq 6 · 32.3s
    got: {"ranked":["alpha","beta","gamma"], ...}
 2. /summarise   PAID 0.0400 · seq 7 · 30.9s
    got: {"summary":"three findings, one caveat", ...}

after     available 0.8400 · outstanding 0.1600
```

Those sequence numbers are real messages on
[topic `0.0.10182696`](https://hashscan.io/testnet/topic/0.0.10182696), each carrying the hold id
that authorised it.

## Why this package has no dependencies at all

Not minimalism. `boundaries.json` bans `@hiero-ledger/sdk`, `@hashgraph/sdk` and `@x402/hedera`
from this package outright, and it currently declares **nothing** — so "the agent holds no key and
signs nothing" rests on a check anyone can run rather than on our word.

The unmodified seller it buys from lives in [`@tab/testkit`](../../packages/testkit/) for exactly
this reason: a seller needs a key, and putting it here would have quietly broken the claim. The
boundaries guard caught that during the build.

It reaches Tab over plain `fetch`. When `@tab/sdk` exists this becomes `tab.spend({ url, max })`.

## A refusal is a normal outcome

The agent prints the rule, the reason and the guidance, then carries on. It does not crash — an
agent that dies on refusal would undercut the argument that refusing is the safe behaviour.

## Known gaps

- **~31s per call.** Almost all of it is the seller's facilitator running its Mirror Node preflight
  and signature verification, which takes 5–15s per query from a high-latency link. Nothing to do
  with the ceiling check, which is in-memory arithmetic. See `docs/probes.md`.
- **Not the Agent Kit path.** The README's distribution story is a Hedera Agent Kit v4 plugin, and
  that is unwritten, so this demo does not exercise it.
- **One seller, three routes.** The pitch describes three independent unmodified sellers.
- **The earn leg is not demonstrated.** The agent never serves its own paid endpoint, so the tab
  only ever goes more negative — it never swings positive and never settles.
