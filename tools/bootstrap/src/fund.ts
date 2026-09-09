/**
 * Fund an account with the configured settlement token.
 *
 *   pnpm fund <accountId> [amount]
 *
 * Exists because switching `USDC_TOKEN_ID` re-opens a provisioning question:
 * every account that PAYS needs a balance in the new token. Accounts that only
 * receive need nothing, provided they were created with unlimited
 * auto-association — which `tab:create`, `payer:create` and `demo:payer` all
 * do, precisely so a token switch does not require touching them.
 *
 * Reads the token from `USDC_TOKEN_ID` rather than taking it as an argument, so
 * this cannot fund the wrong token while the rest of the system is configured
 * for another. That is the mistake worth designing out: a payer holding TUSD
 * while the gateway prices in USDC fails with an unhelpful x402 error rather
 * than an obvious balance problem.
 */
import { clientFromEnv, transferToken } from '@tab/hedera'
import { configureGlobalHttp, getToken, getUsdcBalance, MirrorClient } from '@tab/mirror'
import { format, usdc } from '@tab/money'

configureGlobalHttp({ connectTimeoutMs: 60_000 })

const tokenId = process.env['USDC_TOKEN_ID']
if (!tokenId || tokenId.includes('xxxxx')) throw new Error('USDC_TOKEN_ID missing from .env')

const target = process.argv[2]
if (!target || !/^\d+\.\d+\.\d+$/.test(target)) {
  throw new Error('Usage: pnpm fund <accountId> [amount]   e.g. pnpm fund 0.0.10393567 4.000000')
}
const amount = usdc(process.argv[3] ?? '4.000000')

const client = clientFromEnv()
const mirror = new MirrorClient({ network: client.network, timeoutMs: 45_000, maxRetries: 4 })

const info = await getToken(mirror, tokenId)
console.log(`\nFunding with ${info.symbol} (${tokenId}) — Hedera ${client.network}\n`)

/*
 * Six decimals is a hard requirement, not a preference.
 *
 * `MicroUsdc` is a bigint of micro-units, so a token with different decimals
 * would be silently misread by a factor of ten per decimal. Checked here
 * because this is the script that introduces a new token to the system.
 */
/*
 * `Number(...)` because Mirror Node genuinely differs between endpoints.
 *
 * `/tokens/{id}` returns decimals as the STRING `'6'`; `/accounts/{id}/tokens`
 * returns the number `6`. `@tab/mirror` declares the union honestly
 * (`string | number`) rather than picking one and being wrong half the time —
 * and the first version of this check compared it with `!== 6`, producing the
 * memorable error "USDC has 6 decimals, not 6". The union is doing its job;
 * the caller has to normalise.
 */
const decimals = Number(info.decimals)
if (decimals !== 6) {
  throw new Error(
    `${info.symbol} has ${decimals} decimals, not 6. MicroUsdc would misread every amount ` +
      `by a factor of 10^${Math.abs(6 - decimals)}.`,
  )
}

const before = await getUsdcBalance(mirror, client.operatorId.toString(), tokenId)
console.log(`  float           ${client.operatorId.toString()}  holds ${format(before)}`)
if (before < amount) {
  throw new Error(
    `The float holds ${format(before)} but ${format(amount)} was requested. Fund the float first.`,
  )
}

const moved = await transferToken(client.client, {
  tokenId,
  from: client.operatorId.toString(),
  to: target,
  amount,
  // Deterministic, so a re-run of the same funding cannot double-send.
  idempotencyKey: `fund:${tokenId}:${target}:${amount}`,
})
console.log(`  transferred     ${format(amount)} to ${target} · ${moved.consensusStatus}`)

process.stdout.write('  confirming      ')
let balance = usdc('0.000000')
for (let i = 0; i < 12; i++) {
  await new Promise((r) => setTimeout(r, 2500))
  process.stdout.write('.')
  balance = await getUsdcBalance(mirror, target, tokenId)
  if (balance > 0n) break
}
console.log(`\n  ${target}  now holds ${format(balance)}`)
console.log(
  `  float remaining ${format(await getUsdcBalance(mirror, client.operatorId.toString(), tokenId))}\n`,
)

client.close()
process.exit(0)
