import { AccountId, Client, PrivateKey } from '@hiero-ledger/sdk'

/**
 * The ONLY package permitted to import @hiero-ledger/sdk.
 *
 * Never @hashgraph/sdk. Both scopes still publish and neither is deprecated on
 * npm, but two copies in the graph means two Transaction/AccountId/PrivateKey
 * classes: `instanceof` returns false across the boundary and a partially
 * signed x402 transfer fails to serialize at request time. See ADR-0002.
 */

export type HederaNetwork = 'testnet' | 'mainnet' | 'previewnet'

export interface OperatorConfig {
  network: HederaNetwork
  accountId: string
  /** DER-encoded private key. Read from the environment; never from a literal. */
  privateKey: string
}

export interface TabClient {
  client: Client
  operatorId: AccountId
  operatorKey: PrivateKey
  network: HederaNetwork
  close: () => void
}

/**
 * Accepts DER (302e…), raw hex, or 0x-prefixed hex, for either key type.
 * The portal hands out DER; other tools hand out hex, and getting this wrong
 * produces an INVALID_SIGNATURE at submit time rather than a parse error here.
 */
export function parsePrivateKey(value: string): PrivateKey {
  const trimmed = value.trim().replace(/^0x/, '')
  try {
    return PrivateKey.fromStringDer(trimmed)
  } catch {
    // Fall through to the ED25519/ECDSA raw forms.
  }
  try {
    return PrivateKey.fromStringED25519(trimmed)
  } catch {
    // Fall through.
  }
  try {
    return PrivateKey.fromStringECDSA(trimmed)
  } catch {
    throw new Error(
      'Could not parse the private key. Expected DER (302e…) or raw hex for ED25519 or ECDSA.',
    )
  }
}

export function createClient(config: OperatorConfig): TabClient {
  const operatorId = AccountId.fromString(config.accountId)
  const operatorKey = parsePrivateKey(config.privateKey)

  const client =
    config.network === 'mainnet'
      ? Client.forMainnet()
      : config.network === 'previewnet'
        ? Client.forPreviewnet()
        : Client.forTestnet()

  client.setOperator(operatorId, operatorKey)
  // Bound every request. A hung consensus call inside a spend is worse than a
  // clean refusal, because the caller cannot tell the difference from a hang.
  client.setRequestTimeout(15_000)

  return {
    client,
    operatorId,
    operatorKey,
    network: config.network,
    close: () => client.close(),
  }
}

export interface EnvConfig {
  HEDERA_NETWORK?: string
  HEDERA_OPERATOR_ID?: string
  HEDERA_OPERATOR_KEY?: string
}

/**
 * Build a client from the environment, failing loudly on a missing value.
 *
 * A service that starts with a missing operator and dies on its first write is
 * far harder to diagnose than one that refuses to start.
 */
export function clientFromEnv(env: EnvConfig = process.env): TabClient {
  const network = (env.HEDERA_NETWORK ?? 'testnet') as HederaNetwork
  const accountId = env.HEDERA_OPERATOR_ID
  const privateKey = env.HEDERA_OPERATOR_KEY

  const missing: string[] = []
  if (!accountId || accountId.includes('xxxxx')) missing.push('HEDERA_OPERATOR_ID')
  if (!privateKey) missing.push('HEDERA_OPERATOR_KEY')
  if (missing.length > 0) {
    throw new Error(
      `Missing ${missing.join(' and ')} in the environment. ` +
        'Copy .env.example to .env and fill them in from portal.hedera.com. ' +
        'See docs/ENVIRONMENT.md.',
    )
  }
  if (!['testnet', 'mainnet', 'previewnet'].includes(network)) {
    throw new Error(`HEDERA_NETWORK must be testnet, mainnet or previewnet — got "${network}"`)
  }

  return createClient({ network, accountId: accountId!, privateKey: privateKey! })
}
