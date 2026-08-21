'use client'

import { useState } from 'react'
import { TIER_HARD_CAP, TIER_MULTIPLE } from '@/lib/mock/landing'

/**
 * Drive the ceiling yourself. The figure flashes on change and the digits never
 * animate — a count-up on money is exactly the decoration the design forbids.
 *
 * Set tier to Unrated and the ceiling reads 0.0000, because the multiple is 0.
 * That is the mechanism, and letting a reader find it beats asserting it.
 */
export function CeilingPlayground() {
  const [rev, setRev] = useState(0.334)
  const [tier, setTier] = useState('C')
  const [ramp, setRamp] = useState(30)
  const [flash, setFlash] = useState('none')

  const multiple = TIER_MULTIPLE[tier] ?? 0
  const cap = TIER_HARD_CAP[tier] ?? 0
  const raw = rev * multiple * (ramp / 100)
  const clamped = Math.min(raw, cap)
  // A tab below its starter floor is raised to the floor unless it is Unrated.
  const inForce = tier !== 'Unrated' && clamped < 1 ? 1 : clamped

  const binding =
    tier === 'Unrated'
      ? 'tier multiple 0 — no ceiling at all'
      : raw > cap
        ? `hard cap, tier ${tier} — binding`
        : clamped < 1
          ? 'starter floor 1.0000 — binding'
          : 'computed value — binding'

  const bump = (next: number, previous: number) =>
    setFlash(`${next < previous ? 'debit' : 'credit'}${Date.now()}`)

  return (
    <div className="card">
      <div className="card-head">Drive it yourself</div>
      <div style={{ padding: '22px 20px', display: 'grid', gap: 18 }}>
        <div>
          <SliderLabel left="trailing revenue" right={`${rev.toFixed(4)} USDC`} />
          <input
            type="range" min={0} max={2} step={0.001} value={rev}
            aria-label="Trailing attested revenue per window"
            onChange={(e) => {
              const v = Number(e.target.value)
              bump(v, rev)
              setRev(v)
            }}
          />
        </div>
        <div>
          <SliderLabel left="tier" right={`${tier} · ${multiple.toFixed(1)}×`} />
          <div className="seg">
            {['A', 'B', 'C', 'Unrated'].map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={tier === t}
                onClick={() => {
                  bump(TIER_MULTIPLE[t] ?? 0, multiple)
                  setTier(t)
                }}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
        <div>
          <SliderLabel left="ramp" right={`${ramp}%`} />
          <input
            type="range" min={15} max={100} step={5} value={ramp}
            aria-label="Ramp factor"
            onChange={(e) => {
              const v = Number(e.target.value)
              bump(v, ramp)
              setRamp(v)
            }}
          />
        </div>
      </div>
      <div className="rule-t" data-flash={flash} style={{ padding: 20 }}>
        <div className="t-label" style={{ marginBottom: 4 }}>Ceiling in force · USDC</div>
        <div
          className="t-figure"
          style={{
            fontSize: 'clamp(36px,5vw,68px)',
            color: inForce === 0 ? 'var(--debit)' : 'var(--pen)',
          }}
        >
          {inForce.toFixed(4)}
        </div>
        <div className="t-mono" style={{ fontSize: 12.5, color: 'var(--ink-2)', marginTop: 10 }}>
          {binding}
        </div>
      </div>
    </div>
  )
}

function SliderLabel({ left, right }: { left: string; right: string }) {
  return (
    <div className="t-label" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
      <span>{left}</span>
      <span style={{ color: 'var(--ink)', fontSize: 12.5, letterSpacing: 0 }}>{right}</span>
    </div>
  )
}
