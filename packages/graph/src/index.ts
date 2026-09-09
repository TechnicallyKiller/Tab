/**
 * @tab/graph — the independence engine.
 *
 * Tier 1. Pure functions over edge lists the caller supplies. No I/O, and
 * `boundaries.json` bars this package from `mirror`, `db` and `hedera` so it
 * stays that way: `tools/verify` must reproduce an independence decision from
 * public Mirror Node data alone, and a package that could fetch privately would
 * make that claim quietly false.
 *
 * ## The gap, stated rather than hidden
 *
 * A **non-reciprocal collusion ring** defeats this engine. If value never flows
 * back and the funding roots are genuinely separate, nothing here fires: the
 * accounts look independent because on-chain they ARE independent, and the
 * relationship exists somewhere this data cannot see. It stays listed OPEN in
 * the attack catalogue.
 *
 * The honest claim is that attestation plus independence raises the COST of
 * faking revenue — an attacker must fund seller accounts from unrelated roots,
 * age them, and never cycle value back. It does not reduce that cost to zero,
 * and any implementation that implies otherwise is overselling.
 */
export {
  type AncestryResult,
  fundedWithin,
  fundingAncestry,
  fundingRoot,
  isSystemAccount,
  sharedFundingRoot,
} from './ancestry.ts'
export {
  type ClusterFinding,
  type ClusterInputs,
  detectCluster,
  type ReciprocityFinding,
  reciprocity,
} from './clusters.ts'
export {
  type ConcentrationEntry,
  type ConcentrationResult,
  concentration,
} from './concentration.ts'
export {
  type AccountFacts,
  type AccountId,
  type TransferEdge,
  WEIGHT_REASON_DETAIL,
  WEIGHT_REASONS,
  type Weight,
  type WeightReason,
} from './types.ts'
export { applyWeight, type WeightInputs, type WeightPolicy, weightOf } from './weights.ts'
