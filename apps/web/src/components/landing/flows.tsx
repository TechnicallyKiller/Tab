'use client'

import { useEffect, useRef, useState } from 'react'
import { FLOWS } from '@/lib/mock/landing'
import { useReducedMotion } from '@/lib/hooks/use-reduced-motion'
import { EarnDiagram, SettleDiagram, SpendDiagram } from './diagrams'

/**
 * The three flows, scroll-choreographed. A sticky viewport holds while three
 * spacer blocks pass an IntersectionObserver — scroll drives state, we never
 * hijack the wheel, so the page stays scrollable by keyboard and trackpad alike.
 *
 * On reduced motion the three states render stacked and static instead.
 */
export function Flows() {
  const [state, setState] = useState(0)
  const [dot, setDot] = useState(0)
  const spacers = useRef<(HTMLDivElement | null)[]>([])
  const reduced = useReducedMotion()

  useEffect(() => {
    if (reduced) return
    const t = setInterval(() => setDot((d) => (d + 1) % 60), 60)
    return () => clearInterval(t)
  }, [reduced])

  useEffect(() => {
    if (reduced) return
    const els = spacers.current.filter(Boolean) as HTMLDivElement[]
    if (els.length < 3) return
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue
          const i = els.indexOf(e.target as HTMLDivElement)
          if (i >= 0) setState(i)
        }
      },
      { rootMargin: '-45% 0px -45% 0px' },
    )
    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [reduced])

  const t = dot / 60
  const flow = FLOWS[state]!

  if (reduced) {
    return (
      <section id="flows" className="rule-b">
        <div style={{ maxWidth: 1240, margin: '0 auto', padding: '80px 28px' }}>
          <div className="t-label" style={{ marginBottom: 14 }}>The mechanism · three flows</div>
          <h2 className="t-display" style={{ fontSize: 'clamp(32px,4.4vw,68px)', margin: '0 0 40px', maxWidth: '20ch' }}>
            A gateway on both legs of the agent&rsquo;s economic life.
          </h2>
          <div style={{ display: 'grid', gap: 28 }}>
            {FLOWS.map((f, i) => (
              <div key={f.kicker} className="card" style={{ padding: 20 }}>
                <div className="t-label" style={{ marginBottom: 12 }}>{f.label}</div>
                <div style={{ height: 300 }}>
                  {i === 0 ? <SpendDiagram dotX={310} balance="−0.4821" /> : null}
                  {i === 1 ? <EarnDiagram dotX={310} balance="+0.0250" /> : null}
                  {i === 2 ? <SettleDiagram collapsed /> : null}
                </div>
                <h3 className="t-display" style={{ fontSize: 28, margin: '18px 0 10px' }}>{f.title}</h3>
                <p style={{ fontSize: 17, color: 'var(--ink-2)', maxWidth: '52ch', margin: 0 }}>{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    )
  }

  return (
    <section id="flows" className="rule-b" style={{ position: 'relative' }}>
      <div style={{ maxWidth: 1240, margin: '0 auto', padding: '80px 28px 0' }}>
        <div className="t-label" style={{ marginBottom: 14 }}>The mechanism · three flows</div>
        <h2 className="t-display" style={{ fontSize: 'clamp(32px,4.4vw,68px)', margin: 0, maxWidth: '20ch' }}>
          A gateway on both legs of the agent&rsquo;s economic life.
        </h2>
      </div>

      <div style={{ position: 'sticky', top: 56, zIndex: 10, background: 'var(--paper)' }}>
        <div className="flows-grid">
          <div className="card" style={{ position: 'relative', padding: 20, minHeight: 340 }}>
            <div className="t-label" style={{ position: 'absolute', top: 14, left: 20, zIndex: 2 }}>
              {flow.label}
            </div>
            <div style={{ position: 'relative', height: 300, marginTop: 18 }}>
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  style={{
                    position: 'absolute',
                    inset: 0,
                    opacity: state === i ? 1 : 0,
                    transition: 'opacity var(--settle)',
                    pointerEvents: 'none',
                  }}
                >
                  {i === 0 ? <SpendDiagram dotX={150 + t * 314} balance="−0.4821" /> : null}
                  {i === 1 ? <EarnDiagram dotX={464 - t * 314} balance="+0.0250" /> : null}
                  {i === 2 ? <SettleDiagram collapsed={state === 2} /> : null}
                </div>
              ))}
            </div>
          </div>

          <div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 22 }}>
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  style={{
                    width: 34,
                    height: 6,
                    background: state === i ? 'var(--ink)' : 'var(--surface)',
                    border: '2px solid var(--ink)',
                    borderRadius: 1,
                  }}
                />
              ))}
            </div>
            <div className="t-label" style={{ color: 'var(--pen)', marginBottom: 10 }}>{flow.kicker}</div>
            <h3 className="t-display" style={{ fontSize: 'clamp(28px,3.2vw,44px)', margin: '0 0 18px' }}>
              {flow.title}
            </h3>
            <p style={{ fontSize: 19, lineHeight: 1.6, color: 'var(--ink-2)', maxWidth: '46ch', margin: '0 0 20px' }}>
              {flow.body}
            </p>
            <div
              style={{
                borderLeft: 'var(--bw) solid var(--pen)',
                paddingLeft: 16,
                fontSize: 16,
                lineHeight: 1.65,
                maxWidth: '46ch',
                fontStyle: 'italic',
              }}
            >
              {flow.caption}
            </div>
          </div>
        </div>
      </div>

      {[0, 1, 2].map((i) => (
        <div key={i} ref={(el) => { spacers.current[i] = el }} style={{ height: '80vh' }} aria-hidden="true" />
      ))}
    </section>
  )
}
