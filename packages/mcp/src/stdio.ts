#!/usr/bin/env node
/**
 * The stdio entry point.
 *
 *   TAB_GATEWAY_URL=... TAB_ACCOUNT_ID=0.0.x node --experimental-strip-types src/stdio.ts
 *
 * ## STDOUT IS THE PROTOCOL
 *
 * A stdio MCP server speaks JSON-RPC on stdout, so a single stray `console.log`
 * anywhere in the process corrupts the stream and the client reports a parse
 * error rather than whatever actually went wrong. Every diagnostic here goes to
 * stderr, deliberately, and nothing else in this package prints at all.
 *
 * That is also why `configFromEnv` throws at startup: a server that connects and
 * then fails every call looks like a broken rail instead of a missing variable.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { clientFor, configFromEnv, type McpConfig } from './config.ts'
import { buildServer } from './server.ts'

let config: McpConfig
try {
  config = configFromEnv()
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
}

const server = buildServer(clientFor(config), config)

process.stderr.write(
  `tab-mcp · gateway ${config.gatewayUrl} · tab ${config.tab}\n` +
    'The agent holds no key and signs nothing. 7 tools; only tab_spend moves money.\n',
)

await server.connect(new StdioServerTransport())
