import { MODEL_ID, type ParameterSet, params, type Tier } from '@tab/params'

/**
 * The parameter table, derived from `@tab/params` — never retyped.
 *
 * This view existed as a hand-written mock, and the mock was wrong in the one
 * way that matters: it advertised `MODEL_VERSION = 'ceiling-v0.4.1'`, a string
 * that appears on no topic. Every published ceiling carries `tab-v2`, and
 * `verify-ceiling` resolves each message's own `model` field to decide which
 * frozen set to recompute against. A console showing a different identifier
 * sends a verifier looking for a parameter set that does not exist.
 *
 * So the rows are computed from the set in force. There is no second copy to
 * drift: bump `MODEL_VERSION`, add a `versions/v3.ts`, and this table moves
 * with it. `@tab/params` is pure — no I/O, no environment reads — which is why
 * a browser bundle may import it at all.
 *
 * What is NOT here: `SETTLE_MODE` and `MAX_SNAPSHOT_AGE_S`, which the mock
 * listed. Those are gateway environment, not model parameters, and the console
 * cannot read the gateway's environment. Showing invented values for them would
 * make this table exactly as trustworthy as the thing it replaces.
 */

export const MODEL_VERSION = MODEL_ID

export interface ConfigRow {
  key: string
  value: string
  /** Set when a value is deliberately not the mainnet-realistic one. */
  tuned?: string
}

export interface ConfigGroup {
  name: string
  /** Why these numbers exist, in one line. Shown under the group heading. */
  note: string
  rows: readonly ConfigRow[]
}

// A rate rendered for a human, not an amount. Basis points are the stored form
// and stay integers; nothing downstream reads this string.
// allow-float — display only, and the input is an integer bp.
const pct = (bp: number) => `${(bp / 100).toFixed(2)}%`
const mult = (bp: number) => `${bp / 10_000}x`
const TIERS: readonly Tier[] = ['A', 'B', 'C', 'Unrated']

/** `A 6.00% · B 8.50% · …` — one line rather than four rows, because the
 *  comparison between tiers IS the information. */
const byTier = (table: Partial<Record<Tier, number>>, fmt: (bp: number) => string) =>
  TIERS.map((t) => `${t} ${fmt(table[t] ?? 0)}`).join(' · ')

export function configGroups(set: ParameterSet = params): readonly ConfigGroup[] {
  return [
    {
      name: 'Credit',
      note: 'What an agent may owe, and what it pays to owe it.',
      rows: [
        { key: 'MODEL_ID', value: `tab-v${set.version}` },
        { key: 'APR_BP', value: byTier(set.aprBp, pct) },
        { key: 'TIER_MULTIPLE', value: byTier(set.tierMultipleBp, mult) },
        { key: 'STARTER_CEILING', value: set.caps.starterCeilingUsdc },
        {
          key: 'INTEREST_ROUNDING',
          value: `${set.interestRounding} (never in the agent's favour)`,
        },
      ],
    },
    {
      name: 'Ramp',
      note: 'Asymmetric on purpose: trust is slower to earn than to lose.',
      rows: [
        { key: 'RAMP_START', value: pct(set.ramp.startBp) },
        { key: 'RAMP_STEP_CLEAN', value: `+${pct(set.ramp.cleanStepBp)}` },
        { key: 'RAMP_STEP_MISSED', value: `−${pct(set.ramp.missedStepBp)}` },
        { key: 'RAMP_CLAMP', value: `${pct(set.ramp.minBp)} – ${pct(set.ramp.maxBp)}` },
        { key: 'RAMP_ROUNDING', value: `${set.ramp.rounding} (compounds)` },
      ],
    },
    {
      name: 'Independence',
      note: 'Earnings only count as credit if they came from someone the agent does not control.',
      rows: [
        { key: 'MAX_FUNDING_HOPS', value: String(set.fundingAncestryHops) },
        { key: 'CONCENTRATION_CAP', value: pct(set.caps.concentrationCapBp) },
        { key: 'UNATTESTED_DISCOUNT', value: pct(set.unattestedDiscountBp) },
        {
          key: 'AGE_FULL_DAYS',
          value: String(set.ageFullDays),
          tuned:
            'Tuned down for testnet. Every testnet account is days old, so a ' +
            'mainnet-realistic age factor rejects every agent — including the honest one.',
        },
      ],
    },
    {
      name: 'Independence discounts',
      note: 'Applied to a counterparty\u2019s weight. They MULTIPLY and truncate down.',
      rows: set.weights
        ? [
            { key: 'RECIPROCAL_FLOW', value: pct(set.weights.reciprocalBp) },
            { key: 'RECIPROCAL_THRESHOLD', value: pct(set.weights.reciprocalThresholdBp) },
            { key: 'SHARED_FUNDING_ROOT', value: pct(set.weights.sharedRootBp) },
            { key: 'YOUNG_ACCOUNT', value: pct(set.weights.youngBp) },
            { key: 'CONCENTRATED', value: pct(set.weights.concentratedBp) },
            {
              key: 'UNVERIFIED_FUNDING',
              value: pct(set.weights.unverifiedBp),
              tuned:
                'New in v3. A counterparty whose funding provenance was never observed and never ' +
                'published used to count in FULL, because absent ancestry read as absent ' +
                'relationship — the unsafe direction, and how the loop attacker went uncaught on ' +
                'its first full run. A discount rather than a block, because blocking would turn ' +
                'routine Mirror Node lag into a refusal for every counterparty at once. It is ' +
                'self-healing: once provenance is observed it is published, and a published fact ' +
                'is never forgotten.',
            },
          ]
        : [
            /*
             * v1 and v2 genuinely had no frozen weight policy — the steps lived
             * in the engine. Showing the numbers they happened to use would
             * claim a weight published under those versions is reproducible
             * from the frozen record, and it is not.
             */
            {
              key: 'WEIGHT_POLICY',
              value: 'not in this parameter set',
              tuned:
                'Before v3 the discount steps lived in apps/engine, outside the versioned set, so ' +
                'a weight published under this version is not reproducible from the frozen ' +
                'record. Absence is the accurate answer, not the numbers that happened to be used.',
            },
          ],
    },
    {
      name: 'Windows',
      note: 'How often the tab settles, and the most one call may cost.',
      rows: [
        { key: 'WINDOW_SECONDS', value: String(set.window.seconds) },
        { key: 'HOLD_TTL_SECONDS', value: String(set.window.holdTtlSeconds) },
        { key: 'PER_CALL_CAP', value: set.caps.perCallUsdc },
        { key: 'PER_WINDOW_CAP', value: set.caps.perWindowUsdc },
      ],
    },
  ]
}
