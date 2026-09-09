/**
 * @tab/money — every monetary amount in Tab.
 *
 * Zero dependencies, zero I/O, zero floating point. Everything else in the repo
 * rests on this package, so it must be auditable in one sitting.
 */

export {
  type BasisPoints,
  BP_ONE,
  bp,
  bpFromRatio,
  formatBpDecimal,
  formatBpMultiple,
  formatBpPercent,
  mulBp,
  type Rounding,
} from './basis-points.ts'
export { format, type SignMode, toWire } from './format.ts'
export {
  abs,
  add,
  atLeastZero,
  DECIMALS,
  isNegative,
  isZero,
  type MicroUsdc,
  max,
  micro,
  min,
  neg,
  sub,
  sum,
  usdc,
  ZERO,
} from './micro-usdc.ts'
