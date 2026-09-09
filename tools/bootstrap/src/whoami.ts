/**
 * What can this operator actually spend, and is the configured token the right
 * one? Answers both in one command.
 *
 *   pnpm chain:status
 *
 * NOT `pnpm whoami`, which this file claimed for its whole life. pnpm has a
 * builtin of that name and shadows any script, so the documented command failed
 * with `401 Unauthorized` from the npm registry — a message that reads as an
 * auth problem rather than a naming clash. There is no root `whoami` script
 * either; `chain:status` has always been the one that runs this.
 */
import { clientFromEnv } from '@tab/hedera'
import {
  canReceiveToken,
  decimalsOf,
  getAccount,
  getToken,
  MirrorClient,
  type TokenRelationship,
} from '@tab/mirror'
import { format, micro } from '@tab/money'

const REAL_USDC = '0.0.429274'
const configured = process.env['USDC_TOKEN_ID'] ?? '(unset)'

const tab = clientFromEnv()
// Operational scripts are not latency-critical; be patient with a slow mirror.
const mirror = new MirrorClient({ network: tab.network, timeoutMs: 30_000, maxRetries: 4 })
const operator = tab.operatorId.toString()

const account = await getAccount(mirror, operator)
/*
 * `TokenRelationship` from the package, NOT a local copy of the shape.
 *
 * This declared its own inline `{ token_id, balance, decimals: number }`, which
 * typechecked fine and carried a real bug: Mirror Node returns `decimals` as a
 * STRING from some endpoints, so a perfectly good 6-decimal token printed
 * `!! 6 decimals — MicroUsdc assumes 6` and fell into the wrong branch. The
 * private copy is what let it dodge the fix in the shared type.
 */
const raw = await mirror.get<{ tokens?: TokenRelationship[] }>(
  `/api/v1/accounts/${operator}/tokens?limit=50`,
)
const held = raw.tokens ?? []

console.log(`\nOperator ${operator} · Hedera ${tab.network}`)
console.log(`  created             ${account.created_timestamp}`)
console.log(`  auto-assoc slots    ${account.max_automatic_token_associations}`)
console.log(
  `  USDC_TOKEN_ID       ${configured}${configured === REAL_USDC ? '  (real USDC)' : '  (NOT real USDC)'}`,
)

console.log('\n  Token holdings')
if (held.length === 0) {
  console.log('    (none)')
}
for (const t of held) {
  // Coerced once. `10 ** "6"` happens to work in JS and `"6" === 6` does not,
  // so the raw field is right for display and wrong for every comparison.
  const dp = decimalsOf(t.decimals)
  const amount = dp === 6 ? format(micro(BigInt(t.balance))) : String(t.balance / 10 ** dp)
  const tags = [
    t.token_id === REAL_USDC ? 'REAL USDC' : null,
    t.token_id === configured ? 'CONFIGURED' : null,
    dp !== 6 ? `!! ${dp} decimals — MicroUsdc assumes 6` : null,
  ].filter(Boolean)
  console.log(`    ${t.token_id.padEnd(14)} ${amount.padStart(14)}  ${tags.join(' · ')}`)
}

// Is real USDC reachable, even at zero balance?
const usdcToken = await getToken(mirror, REAL_USDC)
const usdcRecv = await canReceiveToken(mirror, operator, REAL_USDC)
const holdsUsdc = held.some((t) => t.token_id === REAL_USDC && t.balance > 0)

console.log(`\n  Real USDC (${REAL_USDC})`)
console.log(
  `    token             ${usdcToken.symbol} "${usdcToken.name}" · ${usdcToken.decimals} dp`,
)
console.log(`    balance           ${holdsUsdc ? 'present' : 'ZERO'}`)
console.log(`    can receive       ${usdcRecv.canReceive}`)

console.log('\n  Verdict')
if (holdsUsdc && configured === REAL_USDC) {
  console.log('    Configured for real USDC and holding it. Nothing to do.')
} else if (holdsUsdc) {
  console.log('    You hold real USDC but are configured for a different token.')
  console.log(`    Swap:  USDC_TOKEN_ID=${REAL_USDC}`)
} else if (configured === REAL_USDC) {
  console.log('    Configured for real USDC but holding NONE — every transfer will fail.')
  console.log(`    Either fund ${operator} from https://faucet.circle.com,`)
  console.log('    or swap back to the stand-in until it lands.')
} else {
  console.log('    Running on the stand-in token. Functionally identical: 6 decimals,')
  console.log('    fungible, transfers and associates the same way.')
  console.log(`    To move to real USDC: fund ${operator}, then set USDC_TOKEN_ID=${REAL_USDC}`)
}
console.log()

tab.close()
