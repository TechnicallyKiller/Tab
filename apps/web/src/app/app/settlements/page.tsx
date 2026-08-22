'use client'

import { useState } from 'react'
import { Card, CardHead, Chip } from '@/components/ui'
import { format, formatBpPercent } from '@/lib/money'
import { RECONCILIATION, SETTLEMENTS } from '@/lib/mock/settlements'
import type { Outcome, Settlement } from '@/lib/mock/types'

function outcomeTone(o: Outcome) {
  if (o === 'CLEAN') return 'clean' as const
  if (o === 'MISSED') return 'caution' as const
  return 'dim' as const
}

export default function SettlementsView() {
  const [open, setOpen] = useState<string | null>('0147')
  const expanded = SETTLEMENTS.find((s) => s.window === open)
  const clean = RECONCILIATION.repaired === 0 && RECONCILIATION.checked === RECONCILIATION.matched

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
        <span className="t-label">Reconciliation · Mirror Node vs receipt topic</span>
        <span className="t-figure" style={{ fontSize: 16 }}>
          checked {RECONCILIATION.checked} · matched {RECONCILIATION.matched} · repaired{' '}
          {RECONCILIATION.repaired}
        </span>
        <Chip tone={clean ? 'clean' : 'caution'}>{clean ? 'CLEAN' : 'REPAIRED'}</Chip>
      </Card>

      <Card style={{ overflow: 'hidden' }}>
        <div className="tbl-scroll">
          <table className="tbl" style={{ minWidth: 900 }}>
            <thead>
              <tr>
                <th scope="col">Window</th>
                <th scope="col">Range</th>
                <th scope="col" className="n">Credits</th>
                <th scope="col" className="n">Debits</th>
                <th scope="col" className="n">Interest</th>
                <th scope="col" className="n">Net</th>
                <th scope="col">Ramp</th>
                <th scope="col">Outcome</th>
              </tr>
            </thead>
            <tbody>
              {SETTLEMENTS.map((s) => (
                <tr
                  key={s.window}
                  onClick={() => setOpen(open === s.window ? null : s.window)}
                  style={{ cursor: 'pointer', background: open === s.window ? 'var(--pen-soft)' : undefined }}
                >
                  <td style={{ fontWeight: 600 }}>{s.window}</td>
                  <td style={{ color: 'var(--ink-3)' }}>{s.range}</td>
                  <td className="n" style={{ color: 'var(--credit)' }}>{format(s.credits)}</td>
                  <td className="n" style={{ color: 'var(--debit)' }}>{format(s.debits)}</td>
                  <td className="n" style={{ color: 'var(--ink-2)' }}>{format(s.interest)}</td>
                  <td className="n" style={{ fontWeight: 600, color: s.net < 0n ? 'var(--debit)' : 'var(--credit)' }}>
                    {format(s.net, { sign: 'always' })}
                  </td>
                  <td style={{ color: 'var(--ink-2)' }}>{formatBpPercent(s.rampFromBp, 0)} → {formatBpPercent(s.rampToBp, 0)}</td>
                  <td><Chip tone={outcomeTone(s.outcome)}>{s.outcome}</Chip></td>
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
function Netting({ s }: { s: Settlement }) {
  const rows: [string, string, string, number][] = [
    ['credits', format(s.credits, { sign: 'always' }), 'var(--credit)', 400],
    ['debits', format(s.debits, { sign: 'always' }), 'var(--debit)', 400],
    ['interest', format(s.interest), 'var(--ink-2)', 400],
    ['net transfer', format(s.net, { sign: 'always' }), 'var(--ink)', 600],
  ]
  return (
    <div className="rule-t" style={{ background: 'var(--sunk)', padding: 20, display: 'flex', flexWrap: 'wrap', gap: 40 }}>
      <div>
        <div className="t-label" style={{ marginBottom: 10 }}>Netting · window {s.window}</div>
        <table className="t-mono" style={{ fontSize: 14, minWidth: 280 }}>
          <tbody>
            {rows.map(([k, v, colour, weight], i) => (
              <tr
                key={k}
                style={{
                  borderBottom:
                    i === 2 ? 'var(--bw) solid var(--ink)' : i === 3 ? '4px double var(--ink)' : '1px solid var(--rule-soft)',
                }}
              >
                <th scope="row" style={{ textAlign: 'left', padding: '6px 20px 6px 0', fontWeight: weight, color: colour }}>
                  {k}
                </th>
                <td style={{ textAlign: 'right', padding: '6px 0', fontWeight: weight, color: colour }}>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="t-mono" style={{ fontSize: 14, lineHeight: 2, color: 'var(--ink-2)' }}>
        <div className="t-figure" style={{ fontSize: 24, color: 'var(--ink)' }}>
          {s.receiptCount} receipts → 1 transfer
        </div>
        <div>
          transfer id{' '}
          {s.transferId === '—' ? (
            <span style={{ color: 'var(--ink-3)' }}>none — window missed</span>
          ) : (
            <a href="https://hashscan.io/testnet" style={{ color: 'var(--pen)' }}>{s.transferId} ↗</a>
          )}
        </div>
        <div>float account touched once</div>
      </div>
    </div>
  )
}
