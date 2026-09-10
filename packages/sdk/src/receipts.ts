import { REFUSAL_CODES, type RefusalCode, WEIGHT_REASONS, type WeightReason } from '@tab/protocol'
import type { TabClient } from './client.ts'
import { TabInvalidError } from './errors.ts'
import { parseAmount } from './spend.ts'
import type {
  CeilingView,
  CounterpartyWeight,
  Hold,
  PublishedCeilingView,
  ReceiptRow,
  SettlementView,
  TabList,
  TabSummary,
} from './types.ts'

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
  /**
   * The HCS topics this gateway is actually reading.
   *
   * Served so a reader can go and check for themselves, and taken from the
   * gateway rather than from the consumer's own config so the two cannot
   * disagree — a "view on HashScan" link that points somewhere other than the
   * data it sits beside is worse than no link.
   *
   * Absent from an older gateway that did not serve them, in which case a
   * caller should show no link rather than guess at one.
   */
  topics?: { receipts: string; ceilings: string; settlements: string }
}> {
  const body = await client.request<Record<string, unknown>>('GET', '/health')
  const topics = body['topics'] as Record<string, unknown> | undefined
  return {
    ok: body['ok'] === true,
    network: String(body['network'] ?? 'unknown'),
    token: String(body['token'] ?? ''),
    window: Number(body['window'] ?? 0),
    demoMode: body['demoMode'] === true,
    ...(topics?.['receipts'] && topics['ceilings'] && topics['settlements']
      ? {
          topics: {
            receipts: String(topics['receipts']),
            ceilings: String(topics['ceilings']),
            settlements: String(topics['settlements']),
          },
        }
      : {}),
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
      reasons:
        reasons.length > 0
          ? reasons
          : Number(r['bp'] ?? 0) === 10_000
            ? (['INDEPENDENT'] as const)
            : [],
      blocking: r['blocking'] === true,
      revenue: parseAmount(r['revenue'], 'counterparty.revenue'),
      shareBp: Number(r['shareBp'] ?? 0),
      window: Number(r['window'] ?? 0),
      at: String(r['at']),
      ...(r['token'] ? { token: String(r['token']) } : {}),
      // Absent stays absent — see `CounterpartyWeight` for why defaulting any
      // of these would fabricate the evidence the panel exists to show.
      ...(r['firstSeen'] ? { firstSeen: String(r['firstSeen']) } : {}),
      ...(r['funder'] ? { funder: String(r['funder']) } : {}),
      ...(r['funderSeq'] !== undefined && r['funderSeq'] !== null
        ? { funderSeq: Number(r['funderSeq']) }
        : {}),
      ...(r['tabFunder'] ? { tabFunder: String(r['tabFunder']) } : {}),
    }
  })
}

function knownReason(value: unknown): value is WeightReason {
  return typeof value === 'string' && (WEIGHT_REASONS as readonly string[]).includes(value)
}

const TIERS = ['A', 'B', 'C', 'Unrated'] as const
const OUTCOMES = ['clean', 'missed', 'carried'] as const

/** Validated, not cast — an unknown tier would render as a real one. */
function tierOf(value: unknown): PublishedCeilingView['inputs']['tier'] {
  return typeof value === 'string' && (TIERS as readonly string[]).includes(value)
    ? (value as PublishedCeilingView['inputs']['tier'])
    : 'Unrated'
}

function outcomeOf(value: unknown): SettlementView['outcome'] {
  return typeof value === 'string' && (OUTCOMES as readonly string[]).includes(value)
    ? (value as SettlementView['outcome'])
    : 'carried'
}

