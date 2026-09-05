/**
 * What can this operator actually spend, and is the configured token the right
 * one? Answers both in one command.
 *
 *   pnpm whoami
 */
import { clientFromEnv } from '@tab/hedera'
import { MirrorClient, canReceiveToken, getAccount, getToken } from '@tab/mirror'
import { format, micro } from '@tab/money'

const REAL_USDC = '0.0.429274'
const configured = process.env['USDC_TOKEN_ID'] ?? '(unset)'

const tab = clientFromEnv()
// Operational scripts are not latency-critical; be patient with a slow mirror.
const mirror = new MirrorClient({ network: tab.network, timeoutMs: 30_000, maxRetries: 4 })
const operator = tab.operatorId.toString()

const account = await getAccount(mirror, operator)
const raw = await mirror.get<{
  tokens?: { token_id: string; balance: number; decimals: number }[]
}>(`/api/v1/accounts/${operator}/tokens?limit=50`)
const held = raw.tokens ?? []

console.log(`\nOperator ${operator} · Hedera ${tab.network}`)
console.log(`  created             ${account.created_timestamp}`)
console.log(`  auto-assoc slots    ${account.max_automatic_token_associations}`)
console.log(`  USDC_TOKEN_ID       ${configured}${configured === REAL_USDC ? '  (real USDC)' : '  (NOT real USDC)'}`)

console.log('\n  Token holdings')
if (held.length === 0) {
  console.log('    (none)')
}
for (const t of held) {
  const amount = t.decimals === 6 ? format(micro(BigInt(t.balance))) : String(t.balance / 10 ** t.decimals)
  const tags = [
    t.token_id === REAL_USDC ? 'REAL USDC' : null,
    t.token_id === configured ? 'CONFIGURED' : null,
    t.decimals !== 6 ? `!! ${t.decimals} decimals — MicroUsdc assumes 6` : null,
  ].filter(Boolean)
  console.log(`    ${t.token_id.padEnd(14)} ${amount.padStart(14)}  ${tags.join(' · ')}`)
}

// Is real USDC reachable, even at zero balance?
const usdcToken = await getToken(mirror, REAL_USDC)
const usdcRecv = await canReceiveToken(mirror, operator, REAL_USDC)
const holdsUsdc = held.some((t) => t.token_id === REAL_USDC && t.balance > 0)

console.log(`\n  Real USDC (${REAL_USDC})`)
console.log(`    token             ${usdcToken.symbol} "${usdcToken.name}" · ${usdcToken.decimals} dp`)
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
