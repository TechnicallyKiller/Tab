'use client'

import { params, windowEnd, windowStart } from '@tab/params'
import type { SettlementView } from '@tab/sdk'
import { useState } from 'react'
import { Card, CardHead, Chip } from '@/components/ui'
import { seq as fmtSeq } from '@/lib/format'
import { useSettlements } from '@/lib/hooks/use-settlements'
import { txUrl } from '@/lib/hooks/use-topics'
import { SETTLEMENTS } from '@/lib/mock/settlements'
import type { Outcome, Settlement } from '@/lib/mock/types'
import type { MicroUsdc } from '@/lib/money'
import { bp, format, formatBpPercent, micro, usdc } from '@/lib/money'

/**
 * Settled windows, from the settlements topic.
 *
 * This view exists to make one claim: many receipts became ONE transfer. So the
 * netting panel is the point of the screen and the net alone is not enough — a
 * `net` with no gross legs beside it shows the transfer and hides the collapse.
 *
 * The reconciliation banner is DERIVED from the rows, not read from a mock. It
 * used to say `checked 43 · matched 43 · repaired 0`, three numbers that came
 * from nowhere. What the topic can actually tell us is whether any window was
 * settled more than once — and one was, early on, by a worker that replayed
 * only the receipts topic and so believed a settled window unsettled. That scar
 * is permanent and append-only, and this banner now surfaces it instead of
 * printing CLEAN over the top of it.
 */

function outcomeTone(o: Outcome) {
  if (o === 'CLEAN') return 'clean' as const
  if (o === 'MISSED') return 'caution' as const
  return 'dim' as const
}