function ceilingOf(r: Record<string, unknown>): PublishedCeilingView {
  const inputs = (r['inputs'] ?? {}) as Record<string, unknown>
  return {
    ceiling: parseAmount(r['ceiling'], 'ceiling.ceiling'),
    ...(r['computed'] !== undefined && r['computed'] !== null
      ? { computed: parseAmount(r['computed'], 'ceiling.computed') }
      : {}),
    window: Number(r['window'] ?? 0),
    binding: String(r['binding'] ?? 'unknown'),
    cause: String(r['cause'] ?? 'unknown'),
    at: String(r['at'] ?? ''),
    model: String(r['model'] ?? ''),
    hash: String(r['hash'] ?? ''),
    ...(r['seq'] !== undefined && r['seq'] !== null ? { seq: Number(r['seq']) } : {}),
    inputs: {
      revenue: parseAmount(inputs['revenue'], 'ceiling.inputs.revenue'),
      revenueAttested: parseAmount(inputs['revenueAttested'], 'ceiling.inputs.revenueAttested'),
      revenueUnattested: parseAmount(
        inputs['revenueUnattested'],
        'ceiling.inputs.revenueUnattested',
      ),
      tier: tierOf(inputs['tier']),
      multBp: Number(inputs['multBp'] ?? 0),
      rampBp: Number(inputs['rampBp'] ?? 0),
      cap: parseAmount(inputs['cap'], 'ceiling.inputs.cap'),
      floor: parseAmount(inputs['floor'], 'ceiling.inputs.floor'),
      defaulted: inputs['defaulted'] === true,
    },
  }
}

/**
 * The ceiling in force, its arithmetic, and the series behind it.
 *
 * Read from what the ENGINE published, never recomputed — the SDK is
 * browser-safe and cannot import `@tab/scoring`, and that is the right
 * constraint. A client that recomputed the ceiling would hand a viewer a second
 * answer to compare against the topic, and two answers is worse than one even
 * when they agree.
 *
 * `published: false` is not an error. It means the engine has not run for this
 * tab yet and the starter ceiling is in force — `enforced` says what that is.
 */
export async function ceiling(client: TabClient, tab: string): Promise<CeilingView> {
  if (!tab) throw new TabInvalidError('ceiling() needs a tab id')
  const body = await client.request<Record<string, unknown>>('GET', `/v1/tabs/${tab}/ceiling`)
  const history = (Array.isArray(body['history']) ? body['history'] : []).map((row) =>
    ceilingOf(row as Record<string, unknown>),
  )
  const published = body['published'] === true
  return {
    tab: String(body['tab'] ?? tab),
    published,
    enforced: parseAmount(body['enforced'], 'ceiling.enforced'),
    // `current` is the last history element rather than a separate parse of the
    // top-level fields, so "the number in force" and "the last point on the
    // chart" cannot disagree on screen.
    ...(published && history.length > 0 ? { current: history[history.length - 1]! } : {}),
    history,
    ...(body['note'] ? { note: String(body['note']) } : {}),
  }
}

/**
 * Settled windows, ascending by window.
 *
 * Ordered by WINDOW rather than by arrival: a repaired or late settlement lands
 * on the topic after the windows that follow it, and a table sorted by
 * timestamp would put window 41 above window 39 with no explanation.
 *
 * The gross legs come through as absent when the topic did not carry them. A
 * caller must render that as "not published", never as zero.
 */
