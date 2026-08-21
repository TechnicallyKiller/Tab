'use client'

import { useMemo, useState } from 'react'
import { useConsole } from '@/components/console/provider'
import { Card, Hazard, Hops, Stamp } from '@/components/ui'
import { REFUSALS, RULE_COUNTS } from '@/lib/mock/refusals'

/**
 * Not an error log. The product demonstrating that it works, and the strongest
 * visual treatment in the app — this is what is on screen at 1:10 in the demo.
 *
 * Cards, not a table, because each refusal is an argument and needs room: the
 * rule that fired, a plain sentence, and the evidence rendered.
 */
export default function RefusalsView() {
  const { refusalStamp } = useConsole()
  const [rule, setRule] = useState('ALL')

  const visible = useMemo(
    () => (rule === 'ALL' ? REFUSALS : REFUSALS.filter((r) => r.rule === rule)),
    [rule],
  )

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      {/* Counts per rule turn the filter bar into a summary of what the engine catches. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {RULE_COUNTS.map(([label, count]) => {
          const active = rule === label
          return (
            <button
              key={label}
              type="button"
              onClick={() => setRule(label)}
              aria-pressed={active}
              className="t-mono"
              style={{
                fontSize: 11,
                letterSpacing: '0.06em',
                padding: '6px 12px',
                border: 'var(--bw) solid var(--ink)',
                borderRadius: 2,
                cursor: 'pointer',
                background: active ? 'var(--ink)' : 'var(--surface)',
                color: active ? 'var(--paper)' : 'var(--ink)',
                display: 'inline-flex',
                gap: 8,
                alignItems: 'center',
              }}
            >
              <span>{label}</span>
              <span style={{ fontVariantNumeric: 'tabular-nums', color: active ? 'var(--caution)' : 'var(--ink-3)' }}>
                {count}
              </span>
            </button>
          )
        })}
      </div>

      {visible.length === 0 ? (
        <Card style={{ padding: 40, textAlign: 'center' }}>
          <div className="t-label" style={{ marginBottom: 8 }}>No refusals under this rule</div>
          <p style={{ fontSize: 14, color: 'var(--ink-2)', margin: 0 }}>
            Nothing has fired this rule in the current window. That is the engine working, not a gap in the data.
          </p>
        </Card>
      ) : (
        visible.map((r, i) => (
          <Card key={r.seq} style={{ position: 'relative', overflow: 'hidden' }}>
            <Hazard />
            <div style={{ padding: '18px 22px 20px' }}>
              <span
                className="chip chip-caution"
                style={{ fontSize: 12.5, padding: '5px 12px', borderWidth: 'var(--bw)', marginBottom: 14 }}
              >
                {r.rule} · {r.ruleDetail}
              </span>
              <p style={{ fontSize: 16, lineHeight: 1.65, margin: '0 0 16px', maxWidth: '64ch' }}>
                {r.sentence}
              </p>
              <div style={{ background: 'var(--sunk)', border: 'var(--bw) solid var(--ink)', borderRadius: 2, padding: 14 }}>
                <Hops hops={r.evidence} />
              </div>
              <div
                className="t-mono"
                style={{ fontSize: 11, letterSpacing: '0.06em', color: 'var(--ink-3)', marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: 16 }}
              >
                <span>{r.consensus}</span>
                <span>seq {r.seq}</span>
                <span style={{ color: 'var(--credit)', fontWeight: 600 }}>float untouched</span>
              </div>
            </div>
            {/* Only the newest card stamps, and only on live arrival. */}
            <Stamp
              kind="refused"
              active={i === 0 ? refusalStamp : 'off'}
              style={{ position: 'absolute', right: 24, bottom: 22 }}
            >
              REFUSED
            </Stamp>
          </Card>
        ))
      )}
    </div>
  )
}
