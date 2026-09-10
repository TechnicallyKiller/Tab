#!/usr/bin/env node
/**
 * `tab` — the operator surface.
 *
 *   pnpm tab status
 *   pnpm tab ceiling
 *   pnpm tab receipts --limit 20
 *   pnpm tab counterparties
 *   pnpm tab tabs
 *   pnpm tab config
 *   pnpm tab spend --url <seller> --max 0.040000
 *
 * ## Why this exists when `pnpm settle` and `pnpm reconcile` already do
 *
 * Those are WORKERS — they move money and run on a schedule. This is the
 * read-mostly surface for a human answering "what is the tab doing right now,
 * and why", and it talks to the gateway over HTTP through `@tab/sdk` rather
 * than replaying topics itself. That difference is the point: it shows an
 * operator exactly what an AGENT would see, so a refusal an operator cannot
 * explain is a refusal the agent could not have explained either.
 *
 * It signs nothing. `boundaries.json` permits this app `hedera` and `mirror`;
 * it uses neither, because every question it asks is one the gateway already
 * answers from the public record.
 */
import { createTab } from '@tab/sdk'
import * as commands from './commands.ts'

const USAGE = `
  tab — the operator surface for a Tab agent

    status           position, ceiling and gateway health
    ceiling          the ceiling in force, and the arithmetic behind it
    receipts         recent ledger entries        [--limit N]
    counterparties   independence weights and why
    tabs             every tab the gateway knows about
    config           every parameter in force
    spend            pay a seller                 --url <url> --max 0.040000

  Environment:
    TAB_GATEWAY_URL  default http://localhost:8080
    TAB_ACCOUNT_ID   required (except for \`tabs\` and \`config\`)
`

function flag(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : undefined
}

const argv = process.argv.slice(2)
const command = argv[0]

if (!command || command === '--help' || command === '-h') {
  process.stdout.write(`${USAGE}\n`)
  process.exit(0)
}

const gatewayUrl = process.env['TAB_GATEWAY_URL'] ?? 'http://localhost:8080'
const tabId = process.env['TAB_ACCOUNT_ID'] ?? ''

/*
 * `tabs` and `config` do not need a tab id — one enumerates every tab and the
 * other reads the frozen parameter set. Requiring one would make the two
 * commands most useful for diagnosing an unconfigured deployment the two you
 * cannot run on an unconfigured deployment.
 */
const needsTab = !['tabs', 'config'].includes(command)
if (needsTab && !tabId) {
  process.stderr.write(
    'TAB_ACCOUNT_ID is not set, so there is no tab to inspect.\n' +
      'Set it, or run `tab tabs` to see which tabs the gateway knows about.\n',
  )
  process.exit(1)
}

// Patient, because `spend` waits on the seller's x402 settlement (25-39s for an
// HTS token). One retry: an operator watching a terminal would rather wait than
// re-run a command that moves money.
const tab = createTab({ baseUrl: gatewayUrl, timeoutMs: 120_000, maxRetries: 1 })

try {
  let result: commands.CommandResult

  switch (command) {
    case 'status':
      result = await commands.status(tab, tabId)
      break
    case 'ceiling':
      result = await commands.ceiling(tab, tabId)
      break
    case 'receipts':
      result = await commands.receipts(tab, tabId, Number(flag(argv, 'limit') ?? 10))
      break
    case 'counterparties':
      result = await commands.counterparties(tab, tabId)
      break
    case 'tabs':
      result = await commands.tabs(tab)
      break
    case 'config':
      result = commands.config()
      break
    case 'spend': {
      const url = flag(argv, 'url')
      const max = flag(argv, 'max')
      if (!url || !max) {
        process.stderr.write('spend needs --url <seller> and --max <amount>\n')
        process.exit(1)
      }
      result = await commands.spend(tab, tabId, url, max)
      break
    }
    default:
      process.stderr.write(`Unknown command "${command}".\n${USAGE}\n`)
      process.exit(1)
  }

  process.stdout.write(`\n${result.lines.join('\n')}\n\n`)
  process.exit(result.exitCode)
} catch (error) {
  /*
   * An unreachable gateway is a FAILURE, not an empty answer.
   *
   * Printing nothing and exiting zero would let a script conclude the tab is
   * fine when nobody answered — the same class of mistake as a reconciler that
   * prints CLEAN over receipts it never checked.
   */
  process.stderr.write(
    `\n  ${error instanceof Error ? error.message : String(error)}\n` +
      `  gateway ${gatewayUrl}\n\n`,
  )
  process.exit(1)
}
