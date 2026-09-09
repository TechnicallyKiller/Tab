import { createTab, type Tab } from '@tab/sdk'

/**
 * How the server is configured, and what it deliberately cannot be given.
 *
 * A URL and a tab id. There is no token, no private key, and `createTab` has no
 * parameter that would accept one — which is the whole product claim holding at
 * the surface most likely to be handed a credential "just for convenience".
 * An MCP server runs on a user's machine, inside a client the user did not
 * write, and is exactly where a key would leak.
 */
export interface McpConfig {
  gatewayUrl: string
  tab: string
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): McpConfig {
  const gatewayUrl = env['TAB_GATEWAY_URL'] ?? 'http://localhost:8080'
  const tab = env['TAB_ACCOUNT_ID'] ?? ''

  if (!tab) {
    /*
     * Fail at STARTUP, not on the first tool call.
     *
     * An MCP client shows a server as connected the moment the process is
     * alive, so a server that starts happily and then refuses every call looks
     * like a broken rail rather than a missing environment variable. The error
     * goes to stderr, which stdio transports reserve for exactly this — stdout
     * is the JSON-RPC channel and a stray line there corrupts the stream.
     */
    throw new Error(
      'TAB_ACCOUNT_ID is not set. The MCP server needs to know which tab to transact on. ' +
        'Set it in the mcpServers entry for this server, alongside TAB_GATEWAY_URL.',
    )
  }

  return { gatewayUrl, tab }
}

export function clientFor(config: McpConfig): Tab {
  return createTab({
    baseUrl: config.gatewayUrl,
    /*
     * Patient, unlike the console's client.
     *
     * A spend waits on the SELLER, whose x402 facilitator runs a Mirror Node
     * preflight plus signature verification — measured at 25-39s for an HTS
     * token. An MCP client is a foreground tool an agent is waiting on, so
     * giving up at 8s would abandon a payment that was about to succeed and
     * leave the caller unable to tell a slow seller from a failed one.
     */
    timeoutMs: 120_000,
    maxRetries: 1,
  })
}
