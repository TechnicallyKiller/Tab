import { format, usdc } from '@tab/money'
import { describeParams, MODEL_ID } from '@tab/params'
import { WEIGHT_REASON_DETAIL } from '@tab/protocol'
import type { Tab } from '@tab/sdk'

/**
 * The commands, separated from the process that runs them.
 *
 * Extracted so they can be tested — the fourth time this shape has come up here,
 * after `recheck.ts`, `ancestry.ts` and `matching.ts`, and by now it is a rule:
 * **if a file both computes and prints, the computing half will need extracting
 * the moment anyone tests it.** So it starts extracted.
 *
 * Every command returns lines rather than printing them. `main.ts` owns stdout
 * and the exit code; nothing here knows a terminal exists.
 */

export interface CommandResult {
  lines: string[]
  /** Non-zero exits the process. A refusal is NOT a failure — see `spend`. */
  exitCode: number
}

const ok = (lines: string[]): CommandResult => ({ lines, exitCode: 0 })
const fail = (lines: string[]): CommandResult => ({ lines, exitCode: 1 })

/* ── status ──────────────────────────────────────────────────────────────── */

export async function status(tab: Tab, tabId: string): Promise<CommandResult> {
  const [health, state] = await Promise.all([tab.health(), tab.state(tabId)])
  return ok([
    `  gateway       ${health.ok ? 'up' : 'responded, but not OK'} · ${health.network} · window ${health.window}`,
    `  token         ${health.token}`,
    '',
    `  tab           ${state.tab}`,
    `  balance       ${format(state.balance, { sign: 'always' })}   (negative means the agent owes)`,
    `  outstanding   ${format(state.outstanding)}`,
    `  holds         ${format(state.holds)}`,
    `  available     ${format(state.available)}`,
    `  ceiling       ${format(state.ceiling)}`,
    `  per-call cap  ${format(state.perCallCap)}`,
    `  entries       ${state.entries}`,
  ])
}

/* ── ceiling ─────────────────────────────────────────────────────────────── */

export async function ceiling(tab: Tab, tabId: string): Promise<CommandResult> {
  const c = await tab.ceiling(tabId)
  if (!c.published || !c.current) {
    return ok([
      `  No ceiling published yet for ${c.tab}.`,
      `  The gateway is enforcing ${format(c.enforced)} meanwhile — the starter floor.`,
      '  This is the normal state for a tab’s first minutes. Run `pnpm engine:once --publish`.',
    ])
  }
  const i = c.current.inputs
  const lagging = c.current.ceiling !== c.enforced
  return ok([
    `  ceiling       ${format(c.current.ceiling)}   bound by ${c.current.binding}`,
    `  enforced now  ${format(c.enforced)}${lagging ? '   <- differs; the gateway polls the topic every 15s' : ''}`,
    `  cause         ${c.current.cause}`,
    '',
    '  Published inputs:',
    `    revenue     ${format(i.revenue)}  (attested ${format(i.revenueAttested)} · unattested ${format(i.revenueUnattested)})`,
    `    tier        ${i.tier}  x${i.multBp / 10_000}`,
    `    ramp        ${i.rampBp / 100}%`,
    `    cap         ${format(i.cap)}`,
    `    floor       ${format(i.floor)}`,
    ...(i.defaulted
      ? ['    DEFAULTED   a missed settlement means zero, whatever the revenue']
      : []),
    '',
    `  model ${c.current.model} · HCS seq ${c.current.seq ?? '?'}`,
    `  hash  ${c.current.hash}`,
    '  Recompute it yourself: pnpm verify-ceiling',
  ])
}

/* ── receipts ────────────────────────────────────────────────────────────── */

export async function receipts(tab: Tab, tabId: string, limit: number): Promise<CommandResult> {
  const rows = await tab.receipts(tabId)
  if (rows.length === 0) return ok(['  No receipts yet for this tab.'])
  const recent = rows.slice(-limit).reverse()
  return ok([
    `  ${recent.length} of ${rows.length} entries, newest first`,
    '',
    ...recent.map((r) =>
      [
        `  ${r.leg.toUpperCase().padEnd(11)}`,
        (r.amount !== undefined ? format(r.amount, { sign: 'always' }) : '—').padStart(11),
        `  ${(r.counterparty ?? '—').padEnd(15)}`,
        r.seq !== undefined ? `seq ${r.seq}` : 'unpublished',
        r.rule ? `  ${r.rule}` : '',
      ].join(''),
    ),
  ])
}

