'use client'

import { caps, params, windowOf } from '@tab/params'
import Link from 'next/link'
import { CapacityMeter } from '@/components/console/capacity-meter'
import { useConsole, useIsLive } from '@/components/console/provider'
import { ReceiptTable } from '@/components/console/receipt-table'
import { Card, CardHead, Chip, Figure } from '@/components/ui'
import { useCeiling } from '@/lib/hooks/use-ceiling'
import { atLeastZero, format, isNegative, micro, pctOf, sub } from '@/lib/money'

export default function TabView() {
  const {
    rows,
    balance,
    outstanding,
    holds,
    ceiling,
    perCallCap,
    flashKey,
    stale,
    streaming,
    toggleStream,
  } = useConsole()
  /*
   * The ceiling comes from the console, which polls the gateway — it used to be
   * a mock constant, so this view showed a fixed 1.0000 regardless of what the
   * engine had published. `available` is still derived here rather than taken
   * from the gateway, deliberately: recomputing it from the same three figures
   * on screen means a viewer can check the arithmetic themselves.
   */
  const available = atLeastZero(sub(sub(ceiling, outstanding), holds))
  const negative = isNegative(balance)

  const live = useIsLive()
  const { value: ceilingView } = useCeiling()

  /*
   * THIS WINDOW's spend, summed from the rows on screen.
   *
   * This tile read `0.62 / 1.00` — a hardcoded string — for its entire life,
   * beside a live balance. And the denominator was wrong too: the per-window
   * cap is 1.000000, which happened to match, but nothing tied the two.
   *
   * Debits are held as negative, so the magnitude is negated back for a
   * spend figure. Only DEBIT legs count: a refusal moved nothing, and a hold
   * is reserved rather than spent — counting either would overstate what the
   * window cap has actually consumed.
   */
  const currentWindow = windowOf(Math.floor(Date.now() / 1000), params.window.seconds)
  const windowSpend = micro(
    rows
      .filter((r) => r.window === currentWindow && r.leg === 'DEBIT')
      .reduce((sum, r) => sum + (r.amount < 0n ? -r.amount : r.amount), 0n),
  )

  /*
   * The tier, from the published ceiling — never guessed.
   *
   * This tile read a hardcoded `C`. A tier is the term the ceiling is
   * proportional to (`Unrated` carries a ×0 multiple, so no credit at all), and
   * inventing one is inventing the agent's creditworthiness. A tab the engine
   * has not run for has NO tier, which is a different fact from Unrated.
   */
  const tier = ceilingView.current?.inputs.tier
  const tierPct = tier === 'A' ? 100 : tier === 'B' ? 66 : tier === 'C' ? 33 : 0

  /** A genuine empty state: nothing has ever been filed against this tab. */
  const empty = live && rows.length === 0

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div className="tab-grid">
        <Card>
          <div data-flash={flashKey} style={{ padding: 22 }}>
            <div className="t-label" style={{ marginBottom: 6 }}>
              Running balance · USDC
            </div>
            <div>
              <Figure
                value={format(balance)}
                tone={negative ? 'debit' : 'credit'}
                size={68}
                underline={stale}
              />
            </div>
            <div
              className="t-mono"
              style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 10 }}
            >
              {/*
               * No invented age. This read `snapshot age 41s · max 15s`, two
               * numbers nothing measured — `stale` is a manual demo toggle, not
               * a measurement, so it can say the figures are stale but not how
               * stale.
               */}
              {stale
                ? `stream stopped · these figures are the last read, max age ${params.window.holdTtlSeconds}s`
                : 'USDC · 6 dp, shown to 4 · truncated, not rounded'}
            </div>
          </div>
          <div className="rule-t" style={{ padding: '18px 22px 20px' }}>
            <CapacityMeter outstanding={outstanding} holds={holds} ceiling={ceiling} />
          </div>
        </Card>

        <div className="tile-grid">
          <Tile
            label="available"
            value={format(available)}
            tone="credit"
            pct={pctOf(available, ceiling)}
          />
          <Tile label="per-call cap" value={format(perCallCap)} pct={0} />
          <Tile
            label="window spend"
            value={`${format(windowSpend)} / ${format(caps.perWindow)}`}
            pct={pctOf(windowSpend, caps.perWindow)}
          />
          <Tile label="tier" value={tier ?? 'not published'} pct={tierPct} />
        </div>
      </div>

      <Card style={{ overflow: 'hidden' }}>
        <CardHead>
          <span>This window&rsquo;s receipts</span>
          <span style={{ color: 'var(--ink-3)' }}>{rows.length} rows</span>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button type="button" onClick={toggleStream} className="btn-inline">
              {streaming ? 'Pause stream' : 'Resume stream'}
            </button>
            {/* Money-moving action, so the label carries the gate. */}
            <Link href="/app/settlements" className="btn-inline btn-inline-primary">
              Force settlement · demo mode
            </Link>
          </span>
        </CardHead>
        <div style={{ maxHeight: 400, overflowY: 'auto' }}>
          <ReceiptTable rows={rows.slice(0, 12)} />
        </div>
      </Card>

      {/*
       * The empty state — shown only when the tab genuinely has no entries.
       *
       * It used to render ALWAYS, under the heading "agent registered 4 seconds
       * ago", with a green STARTER TAB ISSUED stamp and a ceiling of 1.0000.
       * Three problems: it appeared beside a live balance with dozens of
       * receipts, nothing is "issued" because no registration flow exists, and
       * 1.0000 was v1's floor — v2 opens at 0.250000, which is the whole point
       * of v2.
       */}
      {empty ? (
        <Card style={{ padding: '20px 22px', maxWidth: 620 }}>
          <div className="t-label" style={{ marginBottom: 12 }}>
            Nothing filed against this tab yet
          </div>
          <div style={{ marginBottom: 14 }}>
            <Chip tone="caution">NO REGISTRATION FLOW</Chip>
          </div>
          <table className="tbl" style={{ marginBottom: 16 }}>
            <tbody>
              {[
                ['starter ceiling', format(caps.starterCeiling)],
                ['per-call cap', format(caps.perCall)],
                ['per-window cap', format(caps.perWindow)],
                ['tier', 'none until the engine publishes'],
              ].map(([k, v]) => (
                <tr key={k}>
                  <th
                    scope="row"
                    style={{
                      fontWeight: 400,
                      color: 'var(--ink-2)',
                      letterSpacing: 0,
                      textTransform: 'none',
                      fontSize: 12.5,
                    }}
                  >
                    {k}
                  </th>
                  <td className="n" style={{ fontWeight: 600 }}>
                    {v}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--ink-2)', margin: '0 0 16px' }}>
            The starter ceiling is a floor, not a grant — it exists so a brand-new agent can make
            its first calls at all, and earned credit passes it after three or four. Nothing has
            been issued to this tab yet, so it has no entries.
          </p>
        </Card>
      ) : null}
    </div>
  )
}

function Tile({
  label,
  value,
  tone,
  pct,
}: {
  label: string
  value: string
  tone?: 'credit'
  pct: number
}) {
  return (
    <div className="tile">
      <div className="t-label">{label}</div>
      <div
        className="t-figure"
        style={{ fontSize: 24, color: tone === 'credit' ? 'var(--credit)' : 'var(--ink)' }}
      >
        {value}
      </div>
      <div className="tile-progress" style={{ width: `${pct}%` }} />
    </div>
  )
}
