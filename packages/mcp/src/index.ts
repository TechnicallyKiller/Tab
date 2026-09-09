/**
 * `@tab/mcp` — Tab's verbs as MCP tools.
 *
 * Tier 3. Depends on `@tab/sdk` and nothing lower — `boundaries.json` allows
 * only `money`, `protocol` and `sdk`, so this package is structurally incapable
 * of signing, reading a database, or recomputing a ceiling. An MCP server runs
 * on a user's machine inside a client the user did not write, which makes it the
 * surface where a leaked key would hurt most and the constraint worth enforcing
 * rather than promising.
 *
 * The binary is `src/stdio.ts`. This module exists so a host can embed the
 * server on its own transport.
 */

export { clientFor, configFromEnv, type McpConfig } from './config.ts'
export { buildServer } from './server.ts'
