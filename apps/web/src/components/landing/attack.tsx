'use client'

import { useEffect, useRef, useState } from 'react'
import { OPEN_GAPS } from '@/lib/mock/landing'
import { Hops, Stamp } from '@/components/ui'

/**
 * The emotional peak: we break our own design on camera.
 *
 * Scrolling into view illuminates the funding edge and slams the ceiling plane
 * down to zero. The refusal card stamps in 420ms later, once, no pulse.
 *
 * The OPEN gaps sit immediately below at the same visual weight. Publishing them
 * is what makes the caught attack credible, so they are not tucked behind a fold.
 */
export function Attack() {
  const host = useRef<HTMLElement>(null)
  const [fired, setFired] = useState(false)
  const [stamp, setStamp] = useState('off')

  useEffect(() => {
    const el = host.current
    if (!el || fired) return
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue
          setFired(true)
          setTimeout(() => setStamp(`on${Date.now()}`), 420)
          io.disconnect()
        }
      },
      { threshold: 0.3 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [fired])

  // The ceiling plane's y position. Collapsing to zero means moving up to meet
  // the wire, which is what stops the next spend dead.
  const ceilY = fired ? 146 : 214

  return (
    <section
      id="attack"
      ref={host}
      className="rule-b"
      style={{ background: 'var(--ink)', color: 'var(--paper)', padding: '88px 28px' }}
    >
      <div style={{ maxWidth: 1240, margin: '0 auto' }}>
        <div className="t-label" style={{ color: 'var(--caution)', marginBottom: 14 }}>
          We broke it on purpose
        </div>
        <h2 className="t-display" style={{ fontSize: 'clamp(32px,4.6vw,68px)', margin: '0 0 40px', maxWidth: '20ch' }}>
          The agent bought from a seller it controls.
        </h2>

        <div className="attack-grid">
          <div style={{ border: 'var(--bw) solid var(--paper)', borderRadius: 2, padding: 22, background: 'var(--deep)' }}>
            <svg viewBox="0 0 620 320" style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="The ceiling collapses to zero and the next spend is refused">
              <g stroke="var(--rail-rule)" strokeWidth={1}>
                <path d="M0 250 L620 250" />
                <path d="M0 274 L620 274" />
                <path d="M0 302 L620 302" />
              </g>
              <line x1={24} y1={120} x2={596} y2={120} stroke="var(--rail-fg)" strokeWidth={2.5} />
              <text x={24} y={112} fontFamily="IBM Plex Mono, monospace" fontSize={11} fill="var(--rail-fg-mute)">ZERO</text>
              <path d="M24 120 C 120 120 150 176 232 190 C 300 202 340 176 392 150" fill="none" stroke="#F0846C" strokeWidth={7} strokeLinecap="round" />
              <path d="M392 150 L440 150" fill="none" stroke="#F0846C" strokeWidth={7} strokeLinecap="round" strokeDasharray="4 10" opacity={0.5} />
              <rect x={24} y={ceilY} width={572} height={7} fill="#9DB4F7" opacity={0.18} style={{ transition: 'y var(--settle)' }} />
              <line x1={24} y1={ceilY + 3.5} x2={596} y2={ceilY + 3.5} stroke="#9DB4F7" strokeWidth={2.5} style={{ transition: 'y1 var(--settle), y2 var(--settle)' }} />
              <text x={596} y={ceilY - 6} textAnchor="end" fontFamily="IBM Plex Mono, monospace" fontSize={12} fill="#9DB4F7" style={{ transition: 'y var(--settle)' }}>
                {fired ? 'CEILING 0.0000 — COLLAPSED' : 'CEILING 1.0000'}
              </text>
              {fired ? (
                <>
                  <circle cx={440} cy={150} r={9} fill="none" stroke="var(--caution)" strokeWidth={3} />
                  <text x={452} y={146} fontFamily="IBM Plex Mono, monospace" fontSize={11} fill="var(--caution)">next spend stops dead</text>
                </>
              ) : null}
            </svg>
            <div style={{ marginTop: 20 }}>
              <Hops
                hops={[
                  { label: 'agent 0.0.4482091', arrow: '→' },
                  { label: '0.0.5300118', arrow: '→' },
                  { label: 'seller 0.0.5591204', tone: 'bad' },
                ]}
              />
            </div>
          </div>

          <div
            style={{
              position: 'relative',
              border: 'var(--bw) solid var(--paper)',
              borderRadius: 2,
              background: 'var(--surface)',
              color: 'var(--ink)',
              overflow: 'hidden',
              boxShadow: '8px 8px 0 var(--caution)',
            }}
          >
            <div className="hazard" />
            <div style={{ padding: '20px 22px 26px' }}>
              <span className="chip chip-caution" style={{ fontSize: 12.5, padding: '5px 12px', borderWidth: 'var(--bw)', marginBottom: 16, display: 'inline-block' }}>
                CONTROL_CLUSTER · funding ancestry ≤ 3 hops
              </span>
              <p style={{ fontSize: 16, lineHeight: 1.65, margin: '0 0 18px', maxWidth: '52ch' }}>
                Spend of <span className="t-mono" style={{ fontWeight: 600 }}>$0.0400</span> to{' '}
                <span className="t-mono" style={{ fontWeight: 600 }}>0.0.5591204</span> refused. The agent
                funded this seller two hops back, so the purchase would be self-dealing and the revenue
                would not be real.
              </p>
              <div className="t-mono" style={{ fontSize: 11, letterSpacing: '0.06em', color: 'var(--ink-3)', display: 'flex', flexWrap: 'wrap', gap: 14 }}>
                <span>1755738201.446920113</span>
                <span>seq 41 894</span>
                <span style={{ color: 'var(--credit)', fontWeight: 600 }}>float untouched</span>
              </div>
            </div>
            <Stamp kind="refused" active={stamp} style={{ position: 'absolute', right: 22, bottom: 20 }}>
              REFUSED
            </Stamp>
          </div>
        </div>

        <p style={{ fontSize: 19, lineHeight: 1.6, color: 'var(--rule-soft)', maxWidth: '62ch', margin: '36px 0 56px' }}>
          The graph caught a seller the agent controls. The ceiling collapsed mid-window and the next
          spend was refused. The float was never touched.
        </p>

        <div style={{ borderTop: 'var(--bw) solid var(--paper)', paddingTop: 32 }}>
          <h3 className="t-display" style={{ fontSize: 32, margin: '0 0 8px' }}>What still gets through</h3>
          <p style={{ fontSize: 16, color: 'var(--rule-soft)', margin: '0 0 24px', maxWidth: '60ch' }}>
            Publishing the gaps is what makes the caught attacks credible.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 20 }}>
            {OPEN_GAPS.map((g) => (
              <div key={g.title} style={{ border: 'var(--bw) solid var(--caution)', borderRadius: 2, padding: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <span className="t-display-700" style={{ fontSize: 19 }}>{g.title}</span>
                  <span className="chip" style={{ borderColor: 'var(--caution)', color: 'var(--caution)', background: 'transparent' }}>
                    {g.status}
                  </span>
                </div>
                <p style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--rule-soft)', margin: 0 }}>{g.body}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
