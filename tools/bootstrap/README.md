# @tab/bootstrap

**Runs once per environment, after the probes are green.**

Creates everything Tab needs on Hedera testnet and prints the values for `.env`.

## Steps

1. **Create three HCS topics** — receipts, ceilings, settlements. Print the ids.
2. **Create the two float accounts.** Cold Treasury with a threshold `KeyList`; Hot Float with a
   single key. See [ADR-0003](../../docs/adr/0003-two-account-float.md).
3. **Associate both with USDC** (`0.0.429274`). This fails silently if skipped and has no
   equivalent on other chains — Probe 3 exists for it.
4. **Fund Hot Float** from Treasury up to its cap. Fund it with **HBAR** too: we are the fee payer
   on the earn leg because we self-facilitate.
5. **Register the demo sellers** on the Starter Tab allowlist.
6. **Print the config dump** — every parameter with its `MODEL_VERSION`, so the environment is
   documented at creation.

## Invariants

- **Idempotent.** Re-running must not create a second set of topics. Detect existing state and
  report it. Someone will run this twice.
- **Prints, never writes, `.env`.** Silently editing a developer's env file is worse than making
  them paste four values.
- **Never prints a private key.** Not even in the config dump.
- **Verifies each step before continuing.** A topic created but not readable, or an association
  that did not take, must fail loudly here rather than at demo time.
- **Emits a machine-readable summary** (`--json`) so CI can bootstrap a throwaway environment.