/** `13:52 – 14:02` in the viewer's own zone, from the window index alone. */
function rangeOf(window: number): string {
  const clock = (seconds: number) =>
    new Date(seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return `${clock(windowStart(window, params.window.seconds))} – ${clock(windowEnd(window, params.window.seconds))}`
}

/**
 * One published settlement, shaped for the table.
 *
 * `credits`, `debits`, `interest` and `receiptCount` are OPTIONAL on the wire —
 * settlements published before those fields existed do not carry them. They
 * fall back to `undefined`, never to zero, and the netting panel says "not
 * published" rather than printing four zeroes beside "4 receipts → 1 transfer".
 */
type Row = Settlement & {
  windowIndex: number
  seq?: number
  outstanding?: MicroUsdc
  /** True when the topic carried the gross legs. */
  netted: boolean
}

function fromLive(s: SettlementView): Row {
  const netted = s.credits !== undefined && s.debits !== undefined
  return {
    windowIndex: s.window,
    window: fmtSeq(s.window),
    range: rangeOf(s.window),
    credits: s.credits ?? usdc('0.000000'),
    /*
     * Debits and interest are published NEGATIVE, and passed through as-is.
     *
     * My first version negated `debits`, assuming the topic stored a positive
     * magnitude. It does not: `@tab/ledger`'s `WindowNet` documents both as
     * negative and defines `net = credits + debits + interest`. The live topic
     * agrees — window 5962288 carries `credits 0.150000 · debits -0.040000 ·
     * net 0.110000`. Negating here turned a debit into a credit on screen and
     * made the netting panel sum to 0.190000 against a published net of
     * 0.110000.
     *
     * So the column reads as a vertical addition, which is what it should be.
     */
    debits: s.debits ?? usdc('0.000000'),
    interest: s.interest ?? usdc('0.000000'),
    net: s.net,
    rampFromBp: bp(s.rampFromBp),
    rampToBp: bp(s.rampToBp),
    outcome: s.outcome.toUpperCase() as Outcome,
    receiptCount: s.receiptCount ?? 0,
    transferId: s.transactionId ?? '—',
    ...(s.seq !== undefined ? { seq: s.seq } : {}),
    ...(s.outstanding !== undefined ? { outstanding: s.outstanding } : {}),
    netted,
  }
}

export default function SettlementsView() {
  const { value: liveRows, live, error, loading } = useSettlements()

  const rows: Row[] = live
    ? // Newest first for display. The wire order is ascending by window, which
      // is the order that survives a late or repaired settlement.
      [...liveRows].reverse().map(fromLive)
    : SETTLEMENTS.map((s, i) => ({
        ...s,
        windowIndex: 147 - i,
        netted: true,
      }))

  const [open, setOpen] = useState<string | null>(null)
  const expanded = rows.find((s) => s.window === open) ?? rows[0]

  /*
   * What the topic can actually attest.
   *
   * A window appearing twice means it was settled twice — the failure that
   * moved 0.11 USDC on two separate schedule ids. It is derived here rather
   * than trusted from anywhere, because the whole argument for having no
   * contract is that a stranger reads the topic and reaches the same verdict.
   */
  const windows = new Set(rows.map((r) => r.windowIndex))
  const duplicated = rows.length - windows.size
  const missing = rows.filter((r) => r.outcome === 'MISSED').length
  const clean = duplicated === 0

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      {/* This runs on camera during the demo, so it is a designed artifact. */}
      <Card
        style={{
          borderColor: clean ? 'var(--credit)' : 'var(--caution)',
          padding: '16px 18px',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 18,
          alignItems: 'center',
        }}
      >
        <span className="t-label">Settlements topic · one transfer per window</span>
        <span className="t-figure" style={{ fontSize: 16 }}>
          {loading
            ? 'reading the settlements topic…'
            : `windows ${windows.size} · settled twice ${duplicated} · missed ${missing}`}
        </span>
        <Chip tone={clean ? 'clean' : 'caution'}>
          {loading ? 'READING' : clean ? 'ONE PER WINDOW' : 'DOUBLE SETTLEMENT ON TOPIC'}
        </Chip>
        {!clean ? (
          <span style={{ color: 'var(--ink-2)', fontSize: 12.5, maxWidth: 460 }}>
            A window settled twice, by a worker that replayed only the receipts topic and so read a
            settled window as unsettled. HCS is append-only, so the record stands and this panel
            reports it. The reconciler audits the money against Mirror Node.
          </span>
        ) : null}
        {live ? null : (
          <strong style={{ color: 'var(--caution)' }}>
            MOCK DATA — set NEXT_PUBLIC_TAB_ACCOUNT_ID
          </strong>
        )}
        {error ? (
          <span style={{ color: 'var(--caution)', fontSize: 12.5 }}>
            gateway unreachable — showing the last {rows.length} known
          </span>
        ) : null}
      </Card>

      <Card style={{ overflow: 'hidden' }}>
        <CardHead title="Windows" />
        <div className="tbl-scroll">
          <table className="tbl" style={{ minWidth: 900 }}>
            <thead>
              <tr>
                <th scope="col">Window</th>
                <th scope="col">Range</th>
                <th scope="col" className="n">
                  Credits
                </th>
                <th scope="col" className="n">
                  Debits
                </th>
                <th scope="col" className="n">
                  Interest
                </th>
                <th scope="col" className="n">
                  Net
                </th>
                <th scope="col">Ramp</th>
                <th scope="col">Outcome</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && !loading ? (
                <tr>
                  <td colSpan={8} style={{ padding: '18px 14px', color: 'var(--ink-3)' }}>
                    No window has settled yet. The worker runs on the window boundary — the next one
                    closes within {params.window.seconds}s.
                  </td>
                </tr>
              ) : null}
              {rows.map((s, i) => (
                <tr
                  key={`${s.window}-${s.seq ?? i}`}
                  onClick={() => setOpen(open === s.window ? null : s.window)}
                  style={{
                    cursor: 'pointer',
                    background: expanded?.window === s.window ? 'var(--pen-soft)' : undefined,
                  }}
                >
                  <td style={{ fontWeight: 600 }}>{s.window}</td>
                  <td style={{ color: 'var(--ink-3)' }}>{s.range}</td>
                  <td className="n" style={{ color: 'var(--credit)' }}>
                    {s.netted ? format(s.credits) : '—'}
                  </td>
                  <td className="n" style={{ color: 'var(--debit)' }}>
                    {s.netted ? format(s.debits) : '—'}
                  </td>
                  <td className="n" style={{ color: 'var(--ink-2)' }}>
                    {s.netted ? format(s.interest) : '—'}
                  </td>
                  <td
                    className="n"
                    style={{
                      fontWeight: 600,
                      color: s.net < 0n ? 'var(--debit)' : 'var(--credit)',
                    }}
                  >
                    {format(s.net, { sign: 'always' })}
                  </td>
                  <td style={{ color: 'var(--ink-2)' }}>
                    {formatBpPercent(s.rampFromBp, 0)} → {formatBpPercent(s.rampToBp, 0)}
                  </td>
                  <td>
                    <Chip tone={outcomeTone(s.outcome)}>{s.outcome}</Chip>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {expanded ? <Netting s={expanded} /> : null}
      </Card>
    </div>
  )
}

/** The point of the expansion: many receipts became one movement. */
function Netting({ s }: { s: Row }) {
  const rows: [string, string, string, number][] = [
    ['credits', format(s.credits, { sign: 'always' }), 'var(--credit)', 400],
    ['debits', format(s.debits, { sign: 'always' }), 'var(--debit)', 400],
    ['interest', format(s.interest, { sign: 'always' }), 'var(--ink-2)', 400],
    ['net transfer', format(s.net, { sign: 'always' }), 'var(--ink)', 600],
  ]

  /*
   * Does the column actually add up?
   *
   * `net = credits + debits + interest`, the latter two negative. Checked on
   * screen rather than assumed, because this exact assumption was wrong once:
   * an earlier version of this file negated `debits`, and the panel then showed
   * four figures summing to 0.190000 above a published net of 0.110000. Nobody
   * would have noticed until someone added them up on camera.
   */
  const sums = !s.netted || s.credits + s.debits + s.interest === s.net
  return (
    <div
      className="rule-t"
      style={{ background: 'var(--sunk)', padding: 20, display: 'flex', flexWrap: 'wrap', gap: 40 }}
    >
      <div>
        <div className="t-label" style={{ marginBottom: 10 }}>
          Netting · window {s.window}
          {s.seq !== undefined ? ` · seq ${s.seq}` : ''}
        </div>
        {s.netted ? (
          <table className="t-mono" style={{ fontSize: 14, minWidth: 280 }}>
            <tbody>
              {rows.map(([k, v, colour, weight], i) => (
                <tr
                  key={k}
                  style={{
                    borderBottom:
                      i === 2
                        ? 'var(--bw) solid var(--ink)'
                        : i === 3
                          ? '4px double var(--ink)'
                          : '1px solid var(--rule-soft)',
                  }}
                >
                  <th
                    scope="row"
                    style={{
                      textAlign: 'left',
                      padding: '6px 20px 6px 0',
                      fontWeight: weight,
                      color: colour,
                    }}
                  >
                    {k}
                  </th>
                  <td
                    style={{
                      textAlign: 'right',
                      padding: '6px 0',
                      fontWeight: weight,
                      color: colour,
                    }}
                  >
                    {v}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          /*
           * The gross legs were not published for this window.
           *
           * Rendering four zeroes here would invent a netting that no topic
           * carries, next to a receipt count that is also absent — the exact
           * shape of a dashboard that cannot be trusted.
           */
          <div
            className="t-mono"
            style={{ fontSize: 13, color: 'var(--ink-3)', maxWidth: 300, lineHeight: 1.8 }}
          >
            The gross legs were not published for this window — only the net{' '}
            <strong style={{ color: 'var(--ink)' }}>{format(s.net, { sign: 'always' })}</strong>.
            The netting is not shown rather than shown as zero.
          </div>
        )}
      </div>
      <div className="t-mono" style={{ fontSize: 14, lineHeight: 2, color: 'var(--ink-2)' }}>
        {s.netted ? (
          <div className="t-figure" style={{ fontSize: 24, color: 'var(--ink)' }}>
            {s.receiptCount} receipts → 1 transfer
          </div>
        ) : null}
        {!sums ? (
          <div style={{ color: 'var(--debit)', lineHeight: 1.6, maxWidth: 320 }}>
            <strong>The legs do not sum to the net.</strong> Published{' '}
            {format(s.credits, { sign: 'always' })} {format(s.debits, { sign: 'always' })}{' '}
            {format(s.interest, { sign: 'always' })} ={' '}
            {format(micro(s.credits + s.debits + s.interest), { sign: 'always' })}, but the net on
            the topic is {format(s.net, { sign: 'always' })}. Shown rather than reconciled: the
            reconciler audits the money against Mirror Node on its own schedule.
          </div>
        ) : null}
        <div>
          transfer id{' '}
          {s.transferId === '—' ? (
            <span style={{ color: 'var(--ink-3)' }}>none — window missed, nothing moved</span>
          ) : (
            <a
              href={txUrl(s.transferId)}
              target="_blank"
              rel="noreferrer"
              style={{ color: 'var(--pen)' }}
            >
              {s.transferId} ↗
            </a>
          )}
        </div>
        {s.outstanding !== undefined && s.outstanding > 0n ? (
          <div>
            carried into the next window{' '}
            <strong style={{ color: 'var(--debit)' }}>{format(s.outstanding)}</strong>
          </div>
        ) : null}
        <div>float account touched once</div>
      </div>
    </div>
  )
}
