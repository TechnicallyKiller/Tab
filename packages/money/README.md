# @tab/money

**Tier 0 · zero dependencies · zero I/O · no floating point**

Every monetary amount in Tab. USDC on Hedera has 6 decimals, so an amount is a `bigint` count
of micro-USDC carried in a branded type.

## Why this is its own package

`verify-tab` claims the ledger reconciles to the cent. Tab also multiplies amounts by fractions
repeatedly — a 0.6 unattested-revenue weight, tier multiples, a ramp factor stepping ±15%/30%,
interest accrual per window. Many small numbers, repeated fractional multiplication, exact
reconciliation required: that is the exact shape of problem where doubles produce a ledger that
is off by a few micro-USDC and cannot be explained at 2am.

Zero dependencies means this package is auditable in one sitting, and everything else rests on it.

See [ADR-0006](../../docs/adr/0006-money-as-bigint.md).

## Contents

| File | Holds |
|---|---|
| `src/micro-usdc.ts` | the `MicroUsdc` branded type, constructors, arithmetic |
| `src/basis-points.ts` | integer-bp rates and multiplication with explicit rounding |
| `src/format.ts` | display and wire-string formatting. The only file allowed to touch decimals |
| `src/parse.ts` | parse from a decimal string or an on-wire integer string |

## Invariants

- **No `number` ever holds an amount.** Not in a type, not in transit, not "just for logging".
- **Rates are integer basis points.** A 0.6 weight is `6000n`. A 6% APR is `600n`.
- **Multiplication states its rounding direction at the call site.** `mulBp(amount, bp, 'down')`,
  never a default. Rounding is a decision; a default is an accident waiting to compound.
- **Serialization is a decimal string.** `JSON.stringify` cannot handle `bigint`, so
  `@tab/protocol` and every API boundary carry amounts as strings. This is also what makes the
  HCS ceiling-input hash byte-stable.
- **Rounding direction for interest and ramp is pinned in `@tab/params`, not chosen here.**
  Both compound, so two call sites rounding differently diverge.

## Definition of done

Property tests, not just examples. Specifically: `mulBp` never produces a value outside
`[0, amount]` for `bp <= 10000`; `parse(format(x)) === x` for all `x`; summing a list of debits
and credits is associative regardless of order. The netting function is the one that has to be
right, so test it against a hand-computed fixture with an odd number of micro-USDC.

`pnpm guard:money` must pass — it greps the money packages for `parseFloat`, `toFixed` and
`* 1e6` / `/ 1e6`.
