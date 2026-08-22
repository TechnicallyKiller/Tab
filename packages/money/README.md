# @tab/money

**Tier 0 · zero runtime dependencies · zero I/O · no floating point**

Every monetary amount in Tab, and every rate applied to one.

## Why this is its own package

`verify-tab` claims the ledger reconciles to the cent. Tab also multiplies amounts by fractions
repeatedly — a 0.6 unattested-revenue weight, tier multiples, a ramp stepping ±15%/30%, interest
accrual per window. Many small numbers, repeated fractional multiplication, exact reconciliation
required: that is the exact shape of problem where doubles produce a ledger a few micro-USDC out
that nobody can explain at 2am.

Zero runtime dependencies means this package is auditable in one sitting, and everything else
rests on it. See [ADR-0006](../../docs/adr/0006-money-as-bigint.md).

## Contents

| File | Holds |
|---|---|
| `src/micro-usdc.ts` | the `MicroUsdc` branded type, parsing, arithmetic |
| `src/basis-points.ts` | integer-bp rates, `mulBp` with explicit rounding |
| `src/format.ts` | display and wire formatting — the only file allowed to touch decimals |
| `src/micro-usdc.test.ts` | 13 tests, `node --test` |

## The rules

- **No `number` ever holds an amount.** `MicroUsdc` is `bigint` branded, so a raw bigint — a
  timestamp, a sequence number, a hop count — cannot be passed where an amount belongs. This has
  already caught two real slips in `apps/web`.
- **Rates are integer basis points.** A 0.6 weight is `bp(6000)`. A 40% concentration cap is
  `bp(4000)`.

  This is not cosmetic. `share > 0.4` in floats can flip at *exactly* 40% depending on how the
  ratio was derived, because 0.4 is not representable. `shareBp > 4000` cannot. The concentration
  cap is a spend decision, so that difference is a refusal that should have fired and didn't.

- **`mulBp` requires a rounding direction.** `mulBp(amount, rate, 'down')`, never a default.
  Rounding is a decision; a default is an accident, and interest and the ramp both compound.
- **Display truncates, never rounds up.** The docs promise "truncated, not rounded", so the code
  means it: `0.999999` shows as `0.9999`, never `1.0000`.
- **Display uses U+2212 MINUS**, not a hyphen — same width as a digit in tabular figures, so
  signed columns stay aligned.
- **Wire form keeps all six decimals** (`toWire`). `JSON.stringify` cannot handle `bigint`, so
  amounts cross every boundary as decimal strings. This is also what makes the HCS ceiling input
  hash byte-stable.

## Consumers

`apps/web` imports it through `@/lib/money`, which re-exports this package and adds one
presentation-only helper. There is exactly one money implementation in the repo; a second would
drift, and a display layer that rounds differently from the ledger is how "reconciles to the
cent" stops being true on screen.

## Still to do

- `formatBpMultiple` is written but unused; the tier display in the landing playground uses it.
- No property-based tests yet. The invariants worth generating over: `mulBp` never leaves
  `[0, amount]` for `bp ≤ 10000`, `parse(format(x)) === x`, and summing is associative. The first
  and third have example-based coverage; the second needs `toWire` round-tripping.
- Interest accrual and ramp rounding directions must be pinned in `@tab/params` when that package
  is written, not chosen at each call site.

```bash
node --experimental-strip-types --test src/*.test.ts
```
