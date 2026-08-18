# @tab/params

**Tier 0 · versioned constants · no I/O**

Every tunable number in the credit product, behind a pinned `MODEL_VERSION`.

Tier multiples, base APRs, ramp steps and clamps, per-call and per-window caps, the 40%
concentration cap, the 0.6 unattested discount, `AGE_FULL_DAYS`, hop limits for funding
ancestry, starter tab parameters, window length, hold TTL, and the rounding direction for
interest and ramp.

## Why this is a package and not a config file

`verify-ceiling` recomputes a published ceiling and compares the hash. That only means something
if the recomputation uses **byte-identical parameters** to the ones in force when the ceiling was
published. So parameters must be versioned, importable, and published to HCS alongside every
ceiling — not read from an environment variable that has since changed.

Every ceiling message carries the `MODEL_VERSION` it was computed under. Changing any number here
is a version bump, and old versions stay in the package so historical ceilings remain verifiable.

## Contents

| File | Holds |
|---|---|
| `src/versions/v1.ts` | the v1 parameter set, frozen |
| `src/index.ts` | `MODEL_VERSION`, the current set, and a lookup by version |
| `src/schema.ts` | zod schema for a parameter set, so a new version cannot omit a field |

## Invariants

- **Parameter sets are frozen once published.** Add `v2`, never edit `v1`. A ceiling published
  under v1 must remain recomputable forever.
- **No parameter is read from the environment.** The only exception is the demo-mode window
  length, and that is a documented override that appears in the config dump.
- **`AGE_FULL_DAYS` is tuned down for testnet and that is stated out loud.** On a testnet every
  account is young, so a naive age factor rejects everyone. The tuned value goes in the config
  dump and is named in the demo video. The README is right that hiding a tuning knob reads worse
  than explaining it.
- **Rounding direction for interest accrual and the ramp factor is pinned here.** Both compound.
  Two call sites rounding differently will diverge, and the divergence will be small enough to
  survive review and large enough to break `verify-tab`.

## Definition of done

A snapshot test that fails if any v1 number changes — that is the whole point of the package.
Plus a config-dump function the CLI can print, since the demo depends on being able to show
every parameter in force.
