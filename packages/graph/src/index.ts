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
export { fundingAncestry, fundedWithin, sharedFundingRoot, type AncestryResult } from './ancestry.ts'
export { detectCluster, reciprocity, type ClusterFinding, type ClusterInputs, type ReciprocityFinding } from './clusters.ts'
export { concentration, type ConcentrationEntry, type ConcentrationResult } from './concentration.ts'
export { applyWeight, weightOf, type WeightInputs, type WeightPolicy } from './weights.ts'
export {
  WEIGHT_REASONS,
  WEIGHT_REASON_DETAIL,
  type AccountFacts,
  type AccountId,
  type TransferEdge,
  type Weight,
  type WeightReason,
} from './types.ts'
