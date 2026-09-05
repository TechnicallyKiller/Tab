import type { ConsensusTimestamp, MirrorLinks } from './types.ts'

export const MIRROR_URLS = {
  testnet: 'https://testnet.mirrornode.hedera.com',
  mainnet: 'https://mainnet-public.mirrornode.hedera.com',
  previewnet: 'https://previewnet.mirrornode.hedera.com',
} as const

export type Network = keyof typeof MIRROR_URLS

export class MirrorError extends Error {
  readonly status: number
  readonly path: string

  constructor(message: string, status: number, path: string) {
    super(message)
    this.name = 'MirrorError'
    this.status = status
    this.path = path
  }
}

export interface MirrorConfig {
  network?: Network
  /** Overrides `network`. No trailing slash. */
  baseUrl?: string
  timeoutMs?: number
  /** Retries on 429 and 5xx only. Never on a 4xx, which will not fix itself. */
  maxRetries?: number
  /**
   * Hard ceiling on pages walked in one call. Reaching it is REPORTED, never
   * silent: a truncated history is a wrong graph, and a wrong graph is a wrong
   * credit decision.
   */
  maxPages?: number
  fetchImpl?: typeof fetch
}

const DEFAULTS = {
  timeoutMs: 20_000,
  maxRetries: 3,
  maxPages: 200,
}

export interface PageWalk<T> {
  items: T[]
  pagesFetched: number
  /** True when maxPages stopped the walk before Mirror Node ran out of pages. */
  truncated: boolean
  /** Set when truncated, so a caller can resume rather than start over. */
  resumeFrom?: string
}

/**
 * Typed Mirror Node REST client.
 *
 * Background use only. `@tab/fastpath` cannot depend on this package —
 * boundaries.json enforces it — because one history call in a path budgeted
 * under 50ms spends the entire budget.
 */
export class MirrorClient {
  private readonly baseUrl: string
  private readonly timeoutMs: number
  private readonly maxRetries: number
  private readonly maxPages: number
  private readonly doFetch: typeof fetch

  constructor(config: MirrorConfig = {}) {
    this.baseUrl = (config.baseUrl ?? MIRROR_URLS[config.network ?? 'testnet']).replace(/\/$/, '')
    this.timeoutMs = config.timeoutMs ?? DEFAULTS.timeoutMs
    this.maxRetries = config.maxRetries ?? DEFAULTS.maxRetries
    this.maxPages = config.maxPages ?? DEFAULTS.maxPages
    this.doFetch = config.fetchImpl ?? globalThis.fetch
  }

  /** GET an absolute API path, e.g. "/api/v1/tokens/0.0.429274". */
  async get<T>(path: string): Promise<T> {
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`
    let lastError: unknown

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), this.timeoutMs)
      try {
        const res = await this.doFetch(url, {
          signal: controller.signal,
          headers: { accept: 'application/json' },
        })
        if (res.ok) return (await res.json()) as T

        // 4xx will not fix itself; only back off on throttling and server error.
        if (res.status !== 429 && res.status < 500) {
          throw new MirrorError(`Mirror Node ${res.status} for ${path}`, res.status, path)
        }
        lastError = new MirrorError(`Mirror Node ${res.status} for ${path}`, res.status, path)
      } catch (err) {
        if (err instanceof MirrorError && err.status < 500 && err.status !== 429) throw err
        // An aborted fetch surfaces as a bare DOMException with no context.
        // Wrap it so a timeout says which request timed out and for how long.
        if (err instanceof Error && err.name === 'AbortError') {
          lastError = new MirrorError(
            `Mirror Node timed out after ${this.timeoutMs}ms for ${path}`,
            0,
            path,
          )
        } else {
          lastError = err
        }
      } finally {
        clearTimeout(timer)
      }
      if (attempt < this.maxRetries) await sleep(250 * 2 ** attempt)
    }
    throw lastError instanceof Error
      ? lastError
      : new MirrorError(`Mirror Node request failed for ${path}`, 0, path)
  }

  /**
   * Walk every page of a paginated endpoint.
   *
   * THE RULE: stop when `links.next` is null, never when a page is empty.
   * Verified against live testnet — a query can return two empty pages and then
   * a page with rows. Stopping early silently truncates history.
   */
  async walk<T>(
    firstPath: string,
    extract: (body: { links: MirrorLinks } & Record<string, unknown>) => T[],
  ): Promise<PageWalk<T>> {
    const items: T[] = []
    let path: string | null = firstPath
    let pagesFetched = 0

    while (path) {
      if (pagesFetched >= this.maxPages) {
        return { items, pagesFetched, truncated: true, resumeFrom: path }
      }
      const body: { links: MirrorLinks } & Record<string, unknown> = await this.get(path)
      pagesFetched++
      items.push(...extract(body))
      path = body.links?.next ?? null
    }

    return { items, pagesFetched, truncated: false }
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Build a `timestamp=` filter. Mirror Node accepts gte/lte/gt/lt operators. */
export function timestampRange(from?: ConsensusTimestamp, to?: ConsensusTimestamp): string[] {
  const parts: string[] = []
  if (from) parts.push(`timestamp=gte:${from}`)
  if (to) parts.push(`timestamp=lt:${to}`)
  return parts
}

/** Compare consensus timestamps without losing nanosecond precision to a float. */
export function compareConsensus(a: ConsensusTimestamp, b: ConsensusTimestamp): number {
  const [as = '0', an = '0'] = a.split('.')
  const [bs = '0', bn = '0'] = b.split('.')
  const seconds = BigInt(as) - BigInt(bs)
  if (seconds !== 0n) return seconds > 0n ? 1 : -1
  const nanos = BigInt(an.padEnd(9, '0')) - BigInt(bn.padEnd(9, '0'))
  return nanos === 0n ? 0 : nanos > 0n ? 1 : -1
}
