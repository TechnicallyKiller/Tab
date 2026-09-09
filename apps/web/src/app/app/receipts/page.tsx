'use client'

import { useMemo, useState } from 'react'
import { useConsole } from '@/components/console/provider'
import { ReceiptTable } from '@/components/console/receipt-table'
import { Card, CardHead } from '@/components/ui'
import type { Leg } from '@/lib/mock/types'

const LEGS: (Leg | 'ALL')[] = ['ALL', 'DEBIT', 'CREDIT', 'REFUSED']

export default function ReceiptsView() {
  const { rows, streaming, toggleStream } = useConsole()
  const [leg, setLeg] = useState<Leg | 'ALL'>('ALL')
  const [attestedOnly, setAttestedOnly] = useState(false)

  const visible = useMemo(() => {
    let out = rows
    if (leg !== 'ALL') out = out.filter((r) => r.leg === leg)
    if (attestedOnly) out = out.filter((r) => r.attested)
    return out
  }, [rows, leg, attestedOnly])

  return (
    <Card style={{ overflow: 'hidden' }}>
      <CardHead>
        <span>Filter</span>
        <div className="seg">
          {LEGS.map((l) => (
            <button key={l} type="button" aria-pressed={leg === l} onClick={() => setLeg(l)}>
              {l}
            </button>
          ))}
        </div>
        <label
          className="t-mono"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 12.5,
            cursor: 'pointer',
            letterSpacing: 0,
            textTransform: 'none',
          }}
        >
          <input
            type="checkbox"
            checked={attestedOnly}
            onChange={() => setAttestedOnly((v) => !v)}
          />
          attested only
        </label>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className="t-mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
            {visible.length} of {rows.length}
          </span>
          <button type="button" onClick={toggleStream} className="btn-inline">
            {streaming ? 'Pause stream' : 'Resume stream'}
          </button>
        </span>
      </CardHead>
      {visible.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-3)' }}>
          <div className="t-label" style={{ marginBottom: 8 }}>
            No receipts match
          </div>
          <p style={{ fontSize: 14, margin: 0 }}>
            Clear the filter, or wait for the next arrival on this leg.
          </p>
        </div>
      ) : (
        <ReceiptTable rows={visible} />
      )}
    </Card>
  )
}
