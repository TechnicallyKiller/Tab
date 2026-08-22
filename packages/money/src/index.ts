/**
 * @tab/money — every monetary amount in Tab.
 *
 * Zero dependencies, zero I/O, zero floating point. Everything else in the repo
 * rests on this package, so it must be auditable in one sitting.
 */
export {
  DECIMALS,
  ZERO,
  abs,
  add,
  atLeastZero,
  isNegative,
  isZero,
  max,
  micro,
  min,
  neg,
  sub,
  sum,
  usdc,
  type MicroUsdc,
} from './micro-usdc.ts'

export {
  BP_ONE,
  bp,
  bpFromRatio,
  formatBpDecimal,
  formatBpMultiple,
  formatBpPercent,
  mulBp,
  type BasisPoints,
  type Rounding,
} from './basis-points.ts'

export { format, toWire, type SignMode } from './format.ts'
