import { params } from '@tab/params'
import { createTab, type Tab } from '@tab/sdk'

/**
 * The console's one connection to the gateway.
 *
 * Through `@tab/sdk` and nothing else — `boundaries.json` allows this app
 * `money`, `protocol`, `params` and `sdk`, and that list is what keeps a
 * signing path out of the browser bundle. A direct `fetch` here would work
 * today and make the boundary decorative, which is worse than a boundary that
 * does not exist.
 */

/**
 * Config comes from `NEXT_PUBLIC_*`, so it is readable in the browser.
 *
 * Deliberately only a URL and a tab id. There is no token, no key, and the SDK
 * has no way to accept one — the claim that the agent signs nothing has to hold
 * for the console too, which is the surface most likely to be handed a
 * credential "just for convenience".
 */
export const GATEWAY_URL = process.env['NEXT_PUBLIC_TAB_GATEWAY_URL'] ?? 'http://localhost:8080'
export const TAB_ID = process.env['NEXT_PUBLIC_TAB_ACCOUNT_ID'] ?? ''

/**
 * How long a window is, AS DEPLOYED.
 *
 * Not `params.window.seconds`, and not the mock's 600: a demo deployment runs
 * WINDOW_SECONDS=300, and the console was computing window numbers and the
 * closing countdown with 600 regardless. It showed window 2981834 while the
 * gateway was in 5963668 — exactly double, because the arithmetic was right
 * and the constant was wrong.
 *
 * The frozen parameter is the fallback, so an unconfigured console agrees with
 * the model rather than with a fixture. This MUST match the gateway's own
 * WINDOW_SECONDS; they are the same setting read by two processes.
 */
export const WINDOW_SECONDS = Number(
  process.env['NEXT_PUBLIC_WINDOW_SECONDS'] ?? params.window.seconds,
)

/**
 * True when the console has been told which tab to watch.
 *
 * When false the console runs on mock data and SAYS SO on screen. That is the
 * point of the flag: a dashboard that silently falls back to invented numbers
 * is a dashboard that will be filmed showing invented numbers.
 */
export const LIVE = TAB_ID.length > 0

let cached: Tab | undefined

export function tabClient(): Tab {
  cached ??= createTab({
    baseUrl: GATEWAY_URL,
    /*
     * Short timeout and no retries, unlike an agent's client.
     *
     * This polls a read endpoint every few seconds. A 120-second default would
     * queue requests behind a dead gateway and the console would freeze on
     * stale figures rather than showing the connection as lost — and showing
     * the connection as lost is the honest failure mode for a screen someone
     * is reading numbers off.
     */
    /*
     * Long enough to survive a free-tier cold start.
     *
     * 8s was chosen so a dead gateway showed as lost rather than freezing on
     * stale figures, which is still the right instinct — but a host that
     * suspends idle services takes ~50s to wake, and during that window every
     * poll aborted and the console declared the gateway unreachable when it was
     * merely asleep. "Unreachable" and "waking up" are different claims.
     */
    timeoutMs: 45_000,
    maxRetries: 0,
  })
  return cached
}