export async function settlements(client: TabClient, tab: string): Promise<SettlementView[]> {
  if (!tab) throw new TabInvalidError('settlements() needs a tab id')
  const rows = await client.request<Record<string, unknown>[]>('GET', `/v1/tabs/${tab}/settlements`)
  return rows.map((r) => ({
    window: Number(r['window'] ?? 0),
    at: String(r['at'] ?? ''),
    ...(r['seq'] !== undefined && r['seq'] !== null ? { seq: Number(r['seq']) } : {}),
    net: parseAmount(r['net'], 'settlement.net'),
    ...(r['credits'] !== undefined && r['credits'] !== null
      ? { credits: parseAmount(r['credits'], 'settlement.credits') }
      : {}),
    ...(r['debits'] !== undefined && r['debits'] !== null
      ? { debits: parseAmount(r['debits'], 'settlement.debits') }
      : {}),
    ...(r['interest'] !== undefined && r['interest'] !== null
      ? { interest: parseAmount(r['interest'], 'settlement.interest') }
      : {}),
    ...(r['outstanding'] !== undefined && r['outstanding'] !== null
      ? { outstanding: parseAmount(r['outstanding'], 'settlement.outstanding') }
      : {}),
    ...(r['receiptCount'] !== undefined && r['receiptCount'] !== null
      ? { receiptCount: Number(r['receiptCount']) }
      : {}),
    outcome: outcomeOf(r['outcome']),
    rampFromBp: Number(r['rampFromBp'] ?? 0),
    rampToBp: Number(r['rampToBp'] ?? 0),
    ...(r['transactionId'] ? { transactionId: String(r['transactionId']) } : {}),
    ...(r['token'] ? { token: String(r['token']) } : {}),
  }))
}

/**
 * The tabs this gateway knows about.
 *
 * Named `tabs`, not `registry`, and the response carries
 * `registrationEnforced: false` so a caller cannot mistake it for one. Nothing
 * writes a `register` message yet — one Starter Tab per funding root is
 * unenforced and the README labels it OPEN — so a tab appears here the first
 * time it spends or earns, and there is no registration time to report.
 */
export async function tabs(client: TabClient): Promise<TabList> {
  const body = await client.request<Record<string, unknown>>('GET', '/v1/tabs')
  const rows = Array.isArray(body['tabs']) ? body['tabs'] : []
  return {
    window: Number(body['window'] ?? 0),
    /*
     * Defaults to FALSE when the field is absent, never true.
     *
     * An older gateway that does not send it has no registration flow either,
     * so absence means unenforced. Defaulting the permissive way round would
     * let a stale server silently license the "Registry" heading.
     */
    registrationEnforced: body['registrationEnforced'] === true,
    rootsClaimed: Number(body['rootsClaimed'] ?? 0),
    note: String(body['note'] ?? ''),
    tabs: rows.map((raw) => {
      const r = raw as Record<string, unknown>
      const summary: TabSummary = {
        tab: String(r['tab']),
        balance: parseAmount(r['balance'], 'tab.balance'),
        outstanding: parseAmount(r['outstanding'], 'tab.outstanding'),
        holds: parseAmount(r['holds'], 'tab.holds'),
        available: parseAmount(r['available'], 'tab.available'),
        ceiling: parseAmount(r['ceiling'], 'tab.ceiling'),
        entries: Number(r['entries'] ?? 0),
        // Absent stays absent. An unpublished tab has no tier, which is not the
        // same as being Unrated.
        ...(r['tier'] !== undefined && r['tier'] !== null ? { tier: tierOf(r['tier']) } : {}),
        ...(r['publishedCeiling'] !== undefined && r['publishedCeiling'] !== null
          ? { publishedCeiling: parseAmount(r['publishedCeiling'], 'tab.publishedCeiling') }
          : {}),
        ...(r['binding'] ? { binding: String(r['binding']) } : {}),
        ...(r['cause'] ? { cause: String(r['cause']) } : {}),
        ...(r['model'] ? { model: String(r['model']) } : {}),
        ...(r['seq'] !== undefined && r['seq'] !== null ? { seq: Number(r['seq']) } : {}),
        // Absent stays absent: no claim recorded is not the same as denied.
        ...(r['registeredRoot'] ? { registeredRoot: String(r['registeredRoot']) } : {}),
        ...(r['registeredAt'] ? { registeredAt: String(r['registeredAt']) } : {}),
        ...(r['registrationSeq'] !== undefined && r['registrationSeq'] !== null
          ? { registrationSeq: Number(r['registrationSeq']) }
          : {}),
        ...(r['uaid'] ? { uaid: String(r['uaid']) } : {}),
      }
      return summary
    }),
  }
}
