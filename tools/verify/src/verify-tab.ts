/**
 * verify-tab — replay HCS, assert the float invariant.
 *
 *   pnpm verify-tab
 *
 * THE TRUST ARTIFACT. This is what replaces a smart contract.
 *
 * The no-contract argument is: a smart contract would assert this invariant in
 * a test only we run, while HCS plus this tool lets a stranger assert it
 * themselves. That argument holds only because this file needs nothing from us
 * — no Postgres, no Redis, no gateway, no cooperation. `boundaries.json` bars
 * the imports that would quietly make it false.
 *
 * Exits non-zero on failure.
 */
import { LOCAL_ONLY_INVARIANTS, checkFloatInvariant, checkPublicLedger, position } from '@tab/ledger'
import { compareConsensus, configureGlobalHttp, MirrorClient, getBalanceSnapshot } from '@tab/mirror'
import { add, format, micro, usdc, type MicroUsdc } from '@tab/money'
import { caps } from '@tab/params'
import { mergeReplays, replayTopic } from './replay.ts'
import { TAB_GUIDANCE, claim, field, heading, verdict } from './report.ts'

configureGlobalHttp({ connectTimeoutMs: 60_000 })

function need(name: string): string {
  const value = process.env[name]
  if (!value || value.includes('xxxxx')) {
    throw new Error(
      `${name} is required.\n\n` +
        'verify-tab needs the public topic ids and the token id, and nothing else. ' +
        'A stranger runs it with a fresh clone, `pnpm install`, and those values.',
    )
  }
  return value
}

/*
 * Narrowed rather than cast.
 *
 * An unrecognised network name would otherwise reach MirrorClient and produce
 * requests against a nonexistent host, which surfaces as a timeout — an
 * unhelpful failure for a stranger whose only misstep was a typo.
 */
const NETWORKS = ['testnet', 'mainnet', 'previewnet'] as const
const requested = process.env['HEDERA_NETWORK'] ?? 'testnet'
const network = NETWORKS.find((n) => n === requested)
if (!network) {
  throw new Error(`HEDERA_NETWORK "${requested}" is not one of ${NETWORKS.join(', ')}`)
}
const tokenId = need('USDC_TOKEN_ID')
const receiptTopic = need('TOPIC_RECEIPTS')
const settlementTopic = need('TOPIC_SETTLEMENTS')
const hotFloat = need('HEDERA_OPERATOR_ID')

/*
 * The cold treasury is OPTIONAL, and its absence is reported rather than
 * assumed to be zero.
 *
 * ADR-0003 splits the float across two accounts. If only one is configured the
 * invariant is still checkable — it just spans one account, and saying so is
 * the difference between a narrower claim and a false one.
 */
const treasury = process.env['TREASURY_ACCOUNT_ID']?.includes('xxxxx')
  ? undefined
  : process.env['TREASURY_ACCOUNT_ID']

/*
 * What the float started with.
 *
 * THE ONE NUMBER A STRANGER CANNOT DERIVE, and worth being blunt about: it is
 * not on any topic. Every other input to this command comes from public data,
 * so a stranger can reproduce everything except this, and must be told it or
 * take it on trust.
 *
 * That is a real gap in the transparency claim rather than a configuration
 * inconvenience. The fix is to publish the float total at bootstrap — a
 * registration message on a topic, signed by the same operator — so the
 * starting balance is as auditable as everything built on top of it. Until
 * then, this command asserts the invariant when told the number and reports
 * the parts it can prove unaided when not.
 */
const floatTotalEnv = process.env['FLOAT_TOTAL_USDC']
const floatTotal = floatTotalEnv ? usdc(floatTotalEnv) : undefined

const mirror = new MirrorClient({ network, timeoutMs: 45_000, maxRetries: 4 })

console.log(heading('verify-tab', 'HCS receipts vs on-chain balances'))
console.log(field('network', network))
console.log(field('receipt topic', receiptTopic))
console.log(field('settlements', settlementTopic))
console.log(field('token', tokenId))
console.log(field('hot float', hotFloat))
console.log(field('treasury', treasury ?? 'not configured — the invariant spans one account'))

/* ── replay ──────────────────────────────────────────────────────────────── */

const receipts = await replayTopic(mirror, receiptTopic)
const settlements = await replayTopic(mirror, settlementTopic)
const byTab = mergeReplays(receipts, settlements)

console.log(
  field(
    'replayed',
    `${receipts.replayed} receipt(s) · ${settlements.replayed} settlement(s) · ${byTab.size} tab(s)`,
    receipts.skipped + settlements.skipped > 0
      ? `${receipts.skipped + settlements.skipped} undecodable, skipped`
      : '',
  ),
)

/* ── balances, and the timestamp they are as of ─────────────────────────── */

const hotSnapshot = await getBalanceSnapshot(mirror, hotFloat, tokenId)
const treasurySnapshot = treasury ? await getBalanceSnapshot(mirror, treasury, tokenId) : undefined

/*
 * Replay only up to the OLDER snapshot.
 *
 * Two accounts snapshotted at different moments cannot both be compared against
 * the same replay, so the earlier one bounds it. Using the later would count
 * receipts the earlier balance has not seen, and report a discrepancy on a
 * correct ledger.
 */
const asOf =
  treasurySnapshot && compareConsensus(treasurySnapshot.asOf, hotSnapshot.asOf) < 0
    ? treasurySnapshot.asOf
    : hotSnapshot.asOf

console.log()
console.log(field('hot float bal', format(hotSnapshot.balance), `as of ${hotSnapshot.asOf}`))
if (treasurySnapshot) {
  console.log(field('treasury bal', format(treasurySnapshot.balance), `as of ${treasurySnapshot.asOf}`))
}
console.log(field('replay bounded', `to ${asOf}`, 'the older snapshot — balances are not live reads'))
console.log(
  field('fee payer HBAR', `${(Number(hotSnapshot.tinybars) / 1e8).toFixed(4)} ℏ`, 'runway for fees'),
)

