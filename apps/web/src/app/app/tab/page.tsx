'use client'

import Link from 'next/link'
import { CapacityMeter } from '@/components/console/capacity-meter'
import { useConsole } from '@/components/console/provider'
import { ReceiptTable } from '@/components/console/receipt-table'
import { Card, CardHead, Figure, Stamp } from '@/components/ui'
import { atLeastZero, format, isNegative, pctOf, sub } from '@/lib/money'
import { CEILING, PER_CALL_CAP, STARTER_TAB } from '@/lib/mock/tab'

export default function TabView() {
  const { rows, balance, outstanding, holds, flashKey, stale, streaming, toggleStream } = useConsole()
  const available = atLeastZero(sub(sub(CEILING, outstanding), holds))
  const negative = isNegative(balance)

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div className="tab-grid">
        <Card>
          <div data-flash={flashKey} style={{ padding: 22 }}>
            <div className="t-label" style={{ marginBottom: 6 }}>Running balance · USDC</div>
            <div>
              <Figure
                value={format(balance)}
                tone={negative ? 'debit' : 'credit'}
                size={68}
                underline={stale}
              />
            </div>
            <div className="t-mono" style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 10 }}>
              {stale
                ? 'snapshot age 41s · max 15s · stream dropped'
                : 'USDC · 6 dp, shown to 4 · truncated, not rounded'}
            </div>
          </div>
          <div className="rule-t" style={{ padding: '18px 22px 20px' }}>
            <CapacityMeter outstanding={outstanding} holds={holds} ceiling={CEILING} />
          </div>
        </Card>

        <div className="tile-grid">
          <Tile label="available" value={format(available)} tone="credit" pct={pctOf(available, CEILING)} />
          <Tile label="per-call cap" value={format(PER_CALL_CAP)} pct={0} />
          <Tile label="window spend" value="0.62 / 1.00" pct={62} />
          <Tile label="tier" value="C" pct={33} />
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

      {/* The first thing many operators ever see. It should feel like being
          handed a paper chit, not like an empty dashboard. */}
      <Card style={{ padding: '20px 22px', maxWidth: 600 }}>
        <div className="t-label" style={{ marginBottom: 14 }}>
          Empty state · agent registered 4 seconds ago
        </div>
        <div style={{ marginBottom: 16 }}>
          <Stamp kind="issued">STARTER TAB ISSUED</Stamp>
        </div>
        <table className="tbl" style={{ marginBottom: 16 }}>
          <tbody>
            {STARTER_TAB.map((s) => (
              <tr key={s.k}>
                <th scope="row" style={{ fontWeight: 400, color: 'var(--ink-2)', letterSpacing: 0, textTransform: 'none', fontSize: 12.5 }}>
                  {s.k}
                </th>
                <td className="n" style={{ fontWeight: 600 }}>{s.v}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" className="btn btn-primary" style={{ fontSize: 16, padding: '11px 20px', boxShadow: 'var(--shadow-sm)' }}>
          Make the first spend
        </button>
      </Card>
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
      <div className="t-figure" style={{ fontSize: 24, color: tone === 'credit' ? 'var(--credit)' : 'var(--ink)' }}>
        {value}
      </div>
      <div className="tile-progress" style={{ width: `${pct}%` }} />
    </div>
  )
}
