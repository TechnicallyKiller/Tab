# Deploy

**What actually needs hosting: one service.** Everything else is either the wrong
shape for Render or belongs somewhere free that suits it better.

| Component | Where | Why |
|---|---|---|
| `apps/gateway` | **Render** web service, free, **1 instance** | The API. The only long-running server. |
| `apps/web` | **Vercel** hobby, free | A Next.js 16 app. Vercel is its native host. |
| `apps/engine` | Laptop, or GitHub Actions cron | Not a server — one pass per window, then it exits. |
| `apps/settlement` | Laptop, or GitHub Actions cron | Not a server — runs on the window boundary. |
| `agents/honest-agent` | Laptop | Only needed for the earn-leg demo. |

Nothing here costs money. Hedera **testnet** (faucet HBAR, faucet USDC), the
**public** Mirror Node, Render free, Vercel hobby.

---

## 1 · Gateway → Render

`render.yaml` at the repo root is a blueprint. **New → Blueprint**, point it at
the repo, and Render will prompt for every `sync: false` variable.

Or by hand: **New → Web Service**, connect the repo, then

- **Build** `corepack enable && pnpm install --frozen-lockfile`
- **Start** `pnpm --filter @tab/gateway start`
- **Health check path** `/health`
- **Instances** `1`
- **NODE_VERSION** `22.20.0`

Then paste the values from your `.env`: `HEDERA_OPERATOR_ID`,
`HEDERA_OPERATOR_KEY`, `FAUCET_ACCOUNT_ID`, `FAUCET_ACCOUNT_KEY`,
`USDC_TOKEN_ID`, `TAB_ACCOUNT_ID`, `TOPIC_RECEIPTS`, `TOPIC_CEILINGS`,
`TOPIC_SETTLEMENTS`. Leave `AGENT_ENDPOINT_URL` unset unless you want the earn
leg.

### Five things that will bite you, in the order they will

1. **ONE INSTANCE. This is correctness, not cost.** Holds live in process memory
   (`state.ts`), so two instances would each allow spending up to the full
   ceiling — the agent spends twice its limit while the ledger stays right about
   every individual debit and wrong about the total. `@tab/cache` fixes it.
   Until then, never scale this service.

2. **A free service spins down after ~15 minutes idle**, and the gateway's cold
   start replays the entire receipt topic from Mirror Node. That is tens of
   seconds before it answers. **Hit `/health` a few minutes before you demo.**

3. **Node must be 22.9 or newer.** Every service starts with
   `--env-file-if-exists`, which does not exist before 22.9 — node exits with an
   unknown-flag error and the logs make it look like a broken script. `engines`
   and `NODE_VERSION` both pin it.

4. **The gateway binds `PORT`**, which Render injects. It used to read only
   `GATEWAY_PORT`; the health check then failed with *nothing* in the logs,
   because from the process's point of view it started fine.

5. **Restarting loses nothing.** HCS is the source of truth and the projection
   rebuilds from it. Holds in flight at the moment of a restart are the one
   exception, and they expire on their own rather than stranding headroom.

### Check it worked

```bash
curl https://<your-service>.onrender.com/health
# {"ok":true,"network":"testnet","token":"0.0.429274","window":...}

curl https://<your-service>.onrender.com/v1/tabs
```

---

## 2 · Console → Vercel

Import the repo, set **Root Directory** to `apps/web`, and add two environment
variables **before the first build**:

```
NEXT_PUBLIC_TAB_GATEWAY_URL = https://<your-service>.onrender.com
NEXT_PUBLIC_TAB_ACCOUNT_ID  = 0.0.<your tab>
```

**`NEXT_PUBLIC_*` is inlined at BUILD time**, not read at runtime. Set them
after the build and the console will render mock data — correctly labelled
`MOCK DATA` on screen, which is the honest failure but not the one you want on
camera. If you change the gateway URL, **redeploy**.

`next.config.ts` prefers `process.env` over the root `.env`, so Vercel's values
win and the missing `.env` on a fresh clone is not an error.

---

## 3 · Engine and settlement — not servers

Both are passes, not daemons. Render cron jobs are a paid feature and this
project has no budget, so either:

**Run them locally during the demo** — simplest, and what the demo script
assumes:

```bash
pnpm engine:once --publish     # recompute and publish a ceiling
pnpm settle                    # settle the closed window
pnpm reconcile                 # audit the money against Mirror Node
```

**Or schedule them free on GitHub Actions.** Public repos get unlimited minutes.
Note what this means: the workflow needs `HEDERA_OPERATOR_KEY` in repository
secrets. That is acceptable for **testnet** keys holding faucet funds and is not
acceptable for anything else — decide that deliberately rather than by default.

```yaml
# .github/workflows/engine.yml
on:
  schedule: [{ cron: '*/10 * * * *' }]   # every 10 minutes
jobs:
  engine:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22.20.0' }
      - run: corepack enable && pnpm install --frozen-lockfile
      - run: pnpm engine:once --publish
        env:
          HEDERA_NETWORK: testnet
          HEDERA_OPERATOR_ID: ${{ secrets.HEDERA_OPERATOR_ID }}
          HEDERA_OPERATOR_KEY: ${{ secrets.HEDERA_OPERATOR_KEY }}
          USDC_TOKEN_ID: ${{ secrets.USDC_TOKEN_ID }}
          TAB_ACCOUNT_ID: ${{ secrets.TAB_ACCOUNT_ID }}
          TOPIC_RECEIPTS: ${{ secrets.TOPIC_RECEIPTS }}
          TOPIC_CEILINGS: ${{ secrets.TOPIC_CEILINGS }}
          TOPIC_SETTLEMENTS: ${{ secrets.TOPIC_SETTLEMENTS }}
```

---

## 4 · MCP, for a judge to drive it themselves

Not deployed — it runs on the reviewer's machine and talks to the hosted
gateway. Three lines in `claude_desktop_config.json`:

```jsonc
{
  "mcpServers": {
    "tab": {
      "command": "node",
      "args": ["--experimental-strip-types", "/abs/path/to/packages/mcp/src/stdio.ts"],
      "env": {
        "TAB_GATEWAY_URL": "https://<your-service>.onrender.com",
        "TAB_ACCOUNT_ID": "0.0.<your tab>"
      }
    }
  }
}
```

Then ask it *"why is my ceiling only 0.25?"* — see `packages/mcp/README.md`.

---

## Pre-flight

```bash
pnpm guard        # 5 guards: no Solidity, one Hedera SDK, boundaries, no float money, no secrets
pnpm test         # 380
pnpm -r typecheck
```

And the two that read the live chain rather than the code:

```bash
pnpm verify-tab       # public invariants, replayed from HCS
pnpm verify-ceiling   # every published ceiling AND weight, recomputed
```

`verify-ceiling` exits non-zero on `seq 1`, and that is expected and documented:
its hash matches and its ceiling value matches, but the `binding` label differs
because `computeCeiling` changed after publication without a version bump. No
credit decision was affected. It stays visible because catching exactly that is
what the tool is for.
