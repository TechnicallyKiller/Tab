/**
 * Create a customer that is INDIRECTLY related to the tab, not directly.
 *
 *   pnpm demo:payer
 *
 * ## Why this script has to exist, stated plainly
 *
 * On testnet, every account we can create descends from our own faucet
 * account. So `COMMON_FUNDER` — "the same account funded both the tab and this
 * counterparty" — fires on *every* payer we make, including the honest one.
 * That is the rule working correctly, and it means we cannot manufacture a
 * genuinely independent customer. Only a second portal/faucet account, whose
 * key we do not hold, would be truly independent.
 *
 * What we CAN build is the distinction the graph actually draws:
 *
 *     operator ──funds──▶ tab                    (immediate funder: operator)
 *     operator ──funds──▶ intermediary ──funds──▶ payer   (immediate: intermediary)
 *
 * The payer's immediate funder differs from the tab's, so `COMMON_FUNDER` does
 * not fire. `sharedFundingRoot` still finds the operator within the hop limit,
 * so the payer is **discounted, not blocked** — while the attacker's shill,
 * funded by the operator directly, is **blocked outright**.
 *
 * ## What this demonstrates, and what it does not
 *
 * It demonstrates that the graph separates DIRECT control from INDIRECT
 * relation, and prices them differently. It does **not** demonstrate detection
 * of a genuinely unrelated customer versus a related one, because on this
 * network we cannot produce the former. Saying so is the difference between a
 * demo and a trick — and the honest version is still the interesting one,
 * because "blocked" versus "discounted" is a decision an operator has to defend
 * either way.
 */

import { appendFile } from 'node:fs/promises'
import { clientFromEnv, createAccount, createClient, transferToken } from '@tab/hedera'
import { configureGlobalHttp, getUsdcBalance, MirrorClient, waitForAccount } from '@tab/mirror'
import { format, usdc } from '@tab/money'

configureGlobalHttp({ connectTimeoutMs: 60_000 })

const tokenId = process.env['USDC_TOKEN_ID']
if (!tokenId) throw new Error('USDC_TOKEN_ID missing from .env')

/** Enough for several calls at the demo's raised per-call price. */
const funding = usdc(process.argv[2] ?? '4.000000')

/*
 * An optional suffix, so a SECOND and THIRD customer can exist.
 *
 *   pnpm demo:payer 4.000000      -> DEMO_PAYER_ACCOUNT_ID
 *   pnpm demo:payer 4.000000 2    -> DEMO_PAYER2_ACCOUNT_ID
 *
 * Without it, running this twice appended a duplicate DEMO_PAYER_ACCOUNT_ID to
 * .env, and every reader takes the first match — so the second customer would
 * be created on chain, written to the file, and then silently ignored.
 *
 * More than one customer is not cosmetic. A sole counterparty is CONCENTRATED,
 * which multiplies its weight by 0.80 on top of every other discount; spread
 * the same revenue across three and no one of them holds more than the 40%
 * share cap, so that multiplier stops applying.
 */
const suffix = process.argv[3] ?? ''
if (suffix && !/^\d+$/.test(suffix)) {
  throw new Error(`The customer index must be a number, received ${JSON.stringify(suffix)}`)
}

const operator = clientFromEnv()
const mirror = new MirrorClient({ network: operator.network, timeoutMs: 45_000, maxRetries: 4 })

console.log(`\nCreating an indirectly-related customer — Hedera ${operator.network}\n`)
console.log(`  operator        ${operator.operatorId.toString()}   (also funded the tab)`)

/* ── 1. the intermediary ─────────────────────────────────────────────────── */

const intermediary = await createAccount(operator.client, {
  initialHbar: 6,
  maxAutomaticTokenAssociations: -1,
})
process.stdout.write('  waiting index   ')
await waitForAccount(mirror, intermediary.accountId)
console.log('indexed')
console.log(`  intermediary    ${intermediary.accountId}   (funded by the operator)`)

