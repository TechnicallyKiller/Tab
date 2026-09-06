/**
 * The agent's own paid endpoint.
 *
 * Plain Node http, no dependencies, NO KEY. The agent serves content; the
 * gateway in front of it answers the 402, collects the payment into house
 * float, and only forwards once the money has settled.
 *
 * That is the earn leg's version of the same claim as the spend leg: the agent
 * is economically active without ever holding value or signing anything.
 *
 *   pnpm --filter @tab/honest-agent endpoint
 */
import { createServer } from 'node:http'

const PORT = Number(process.env['AGENT_ENDPOINT_PORT'] ?? 4066)
let served = 0

const server = createServer((req, res) => {
  if (!req.url?.startsWith('/serve')) {
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'not found' }))
    return
  }
  served++
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(
    JSON.stringify({
      analysis: 'counterparty concentration is 44%, above the 40% cap',
      confidence: 0.87,
      servedCount: served,
      at: Date.now(),
    }),
  )
})

server.listen(PORT, () => {
  console.log(`\n  agent endpoint on :${PORT}  (no key, no wallet)`)
  console.log(`  the gateway fronts this and collects payment on its behalf\n`)
})