/* ── the checks ─────────────────────────────────────────────────────────── */

console.log(heading('checks'))

const results: { ok: boolean; text: string }[] = []
let outstandingTotal: MicroUsdc = micro(0n)

/*
 * When holds began being published, derived from the topic itself.
 *
 * A stranger can compute this the same way: the consensus timestamp of the
 * first `hold` message. That makes the exclusion below checkable rather than
 * something we assert — the difference between a bounded claim and a
 * convenient one.
 */
const firstHold = [...byTab.values()]
  .flat()
  .filter((e) => e.kind === 'hold')
  .map((e) => e.at)
  .sort()[0]

console.log(
  field(
    'holds published',
    firstHold ? `from ${firstHold}` : 'never — the hold rule cannot be checked',
    firstHold ? 'debits before this predate the rule' : '',
  ),
)

for (const [tab, all] of byTab) {
  // Bounded to the snapshot, in consensus order.
  const entries = all.filter((e) => compareConsensus(e.at, asOf) <= 0)
  const p = position(entries, caps.starterCeiling, asOf)
  outstandingTotal = add(outstandingTotal, p.outstanding)

  /*
   * The public invariant set, which now includes the hold checks.
   *
   * Kept as `checkPublicLedger` rather than `checkLedger` even though the two
   * currently agree: the distinction is what stops a future invariant that
   * needs private state from silently becoming a guaranteed FAIL here. That is
   * how the hold checks got in — they were asserted against a replay that could
   * not contain holds, and every tab failed on a correct ledger.
   */
  const ledger = checkPublicLedger(entries, caps.starterCeiling, asOf, {
    ...(firstHold ? { holdsPublishedFrom: firstHold } : {}),
  })

  results.push({
    ok: ledger.ok,
    text: claim(
      ledger.ok,
      `tab ${tab}: ${entries.length} entr(ies) fold to balance ${format(p.balance)}, outstanding ${format(p.outstanding)}`,
      [
        ...(ledger.ok ? [`checked: ${ledger.checked.join(', ')}`] : []),
        ...ledger.violations.map((v) => `${v.invariant}: ${v.detail}`),
        // Reported whether it passed or failed. An exclusion nobody mentions is
        // indistinguishable from a check nobody ran.
        ...(ledger.predatingHolds > 0
          ? [
              `${ledger.predatingHolds} debit(s) predate the first published hold and are`,
              'outside the hold rule — their holds were real but never published.',
            ]
          : []),
      ],
    ),
  })
}

if (byTab.size === 0) {
  results.push({
    ok: true,
    text: claim(true, 'no receipts on the topic — nothing to contradict, and nothing proven either'),
  })
}

for (const r of results) console.log(r.text)

/*
 * Say what this command cannot check — and say when that list is EMPTY.
 *
 * It used to name `debit_has_hold` and `commit_amount_matches_hold`, because
 * holds were never published and an HCS replay showed debits appearing from
 * nowhere. Holds are on the topic now, so the write-ahead ordering is
 * externally checkable and the list is empty.
 *
 * The line still prints. "Nothing was skipped" is a claim a stranger needs to
 * hear made explicitly — silence there is indistinguishable from a verifier
 * that forgot to mention what it left out.
 */
console.log()
console.log(
  LOCAL_ONLY_INVARIANTS.length === 0
    ? claim(true, 'every invariant in the set was checked — nothing skipped', [
        'Holds are published to the receipt topic, so `reserve → pay → commit`',
        'is verifiable from the public record. A debit that references a hold',
        'nobody published, or one whose amount exceeds what was reserved, fails',
        'above rather than being quietly excused.',
      ])
    : claim(true, `not checkable from the public record: ${LOCAL_ONLY_INVARIANTS.join(', ')}`, [
        'These need state that never reaches a topic. The gateway asserts them',
        'against its own memory; nobody outside can, and this does not pretend to.',
      ]),
)

/* ── the float invariant ────────────────────────────────────────────────── */

const held = add(hotSnapshot.balance, treasurySnapshot?.balance ?? micro(0n))

if (floatTotal === undefined) {
  console.log()
  console.log(
    claim(
      true,
      `float held on chain is ${format(held)}, outstanding across all tabs is ${format(outstandingTotal)}`,
      [
        'The full invariant (treasury + hot float == float total + outstanding) needs',
        'FLOAT_TOTAL_USDC — what the float STARTED with, which is not published on any',
        'topic. That is a real gap in the transparency claim, not a config detail:',
        'a stranger can derive every other number here from public data. Set it to',
        'assert the invariant, or publish it at bootstrap so nobody has to be told.',
      ],
    ),
  )
} else {
  const violations = checkFloatInvariant({
    treasury: treasurySnapshot?.balance ?? micro(0n),
    hotFloat: hotSnapshot.balance,
    floatTotal,
    outstandingTotal,
    balanceAsOf: asOf,
  })
  const ok = violations.length === 0
  console.log()
  console.log(
    claim(
      ok,
      `treasury + hot float == float total + outstanding  (${format(held)} vs ${format(add(floatTotal, outstandingTotal))})`,
      ok ? [`float total ${format(floatTotal)} · outstanding ${format(outstandingTotal)}`] : violations.map((v) => v.detail),
    ),
  )
  results.push({ ok, text: '' })
}

const failed = results.find((r) => !r.ok)
console.log(verdict(!failed, results.length, failed?.text.trim().split('\n')[0], TAB_GUIDANCE))
process.exit(failed ? 1 : 0)
