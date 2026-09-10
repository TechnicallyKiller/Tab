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

## 3 · Engine and settlement — scheduled, not hosted

Both are passes that exit, not daemons. **Three workflows are committed** and
need nothing but secrets:

| Workflow | Runs | Does |
|---|---|---|
| `.github/workflows/engine.yml` | every 2h + manual | recompute and publish the ceiling |
| `.github/workflows/settle.yml` | every 2h + manual | settle every closed window |
| `.github/workflows/reconcile.yml` | every 6h + manual | audit the money, **report only** |

Every one has `workflow_dispatch`, which is how you drive a demo — **Actions →
pick the workflow → Run workflow**.

### Why a 2-hour schedule settles 10-minute windows correctly

Both are **catch-up passes**, not heartbeats. `pnpm settle` settles *every*
closed unsettled window in one run, and the engine recomputes from the full
trailing history. So a late or skipped run costs freshness and nothing else —
which is what makes GitHub's best-effort cron acceptable here. It routinely runs
late under load; do not read the interval as a guarantee.

### Minutes — this repo is PRIVATE, and that is the constraint

Private repos on the Free plan get **2,000 Actions minutes a month**. Each run is
roughly 2 minutes with a warm pnpm cache:

| Cadence | Runs/month | Minutes |
|---|---|---|
| every 30 min | ~1,440 | ~2,900 ✗ **over** |
| every 2 hours | ~360 | ~720 ✓ |
| all three as committed | ~840 | ~1,700 ✓ fits, with headroom |

**Make the repo public and this becomes unlimited**, at which point you can
tighten the cron freely. Until then the committed schedule is deliberately
conservative.

### Two settings that MUST match Render

`DEMO_MODE` and `WINDOW_SECONDS` are read by the gateway *and* by these jobs. The
gateway files each receipt into a window computed from `WINDOW_SECONDS`; if the
settler disagrees, it settles windows the gateway never filed into and never
settles the ones it did. **The tab silently never settles, and nothing errors.**

The arithmetic is shared (`windowOf` in `@tab/params`) precisely so it cannot
drift — the *configuration* still can, and only you can keep the two places
equal. Set them as repository **variables** (not secrets) so they are visible:

```
Settings → Secrets and variables → Actions → Variables
  DEMO_MODE       true
  WINDOW_SECONDS  300
```

The workflows default to `true` / `300`, matching the demo `.env`.

### Secrets

```
Settings → Secrets and variables → Actions → Secrets
  HEDERA_OPERATOR_ID    HEDERA_OPERATOR_KEY
  FAUCET_ACCOUNT_ID     FAUCET_ACCOUNT_KEY
  USDC_TOKEN_ID         TAB_ACCOUNT_ID
  TOPIC_RECEIPTS        TOPIC_CEILINGS        TOPIC_SETTLEMENTS
```

**Say this out loud rather than by default:** this puts two private keys in
GitHub. They are **testnet** keys holding faucet funds, which is why it is
acceptable — and it would not be for anything else. If these ever become mainnet
keys, this arrangement has to change first.

### The reconciler never repairs on a schedule

`reconcile.yml` runs **report only**. The reconciler *can* write repair receipts
and must not do so unattended: its idempotence depends on matching a repair to
its debit by transaction id, and if that ever regressed, an unattended job would
re-report and re-reverse the same violation every run — turning a −0.04
discrepancy into +0.36 after ten runs. The command whose job is proving the books
would be the thing corrupting them.

A failing run emails you. That notification *is* the product here. Read what it
found, then run `pnpm reconcile --repair` yourself.

## 4 · The chat agent — how a reviewer tests it without cloning

`/app/chat` puts a language model behind Tab's verbs. A visitor types a
sentence, the model decides to spend, the gateway pays a real seller, and a
receipt lands on HCS. **No clone, no install, no wallet** — which is the honest
answer to "how would we test this".

Three environment variables on the console, server-side (NOT `NEXT_PUBLIC_*` —
the key must never reach the browser):

```
LLM_API_KEY       from any OpenAI-compatible provider
LLM_BASE_URL      https://api.groq.com/openai/v1   (default)
LLM_MODEL         llama-3.3-70b-versatile          (default)
TAB_GATEWAY_URL   https://<your-service>.onrender.com
TAB_ACCOUNT_ID    0.0.<your tab>
```

**Free providers that support tool calling**, all OpenAI-compatible, so moving
between them is one variable:

| Provider | `LLM_BASE_URL` | Note |
|---|---|---|
| Groq | `https://api.groq.com/openai/v1` | Fastest; ~30 req/min free |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai/` | Most reliable tool calling |
| Cerebras | `https://api.cerebras.ai/v1` | Fast |

Free tiers rate-limit. Being able to switch provider by changing one variable is
the difference between a demo that survives judging and one that does not — the
route reports a rate limit as a readable message rather than a stack trace.

**Letting strangers spend is safe, and the reason is the product.** Per-call cap
`0.050000`, ceiling `0.250000`, window cap `1.000000`. A visitor cannot take more
than the rail allows, and when they hit the wall they get a refusal — which is
the most interesting thing they could have triggered. It is faucet testnet USDC.

One platform note: a real spend waits 25–39s on x402 settlement, so the route
sets `maxDuration = 60`. On a host that caps function duration lower than that,
the read tools still work and a spend may time out.

## 5 · MCP, for a judge to drive it themselves

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
