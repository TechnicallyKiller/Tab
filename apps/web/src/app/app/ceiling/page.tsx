'use client'

import { useState } from 'react'
import { Card, CardHead, Chip, Stamp } from '@/components/ui'
import {
  BINDING_NOTE,
  CEILING_HISTORY,
  CEILING_ROWS,
  CEILING_SEQ,
  INPUT_HASH,
  MODEL_VERSION,
  TOPICS,
} from '@/lib/mock/tab'
import { seq as fmtSeq } from '@/lib/format'
import type { CeilingRow } from '@/lib/mock/types'

/** Rule weight carries the arithmetic, so the table reads as a calculation. */
function ruleFor(row: CeilingRow): string {
  if (row.emphasis === 'result') return '0'
  if (row.emphasis === 'total') return 'var(--bw) solid var(--ink)'
  if (row.binding) return '4px double var(--ink)'
  return '1px solid var(--rule-soft)'
}

export default function CeilingView() {
  const [verified, setVerified] = useState(false)

  return (
    <div className="ceiling-grid">
      <div style={{ display: 'grid', gap: 20 }}>
        <Card style={{ overflow: 'hidden' }}>
          <CardHead title="Inputs in force" />
          <table className="tbl" style={{ fontSize: 14 }}>
            <tbody>
              {CEILING_ROWS.map((row) => {
                const strong = row.emphasis === 'result' || row.emphasis === 'term'
                return (
                  <tr key={row.label} style={{ background: 'transparent' }}>
                    <th
                      scope="row"
                      style={{
                        textAlign: 'left',
                        padding: '9px 16px',
                        borderBottom: ruleFor(row),
                        fontWeight: strong ? 600 : 400,
                        color:
                          row.emphasis === 'result'
                            ? 'var(--pen)'
                            : row.emphasis === 'sub'
                              ? 'var(--ink-3)'
                              : 'var(--ink)',
                        letterSpacing: 0,
                        textTransform: 'none',
                        fontSize: 14,
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      {row.label}
                    </th>
                    <td
                      className="n"
                      style={{
                        padding: '9px 16px',
                        borderBottom: ruleFor(row),
                        fontWeight: strong ? 600 : 400,
                        color:
                          row.emphasis === 'result'
                            ? 'var(--pen)'
                            : row.emphasis === 'sub'
                              ? 'var(--ink-3)'
                              : 'var(--ink)',
                      }}
                    >
                      {row.value}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {/* Which constraint actually bound — the most useful fact here. */}
          <div className="rule-t" style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <Chip tone="caution">BINDING</Chip>
            <span className="t-mono" style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>{BINDING_NOTE}</span>
          </div>
        </Card>

        <Card>
          <CardHead title="Ceiling history · stepped, because a ceiling changes discretely" />
          <div style={{ padding: '20px 16px' }}>
            <svg viewBox="0 0 720 250" style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="Stepped ceiling history for the last twelve windows">
              <g stroke="var(--rule-soft)" strokeWidth={1}>
                {[30, 75, 120, 165, 210].map((y) => (
                  <line key={y} x1={66} y1={y} x2={706} y2={y} />
                ))}
              </g>
              <g fontFamily="IBM Plex Mono, monospace" fontSize={11} fill="var(--ink-3)">
                {[['2.0000', 34], ['1.5000', 79], ['1.0000', 124], ['0.5000', 169], ['0.0000', 214]].map(
                  ([label, y]) => (
                    <text key={String(y)} x={8} y={y as number}>{label}</text>
                  ),
                )}
              </g>
              <path d={CEILING_HISTORY.path} fill="none" stroke="var(--ink)" strokeWidth={2.5} />
              <circle cx={CEILING_HISTORY.endpoint.x} cy={CEILING_HISTORY.endpoint.y} r={5} fill="var(--pen)" stroke="var(--ink)" strokeWidth={2.5} />
              <g fontFamily="IBM Plex Mono, monospace" fontSize={10}>
                {CEILING_HISTORY.annotations.map((a) => (
                  <text key={a.text} x={a.x} y={a.y} fill={a.tone === 'debit' ? 'var(--debit)' : 'var(--ink-3)'}>
                    {a.text}
                  </text>
                ))}
              </g>
            </svg>
          </div>
        </Card>
      </div>

      {/* The no-smart-contract argument, made operable. */}
      <Card>
        <CardHead title="Verify · no contract required" />
        <div style={{ padding: 18, display: 'grid', gap: 14 }}>
          <div>
            <div className="t-label" style={{ marginBottom: 4 }}>MODEL_VERSION</div>
            <div className="t-mono" style={{ fontSize: 14, fontWeight: 600 }}>{MODEL_VERSION}</div>
          </div>
          <div
            style={{
              border: `var(--bw) solid ${verified ? 'var(--credit)' : 'var(--ink)'}`,
              borderRadius: 2,
              padding: 12,
              background: 'var(--sunk)',
              position: 'relative',
              overflow: 'hidden',
              minHeight: 92,
            }}
          >
            <div className="t-label" style={{ marginBottom: 6 }}>Canonical input hash</div>
            <div className="t-mono" style={{ fontSize: 12.5, wordBreak: 'break-all', lineHeight: 1.6 }}>
              {INPUT_HASH}
            </div>
            {verified ? (
              <Stamp kind="verified" active="on1" style={{ position: 'absolute', right: 12, bottom: 10, fontSize: 19, padding: '2px 10px', borderWidth: 3 }}>
                VERIFIED
              </Stamp>
            ) : null}
          </div>
          <div className="t-mono" style={{ fontSize: 12.5, color: 'var(--ink-2)', display: 'flex', justifyContent: 'space-between' }}>
            <span>HCS sequence</span>
            <a href={`https://hashscan.io/testnet/topic/${TOPICS.ceilings}`} style={{ color: 'var(--pen)' }}>
              {fmtSeq(CEILING_SEQ)} ↗
            </a>
          </div>
          <button type="button" className="btn btn-primary" onClick={() => setVerified((v) => !v)}>
            {verified ? 'Recomputed · matches HCS' : 'Recompute and verify'}
          </button>
          <p style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--ink-2)', margin: 0 }}>
            Recompute the ceiling from the published inputs and compare against the hash on HCS. This is
            the no-smart-contract argument made operable.
          </p>
        </div>
      </Card>
    </div>
  )
}
