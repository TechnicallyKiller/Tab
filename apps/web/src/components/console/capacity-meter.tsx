'use client'

import { atLeastZero, format, type MicroUsdc, pctOf, sub } from '@/lib/money'

/**
 * The most important component in the app: outstanding solid, pending holds
 * hatched, remaining available sunk.
 *
 * The hatching is load-bearing. A hold is money reserved but not yet spent, and
 * hatching is how a drawing says "provisional" — colour alone cannot express it,
 * and this is also the only ambient loop permitted anywhere in the product.
 */
export function CapacityMeter({
  outstanding,
  holds,
  ceiling,
}: {
  outstanding: MicroUsdc
  holds: MicroUsdc
  ceiling: MicroUsdc
}) {
  const outPct = pctOf(outstanding, ceiling)
  const holdPct = pctOf(holds, ceiling)
  const available = atLeastZero(sub(sub(ceiling, outstanding), holds))

  return (
    <div>
      <div className="t-label" style={{ marginBottom: 10 }}>
        Capacity against the ceiling
      </div>
      <div
        style={{
          display: 'flex',
          height: 22,
          border: 'var(--bw) solid var(--ink)',
          borderRadius: 2,
          overflow: 'hidden',
          background: 'var(--sunk)',
        }}
        role="img"
        aria-label={`Outstanding ${format(outstanding)}, held ${format(holds)}, of ceiling ${format(ceiling)}`}
      >
        <div
          style={{
            width: `${outPct}%`,
            background: 'var(--debit)',
            transition: 'width var(--settle)',
          }}
        />
        <div
          className="hatch"
          style={{
            width: `${holdPct}%`,
            borderLeft: 'var(--bw) solid var(--ink)',
            transition: 'width var(--settle)',
          }}
        />
        <div style={{ flex: 1, borderLeft: 'var(--bw) solid var(--ink)' }} />
      </div>
      <div
        className="t-mono"
        style={{
          fontSize: 12.5,
          color: 'var(--ink-2)',
          marginTop: 10,
          display: 'flex',
          flexWrap: 'wrap',
          gap: '4px 16px',
        }}
      >
        <span>
          outstanding <b style={{ color: 'var(--debit)' }}>{format(outstanding)}</b>
        </span>
        <span>
          held <b>{format(holds)}</b>
        </span>
        <span>
          available <b style={{ color: 'var(--credit)' }}>{format(available)}</b>
        </span>
        <span>
          ceiling <b style={{ color: 'var(--pen)' }}>{format(ceiling)}</b>
        </span>
      </div>
    </div>
  )
}