/* ── counterparties ──────────────────────────────────────────────────────── */

export async function counterparties(tab: Tab, tabId: string): Promise<CommandResult> {
  const rows = await tab.counterparties(tabId)
  if (rows.length === 0) {
    return ok(['  No weights published yet. Run `pnpm engine:once --publish`.'])
  }
  const lines: string[] = []
  for (const w of rows) {
    lines.push(`  ${w.counterparty}  ${w.bp / 100}%${w.blocking ? '   BLOCKED' : ''}`)
    lines.push(`    revenue ${format(w.revenue)} · share ${w.shareBp / 100}%`)
    for (const r of w.reasons) lines.push(`    ${r}: ${WEIGHT_REASON_DETAIL[r]}`)
    if (w.funder && w.tabFunder) {
      const same = w.funder === w.tabFunder
      lines.push(
        `    funded by ${w.funder} · tab funded by ${w.tabFunder}` +
          (same ? '   <- SAME, which is what COMMON_FUNDER tests' : ''),
      )
    }
    lines.push('')
  }
  return ok(lines)
}

/* ── tabs ────────────────────────────────────────────────────────────────── */

export async function tabs(tab: Tab): Promise<CommandResult> {
  const list = await tab.tabs()
  return ok([
    `  window ${list.window} · ${list.tabs.length} tab(s) · ${list.rootsClaimed} funding root(s) claimed`,
    `  registration enforced: ${list.registrationEnforced}`,
    '',
    ...list.tabs.map(
      (t) =>
        `  ${t.tab.padEnd(15)} ${format(t.balance, { sign: 'always' }).padStart(11)}` +
        `  ceiling ${format(t.ceiling)}  ${t.tier ?? 'no tier published'}` +
        (t.registeredRoot ? `  root ${t.registeredRoot}` : '  no claim recorded'),
    ),
    '',
    `  ${list.note}`,
  ])
}

/* ── config ──────────────────────────────────────────────────────────────── */

export function config(): CommandResult {
  return ok([
    `  ${MODEL_ID}  — every published ceiling carries this id`,
    '',
    ...describeParams().map((l) => `  ${l}`),
  ])
}

/* ── spend ───────────────────────────────────────────────────────────────── */

export async function spend(
  tab: Tab,
  tabId: string,
  url: string,
  max: string,
): Promise<CommandResult> {
  const result = await tab.spend({ tab: tabId, url, max: usdc(max) })

  if (result.outcome === 'paid') {
    return ok([
      `  PAID  ${format(result.amount)} to ${result.seller}`,
      `  hold  ${result.holdId}${result.receiptSeq !== null ? ` · receipt seq ${result.receiptSeq}` : ''}`,
      `  took  ${Math.round(result.elapsedMs / 1000)}s`,
      '',
      '  Seller responded:',
      `  ${typeof result.body === 'string' ? result.body : JSON.stringify(result.body)}`,
    ])
  }

  if (result.outcome === 'refused') {
    /*
     * A refusal EXITS ZERO.
     *
     * The rail answered, correctly, and the operator got the answer they asked
     * for. Exiting non-zero would make `tab spend` unusable in a shell script —
     * every refusal would look like the command broke, and a script guarding on
     * `$?` could not tell "the rule said no" from "the gateway is down".
     */
    return ok([
      `  REFUSED  ${result.rule}`,
      `  ${result.reason}`,
      '',
      ...(result.evidence
        ? Object.entries(result.evidence).map(([k, v]) => `    ${k.padEnd(12)} ${v}`)
        : []),
      '',
      `  ${result.guidance}`,
      result.retryable
        ? '  This rule can clear on its own.'
        : '  Retrying this exact call will be refused again.',
    ])
  }

  // `failed` is a real failure: nobody knows whether the seller was paid.
  return fail([
    `  FAILED  ${result.reason}`,
    '',
    '  This is NOT a refusal — it is unknown whether the seller was paid.',
    `  Retry with the SAME idempotency key to be safe: ${result.holdId}`,
  ])
}
