# agents/ — demo actors

Two agents. One earns trust, one attacks the design.

| Agent | Operator | Gets the Hedera SDK? |
|---|---|---|
| [`honest-agent`](honest-agent/) | us | **No** — banned in `boundaries.json` |
| [`loop-attacker`](loop-attacker/) | a second party | **Yes** — it must control a seller |

## The SDK ban on honest-agent is the demo's central claim, made checkable

The pitch is that the agent holds no key, holds no USDC, and signs nothing per call. If
`honest-agent` can import `@hiero-ledger/sdk`, that claim rests on us not having used it. With the
import banned, it rests on a check anyone can run.

Same reasoning as `tools/verify` being barred from Postgres: prefer a promise a stranger can
confirm over a promise we assert. It costs one line in `boundaries.json` and it converts the
strongest claim in the pitch from a statement into a property.

`loop-attacker` **does** get the SDK, because standing up a seller it controls is the entire
attack. That asymmetry is the point.
