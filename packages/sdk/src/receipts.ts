import type { TabClient } from './client.ts'
import { TabInvalidError } from './errors.ts'
import { parseAmount } from './spend.ts'
import {
  REFUSAL_CODES, WEIGHT_REASONS,
  type RefusalCode, type WeightReason,
} from '@tab/protocol'
import type { CounterpartyWeight, Hold, ReceiptRow } from './types.ts'

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
      ...(r['seq'] !== undefined && r['seq'] !== null ? { seq: Number(r['seq']) } : {}),
      ...(r['requestHash'] ? { requestHash: String(r['requestHash']) } : {}),
      ...(r['token'] ? { token: String(r['token']) } : {}),
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

/**
 * Published independence weights for a tab's counterparties.
 *
 * Reason codes are VALIDATED against `WEIGHT_REASONS`, not cast — an unknown
 * reason from a newer server is dropped rather than typed as a real one, for
 * the same reason an unknown refusal code is: the console would otherwise
 * render a rule that does not exist, and `isBlocking` would answer confidently
 * about it.
 */
export async function counterparties(
  client: TabClient,
  tab: string,
): Promise<CounterpartyWeight[]> {
  if (!tab) throw new TabInvalidError('counterparties() needs a tab id')
  const rows = await client.request<Record<string, unknown>[]>(
    'GET',
    `/v1/tabs/${tab}/counterparties`,
  )
  return rows.map((r) => {
    const raw = Array.isArray(r['reasons']) ? r['reasons'] : []
    const reasons = raw.filter(knownReason)
    return {
      counterparty: String(r['counterparty']),
      bp: Number(r['bp'] ?? 0),
      /*
       * Never empty, even if every reason was unrecognised.
       *
       * A weight with no reason is unreadable in the console, so an unknown
       * vocabulary degrades to `INDEPENDENT` ONLY when the weight is full —
       * otherwise it stays empty and the view shows the number without a
       * fabricated justification for it.
       */
      reasons: reasons.length > 0 ? reasons : Number(r['bp'] ?? 0) === 10_000 ? (['INDEPENDENT'] as const) : [],
      blocking: r['blocking'] === true,
      revenue: parseAmount(r['revenue'], 'counterparty.revenue'),
      shareBp: Number(r['shareBp'] ?? 0),
      window: Number(r['window'] ?? 0),
      at: String(r['at']),
      ...(r['token'] ? { token: String(r['token']) } : {}),
    }
  })
}

function knownReason(value: unknown): value is WeightReason {
  return typeof value === 'string' && (WEIGHT_REASONS as readonly string[]).includes(value)
}