// It needs HBAR to pay for the account it creates, and tokens to pass on.
await transferToken(operator.client, {
  tokenId,
  from: operator.operatorId.toString(),
  to: intermediary.accountId,
  amount: funding,
  idempotencyKey: `demo-payer:seed:${intermediary.accountId}`,
})
console.log(`  seeded          ${format(funding)} to the intermediary`)

/* ── 2. the payer, created BY the intermediary ───────────────────────────── */

/*
 * A separate client, operating as the intermediary.
 *
 * This is what makes the funding edge point where the demo needs it: `funderOf`
 * reads the creating transaction's PAYER, so the account must be created by the
 * intermediary rather than merely funded by it afterwards. Creating it as the
 * operator and then transferring tokens would leave the operator as the
 * immediate funder and the payer would be blocked like the shill.
 */
const asIntermediary = createClient({
  network: operator.network,
  accountId: intermediary.accountId,
  privateKey: intermediary.privateKey.toStringDer(),
})

const payer = await createAccount(asIntermediary.client, {
  initialHbar: 3,
  maxAutomaticTokenAssociations: -1,
})
process.stdout.write('  waiting index   ')
await waitForAccount(mirror, payer.accountId)
console.log('indexed')
console.log(`  customer        ${payer.accountId}   (created and funded by the intermediary)`)

await transferToken(asIntermediary.client, {
  tokenId,
  from: intermediary.accountId,
  to: payer.accountId,
  amount: funding,
  idempotencyKey: `demo-payer:fund:${payer.accountId}`,
})

process.stdout.write('  confirming      ')
let balance = usdc('0.000000')
for (let i = 0; i < 14; i++) {
  await new Promise((r) => setTimeout(r, 2500))
  process.stdout.write('.')
  balance = await getUsdcBalance(mirror, payer.accountId, tokenId)
  if (balance > 0n) break
}
console.log(`\n  balance         ${format(balance)}`)

/*
 * The key goes straight into `.env`, and is NEVER printed.
 *
 * `pnpm payer:create` prints its key and this script deliberately does not,
 * because I argued the other way in `tab-create.ts` and the argument holds: a
 * private key in terminal scrollback is a private key in the screen recording,
 * and these scripts run during a demo. `.env` is gitignored and
 * `pnpm guard:secrets` fails the build if it ever becomes tracked, so the file
 * is the right destination. Existing scripts that print keys should follow.
 */
const envPath = new URL('../../../.env', import.meta.url)
const line =
  `\n# Indirectly-related demo customer, created by pnpm demo:payer.\n` +
  `# Funded by ${intermediary.accountId}, NOT by the operator — so the graph\n` +
  `# discounts it rather than blocking it. See tools/bootstrap/src/demo-payer.ts.\n` +
  `DEMO_PAYER${suffix}_ACCOUNT_ID=${payer.accountId}\n` +
  `DEMO_PAYER${suffix}_ACCOUNT_KEY=${payer.privateKey.toStringDer()}\n`
await appendFile(envPath, line, 'utf8')

console.log(`
  The funding chain is now:

    operator ──▶ tab
    operator ──▶ ${intermediary.accountId} ──▶ ${payer.accountId}

  @tab/graph will see a DIFFERENT immediate funder for this customer than for
  the tab, so COMMON_FUNDER does not fire. sharedFundingRoot still finds the
  operator within the hop limit, so it is DISCOUNTED rather than blocked —
  while the attacker's shill, funded by the operator directly, goes to ZERO.

  Written to .env (gitignored, never printed):

    DEMO_PAYER_ACCOUNT_ID=${payer.accountId}
    DEMO_PAYER_ACCOUNT_KEY=<written, not shown>

  HashScan: https://hashscan.io/${operator.network}/account/${payer.accountId}
`)

operator.close()
asIntermediary.close()
process.exit(0)
