import { readFileSync } from 'node:fs'
import type { NextConfig } from 'next'

/**
 * Config read from the MONOREPO ROOT `.env`, not from `apps/web/.env`.
 *
 * Next loads `.env` relative to the app directory, and `NEXT_PUBLIC_*` values
 * are inlined at BUILD time — so a root-level `.env` is invisible to the
 * browser bundle and the console silently rendered mock data while claiming to
 * be configured. Copying the values into `apps/web/.env` would fix it and
 * create a second source of truth for the gateway URL and the tab id, which is
 * the same mistake as the gateway's own starter-ceiling default.
 *
 * So the root file is read here, once, and only the two `NEXT_PUBLIC_` keys are
 * lifted. Nothing else from `.env` is exposed — that file holds private keys,
 * and a config that forwarded it wholesale would put them in a browser bundle.
 */
function publicEnvFromRoot(): Record<string, string> {
  const wanted = ['NEXT_PUBLIC_TAB_GATEWAY_URL', 'NEXT_PUBLIC_TAB_ACCOUNT_ID'] as const
  const out: Record<string, string> = {}

  // Whatever the process already has wins, so CI and a deployment can override
  // the file without editing it.
  for (const key of wanted) {
    const fromProcess = process.env[key]
    if (fromProcess) out[key] = fromProcess
  }

  try {
    const raw = readFileSync(new URL('../../.env', import.meta.url), 'utf8')
    for (const line of raw.split('\n')) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
      if (!match) continue
      const [, key, value] = match
      if (!key || out[key] !== undefined) continue
      if ((wanted as readonly string[]).includes(key)) out[key] = (value ?? '').trim()
    }
  } catch {
    /*
     * No root `.env` is not an error.
     *
     * A fresh clone has none, and the console must still build — it falls back
     * to mock data and says MOCK DATA on screen, which is the honest state for
     * an unconfigured deployment.
     */
  }
  return out
}

const config: NextConfig = {
  reactStrictMode: true,
  // Workspace packages ship TypeScript source, not a build step.
  transpilePackages: ['@tab/money', '@tab/params', '@tab/protocol', '@tab/sdk'],
  env: publicEnvFromRoot(),
}

export default config
