import { createTab, type Tab } from '@tab/sdk'

/**
 * How the plugin reaches the rail — and what it deliberately cannot hold.
 *
 * A gateway URL and a tab id. There is no token, no private key, and
 * `createTab` has no parameter that would accept one. `boundaries.json` allows
 * this package `money`, `protocol` and `sdk` only, so it is structurally
 * incapable of signing: the Hedera SDK is a peer dependency of the Agent Kit,
 * not something these tools can reach.
 *
 * That constraint IS the product claim. An Agent Kit plugin runs inside someone
 * else's agent loop, chosen by an LLM, and it is exactly where a key would be
 * handed over "just for this one call".
 */
export interface TabPluginConfig {
  gatewayUrl: string
  tab: string
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): TabPluginConfig {
  const gatewayUrl = env['TAB_GATEWAY_URL'] ?? 'http://localhost:8080'
  const tab = env['TAB_ACCOUNT_ID'] ?? ''
  if (!tab) {
    throw new Error(
      'TAB_ACCOUNT_ID is not set. The Tab plugin needs to know which tab to transact on. ' +
        'Set it alongside TAB_GATEWAY_URL before building the toolkit.',
    )
  }
  return { gatewayUrl, tab }
}

/**
 * One client for the whole plugin.
 *
 * Patient by default: a spend waits on the SELLER, whose x402 facilitator runs
 * a Mirror Node preflight plus signature verification — measured at 25-39s for
 * an HTS token. An agent loop is waiting on this call, so giving up early would
 * abandon a payment that was about to succeed and leave the caller unable to
 * tell a slow seller from a failed one.
 */
export function clientFor(config: TabPluginConfig): Tab {
  return createTab({ baseUrl: config.gatewayUrl, timeoutMs: 120_000, maxRetries: 1 })
}
