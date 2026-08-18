# @tab/cli

**Deployable · `npx @tab/cli` · the operator surface**

Register an agent, inspect a tab, dump receipts, print the config in force, force a settlement in
demo mode.

## Commands

| Command | Does |
|---|---|
| `tab register` | register an agent, receive a Starter Tab |
| `tab status` | balance, ceiling, available, pending holds, window countdown |
| `tab ceiling` | current ceiling with every input broken out, tier, ramp, `MODEL_VERSION` |
| `tab receipts` | dump receipts from HCS, both legs, with request hashes |
| `tab counterparties` | per counterparty: weight, and why counted / discounted / rejected |
| `tab refusals` | every refused spend with the exact rule that fired |
| `tab config` | **the full parameter dump.** See below |
| `tab settle --force` | force a window close. **Demo mode only** |
| `tab verify` | shells out to `tools/verify` |

## `tab config` is a demo requirement, not a convenience

`AGE_FULL_DAYS` is tuned down for testnet, because on a testnet every account is young and a naive
age factor rejects everyone. The README's position is that hiding a tuning knob reads worse than
explaining it — a judge who spots an unexplained knob assumes worse.

So `tab config` prints every parameter in force with its `MODEL_VERSION`, and that output is shown
in the video. It exists so the tuning is stated rather than discovered.

## Contents

| Path | Holds |
|---|---|
| `src/commands/*.ts` | one file per command |
| `src/render/*.ts` | table and JSON output. Every command supports `--json` |
| `src/env.ts` | config resolution and validation |

## Invariants

- **Reads go through `@tab/sdk`.** The CLI is not a second implementation of the API.
- **`--force` is gated on demo mode** and says so loudly in its output. Forcing a settlement
  against real state is a money-moving action.
- **Every command supports `--json`.** The demo script and CI both consume this.
- **Never print a private key**, including inside a config dump. `tab config` prints parameters,
  not secrets.
