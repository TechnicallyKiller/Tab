# honest-agent

**Demo actor · holds no key · holds no USDC · signs nothing · cannot import the Hedera SDK**

An agent that has existed for thirty seconds and pays for something.

## What it does

1. Registers. Receives a **Starter Tab**: $1.00 ceiling, $0.05 per-call cap, allowlisted sellers.
2. Spends across **three unmodified x402 sellers**. They never learn Tab exists.
3. Serves its own paid endpoint to **three independent payers**. The tab swings positive.
4. Reaches window close. 43 calls settle as **one netted transfer**.
5. Clean settlement → ramp 15% → 30%.

## Why the Starter Tab is the opening move

Pure revenue underwriting has a circular cold start: no attested revenue → ceiling of zero → cannot
spend → cannot do the work that would earn revenue. The Starter Tab breaks the circle at a size
where abuse is uneconomic — $1.00 is below the cost of the Sybil setup needed to farm it, and the
funding-root check means minting 100 agents from one wallet yields **one** Starter Tab, not 100.

The README is right that this is the strongest possible first thirty seconds: an agent that has
existed for half a minute paying for something beats any dashboard.

## Contents

| Path | Holds |
|---|---|
| `src/main.ts` | the run script — 40 paid calls across 3 sellers |
| `src/endpoint.ts` | the agent's own paid endpoint, fronted by the gateway |
| `src/agentkit.ts` | the Agent Kit v4 path, exercising the plugin and `TabCeilingPolicy` |

## Invariants

- **No `@hiero-ledger/sdk` import.** Banned in `boundaries.json`. This is the claim.
- **No private key in its environment.** Not even an unused one.
- **It reaches Tab only through `@tab/sdk` or `@tab/agentkit-plugin`.**
- **It handles a refusal as a normal outcome.** A refused spend means "pick different work", not
  "crash". An agent that dies on refusal would undercut the argument that refusing is the safe
  behaviour.

## Demo note

Run the Agent Kit path at least once on camera, so the plugin is demonstrated rather than claimed —
the plugin is the distribution story for the primary track, and a tool call visible in an agent
transcript is much stronger evidence than a README section.
