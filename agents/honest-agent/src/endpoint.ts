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

/*
 * `PORT` is what a managed host actually sets.
 *
 * Render, Fly and Heroku inject it and health-check that address; a service
 * listening anywhere else is marked dead with nothing in the logs, because from
 * the process's point of view it started fine. `AGENT_ENDPOINT_PORT` still wins
 * when set, so local demos are unchanged.
 */
const PORT = Number(process.env['AGENT_ENDPOINT_PORT'] ?? process.env['PORT'] ?? 4066)
let served = 0

const server = createServer((req, res) => {
  /*
   * Unpaid, and deliberately BEFORE the 404 — a host that health-checks a path
   * this server answers 404 to marks a perfectly healthy process as dead, and
   * the logs say nothing because from its own point of view it started fine.
   *
   * It reports `served` so warming the service before a demo also tells you
   * whether this instance has handled anything yet, which distinguishes a cold
   * start from a restart that lost its count.
   */
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true, served }))
    return
  }

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
