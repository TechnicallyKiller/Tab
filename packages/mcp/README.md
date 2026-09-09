# @tab/mcp

**Tier 3 · MCP server**

Tab's verbs as MCP tools, so an agent in any MCP-capable runtime can transact on a tab with no
bespoke code. Seven tools; **only `tab_spend` moves money.**

## The decision the old README left open — settled

It offered two options: a standalone server (this), or documentation for loading
`@tab/agentkit-plugin` into `@hashgraph/hedera-agent-kit-mcp`. **Shipping option 1.** Option 2 is
the better ecosystem story and it is not the one to ship first:

- It depends on **two** things that do not exist — the plugin is unwritten — plus an external
  server accepting third-party plugins in a shape nobody here has verified.
- It cannot be driven by a judge in one step. This can: three lines of config and Claude Desktop is
  spending on a Hedera tab.
- It is **additive later.** A plugin can wrap the same `@tab/sdk` verbs whenever the Agent Kit path
  is confirmed, and nothing here has to be undone.

## Use it

```jsonc
// claude_desktop_config.json  (or any MCP client)
{
  "mcpServers": {
    "tab": {
      "command": "node",
      "args": [
        "--experimental-strip-types",
        "/absolute/path/to/ethonline/packages/mcp/src/stdio.ts"
      ],
      "env": {
        "TAB_GATEWAY_URL": "http://localhost:8080",
        "TAB_ACCOUNT_ID": "0.0.10390398"
      }
    }
  }
}
```

Then ask the model things like *"what can my tab afford?"*, *"buy the forecast from this URL for at
most 0.040000"*, or — the one worth trying — ***"why is my ceiling only 0.25?"***

That last question is the point of the whole rail. It answers with the published arithmetic and the
funding-graph evidence:

```
0.0.10385196  0%  BLOCKED
  COMMON_FUNDER: the same account funded both this counterparty and the agent's tab
  funded by 0.0.8812188 · tab funded by 0.0.8812188  ← SAME, which is what COMMON_FUNDER tests
```

## Tools

| Tool | Moves money | What it answers |
|---|---|---|
| `tab_spend` | **yes** | Pay a seller, up to a cap. Returns paid / refused / failed |
| `tab_quote` | no | Would this be allowed? Reserves nothing |
| `tab_balance` | no | Position: balance, outstanding, holds, available, ceiling |
| `tab_ceiling` | no | The ceiling, what bound it, and the published inputs |
| `tab_receipts` | no | Recent ledger entries from the HCS receipt topic |
| `tab_counterparties` | no | Independence weights and the reason for each |
| `tab_health` | no | Gateway reachability, network, token, window |

Every read tool is annotated `readOnlyHint: true`; `tab_spend` is `destructiveHint: true` and
`idempotentHint: false`, so a client knows which one to confirm with a human.

## Invariants

- **A refusal is a structured RESULT, not an error.** `isError: true` makes a client surface a
  failure and invites a model to retry — and a `CEILING_EXCEEDED` retried immediately is refused
  again for the same reason. A refusal returns the rule, the evidence, and what to do instead,
  because choosing different work is the correct response and the agent can only choose it if it is
  told why. A `failed` outcome **is** an error, and hands back the hold id: infrastructure broke
  after the decision to spend, so nobody knows whether the seller was paid, and a retry with a new
  key would be a second payment.
- **No key material anywhere.** `McpConfig` is a URL and a tab id; `createTab` has no parameter
  that would accept a key, and `boundaries.json` bars this package from `@hiero-ledger/sdk`. An MCP
  server runs on a user's machine inside a client the user did not write — the surface where a
  leaked key would hurt most, and so the one where the constraint is enforced rather than promised.
- **`stdout` is the protocol.** A single stray `console.log` corrupts the JSON-RPC stream and the
  client reports a parse error rather than whatever actually went wrong. Every diagnostic goes to
  stderr.
- **Same verbs, same semantics as `@tab/sdk`.** Guidance text comes from `@tab/protocol`, not from
  strings invented here, so an agent that learns the rail through MCP learns the same rail.
- **Fails at startup on a missing `TAB_ACCOUNT_ID`.** A client shows a server as connected the
  moment the process is alive, so one that starts happily and then refuses every call looks like a
  broken rail rather than a missing variable.
