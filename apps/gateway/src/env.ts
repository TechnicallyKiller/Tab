import { type MicroUsdc, usdc } from '@tab/money'
import { caps } from '@tab/params'

/**
 * Environment, validated at boot.
 *
 * A service that starts with a missing topic id and dies on its first write is
 * far harder to diagnose than one that refuses to start. So this throws, and it
 * names everything that is wrong at once rather than one variable per restart.
 */

export interface GatewayEnv {
  network: 'testnet' | 'mainnet' | 'previewnet'
  operatorId: string
  operatorKey: string
  /** The spend token. Read from config — never hardcode a token id. */
  tokenId: string
  /**
   * The agent's tab — its identity on the rail, and where a positive net is
   * paid OUT to.
   *
   * MUST differ from the hot float. It used to default to the operator id,
   * which made the tab and the float one account: settlement then scheduled a
   * transfer from `0.0.x` to `0.0.x`, consensus executed it, and the worker
   * reported CLEAN having moved nothing between two parties. The settlement
   * worker now refuses that outright, so this is required.
   */
  tabAccountId: string
  receiptTopic: string
  ceilingTopic: string
  settlementTopic: string
  /** Facilitator fee payer. Funded ECDSA, separate from the seller. */
  feePayerId: string
  feePayerKey: string
  port: number
  windowSeconds: number
  demoMode: boolean
  /** Until @tab/scoring exists, the ceiling is a fixed configured value. */
  starterCeiling: MicroUsdc
  perCallCap: MicroUsdc
  holdTtlSeconds: number
}

function required(name: string, value: string | undefined, missing: string[]): string {
  if (!value || value.includes('xxxxx')) {
    missing.push(name)
    return ''
  }
  return value
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): GatewayEnv {
  const missing: string[] = []
  const env: GatewayEnv = {
    network: (source['HEDERA_NETWORK'] ?? 'testnet') as GatewayEnv['network'],
    operatorId: required('HEDERA_OPERATOR_ID', source['HEDERA_OPERATOR_ID'], missing),
    operatorKey: required('HEDERA_OPERATOR_KEY', source['HEDERA_OPERATOR_KEY'], missing),
    tokenId: required('USDC_TOKEN_ID', source['USDC_TOKEN_ID'], missing),
    tabAccountId: required(
      'TAB_ACCOUNT_ID',
      source['TAB_ACCOUNT_ID'] ?? source['PAYER_ACCOUNT_ID'],
      missing,
    ),
    receiptTopic: required('TOPIC_RECEIPTS', source['TOPIC_RECEIPTS'], missing),
    ceilingTopic: required('TOPIC_CEILINGS', source['TOPIC_CEILINGS'], missing),
    settlementTopic: required('TOPIC_SETTLEMENTS', source['TOPIC_SETTLEMENTS'], missing),
    feePayerId: required('FAUCET_ACCOUNT_ID', source['FAUCET_ACCOUNT_ID'], missing),
    feePayerKey: required('FAUCET_ACCOUNT_KEY', source['FAUCET_ACCOUNT_KEY'], missing),
    /*
     * `PORT` is what every managed host actually sets.
     *
     * Render, Fly, Heroku and Cloud Run all inject `PORT` and expect the
     * service to bind it; a service listening anywhere else fails its health
     * check and the deploy is marked dead with no error in the logs, because
     * from the process's point of view nothing went wrong. `GATEWAY_PORT` still
     * wins when set, so a local override is unchanged.
     */
    port: Number(source['GATEWAY_PORT'] ?? source['PORT'] ?? 8080),
    windowSeconds: Number(source['WINDOW_SECONDS'] ?? 600),
    demoMode: source['DEMO_MODE'] === 'true',
    /*
     * From `@tab/params`, not from a local default.
     *
     * This read `STARTER_CEILING_USDC ?? '1.000000'`, which made it a SECOND
     * source of truth for a policy number params exists to own — and it showed:
     * v2 lowered the floor to 0.250000 and the gateway kept granting 1.0000 to
     * an unknown tab. The env var stays as an explicit override for a demo, but
     * the default now tracks the versioned set.
     */
    starterCeiling: source['STARTER_CEILING_USDC']
      ? usdc(source['STARTER_CEILING_USDC'])
      : caps.starterCeiling,
    perCallCap: source['PER_CALL_CAP_USDC'] ? usdc(source['PER_CALL_CAP_USDC']) : caps.perCall,
    holdTtlSeconds: Number(source['HOLD_TTL_SECONDS'] ?? 60),
  }

  if (missing.length > 0) {
    throw new Error(
      `Gateway cannot start. Missing from .env:\n  ${missing.join('\n  ')}\n\n` +
        'Run `pnpm chain:status` to see what is configured. See docs/ENVIRONMENT.md.',
    )
  }
  return env
}
