/**
 * @tab/scoring — effective revenue → tier → ceiling.
 *
 * Tier 1. Pure functions over inputs the caller gathers. No I/O, no clock, no
 * randomness.
 *
 * Purity is a PRODUCT requirement here, not a preference. `verify-ceiling`
 * claims a stranger can recompute a published ceiling and check the hash, and a
 * stranger has HCS, the public Mirror Node and this repo — not our Postgres.
 * If this package could read the database, that claim would quietly become
 * false and nobody would find out until someone tried it. `boundaries.json`
 * bars `scoring` from `db`, `cache`, `mirror` and `hedera` for exactly that
 * reason.
 *
 * The contract is `CeilingInputs`: if a number is not in that type, it may not
 * affect the output.
 */
export { effectiveRevenue, type EffectiveRevenue, type WindowRevenue } from './effective-revenue.ts'
export { tierOf, type TierInputs, type TierResult } from './tier.ts'
export { computeCeiling, mayApplyMidWindow } from './ceiling.ts'
export { type Binding, type CeilingInputs, type CeilingResult } from './inputs.ts'
