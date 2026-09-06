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

for (const [tab, all] of byTab) {
  // Bounded to the snapshot, in consensus order.
  const entries = all.filter((e) => compareConsensus(e.at, asOf) <= 0)
  const p = position(entries, caps.starterCeiling, asOf)
  outstandingTotal = add(outstandingTotal, p.outstanding)

  /*
   * PUBLIC invariants only.
   *
   * `checkLedger` also asserts `debit_has_hold`, which cannot hold here:
   * `@tab/protocol` has no hold message, so holds never reach a topic and a
   * replay has debits with no holds. Running it printed FAIL for all three
   * tabs on a correct ledger — and a stranger would read that as fraud, which
   * is the worst possible failure mode for the trust artifact.
   */
  const ledger = checkPublicLedger(entries, caps.starterCeiling, asOf)

  results.push({
    ok: ledger.ok,
    text: claim(
      ledger.ok,
      `tab ${tab}: ${entries.length} entr(ies) fold to balance ${format(p.balance)}, outstanding ${format(p.outstanding)}`,
      ledger.ok
        ? [`checked: ${ledger.checked.join(', ')}`]
        : ledger.violations.map((v) => `${v.invariant}: ${v.detail}`),
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
 * Say what this command CANNOT check, and why.
 *
 * A verifier that quietly checks less than it appears to is worse than one
 * that checks less and admits it — the tool's whole value is that a stranger
 * can trust its statements about its own scope.
 */
console.log()
console.log(
  claim(true, `not checkable from the public record: ${LOCAL_ONLY_INVARIANTS.join(', ')}`, [
    'Holds are not published to any topic, so a replay cannot show that a',
    'reserve preceded a payment. The gateway asserts these against its own',
    'hold table; nobody outside can, and this command does not pretend to.',
    'Publishing holds would make the write-ahead ordering auditable too, at',
    'the cost of an HCS message per ATTEMPTED spend on the latency path.',
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
