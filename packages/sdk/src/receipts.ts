import type { TabClient } from './client.ts'
import { TabInvalidError } from './errors.ts'
import { parseAmount } from './spend.ts'
import { REFUSAL_CODES, type RefusalCode } from '@tab/protocol'
import type { Hold, ReceiptRow } from './types.ts'

/**
 * Validated, not cast.
 *
 * A cast would type an unknown string as a valid refusal code, and the UI would
 * then render a rule that does not exist — or worse, `isRetryable` would return
 * false for it and an agent would stop retrying something it should retry. An
 * unrecognised rule is dropped, which shows as a refusal with no rule rather
 * than a refusal with a fictional one.
 */
function knownRule(value: unknown): value is RefusalCode {
  return typeof value === 'string' && (REFUSAL_CODES as readonly string[]).includes(value)
}

/**
 * Receipt history and pending holds.
 *
 * Both read the gateway's projection rather than HCS directly, because this
 * package must stay browser-safe and a browser has no business walking a topic.
 * A consumer that wants to verify rather than display should run
 * `pnpm verify-tab`, which replays the topic itself and trusts nothing we say.
 */

export async function holds(client: TabClient, tab: string): Promise<Hold[]> {
  if (!tab) throw new TabInvalidError('holds() needs a tab id')
  const rows = await client.request<Record<string, unknown>[]>('GET', `/v1/tabs/${tab}/holds`)
  return rows.map((r) => ({
    holdId: String(r['holdId']),
    counterparty: String(r['counterparty']),
    amount: parseAmount(r['amount'], 'hold.amount'),
    at: String(r['at']),
    expiresAt: String(r['expiresAt']),
    status: (r['status'] as Hold['status']) ?? 'pending',
  }))
}

export async function receipts(client: TabClient, tab: string): Promise<ReceiptRow[]> {
  if (!tab) throw new TabInvalidError('receipts() needs a tab id')
  const rows = await client.request<Record<string, unknown>[]>('GET', `/v1/tabs/${tab}/entries`)

  return rows.map((r) => {
    const leg = String(r['kind']) as ReceiptRow['leg']
    return {
      leg,
      at: String(r['at']),
      window: Number(r['window'] ?? 0),
      ...(r['counterparty'] ? { counterparty: String(r['counterparty']) } : {}),
      /*
       * A refusal carries `requested`, not `amount` — it moved no money, and
       * conflating the two would make the Refusals view show refused intent as
       * though it were spend. Whichever is present is mapped to `amount` so a
       * table can render one column, and `leg` tells a reader which it is.
       */
      ...(r['amount'] !== undefined && r['amount'] !== null
        ? { amount: parseAmount(r['amount'], `${leg}.amount`) }
        : r['requested'] !== undefined && r['requested'] !== null
          ? { amount: parseAmount(r['requested'], `${leg}.requested`) }
          : {}),
      ...(typeof r['attested'] === 'boolean' ? { attested: r['attested'] } : {}),
      ...(r['transactionId'] ? { transactionId: String(r['transactionId']) } : {}),
      ...(r['holdId'] ? { holdId: String(r['holdId']) } : {}),
      ...(knownRule(r['rule']) ? { rule: r['rule'] } : {}),
    }
  })
}

/** Is the gateway up, and which network and window is it on? */
export async function health(client: TabClient): Promise<{
  ok: boolean
  network: string
  token: string
  window: number
  demoMode: boolean
}> {
  const body = await client.request<Record<string, unknown>>('GET', '/health')
  return {
    ok: body['ok'] === true,
    network: String(body['network'] ?? 'unknown'),
    token: String(body['token'] ?? ''),
    window: Number(body['window'] ?? 0),
    demoMode: body['demoMode'] === true,
  }
}
