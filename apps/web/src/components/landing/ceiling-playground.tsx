'use client'

import { useState } from 'react'
import {
  bp,
  format,
  formatBpMultiple,
  formatBpPercent,
  micro,
  min,
  mulBp,
  usdc,
  type BasisPoints,
  type MicroUsdc,
} from '@/lib/money'
import { TIER_HARD_CAP, TIER_MULTIPLE_BP } from '@/lib/mock/landing'

const STARTER_FLOOR = usdc('1.0000')

/**
 * Drive the ceiling yourself.
 *
 * This runs the real formula, in bigint micro-USDC with integer basis points —
 * not floats. The marketing page and the engine have to agree on the arithmetic
 * or the interactive is a lie, and rounding a ceiling down by a micro-USDC in
 * one place and not the other is exactly the divergence ADR-0006 exists to stop.
 *
 * Rounding is 'down' throughout: a ceiling is a limit, so an inexact result
 * resolves in the house's favour, never the agent's.
 *
 * The figure flashes on change and the digits never animate — a count-up on
 * money is the decoration the design forbids.
 */
export function CeilingPlayground() {
  const [revenueMicro, setRevenueMicro] = useState<MicroUsdc>(usdc('0.3340'))
  const [tier, setTier] = useState('C')
  const [rampBp, setRampBp] = useState<BasisPoints>(bp(3000))
  const [flash, setFlash] = useState('none')

  const multipleBp = TIER_MULTIPLE_BP[tier] ?? bp(0)
  const hardCap = TIER_HARD_CAP[tier] ?? usdc('0.0000')

  const computed = mulBp(mulBp(revenueMicro, multipleBp, 'down'), rampBp, 'down')
  const clamped = min(computed, hardCap)
  // A tab below its starter floor is raised to the floor — unless it is Unrated,
  // where the multiple is zero and there is no ceiling at all.
  const inForce = tier !== 'Unrated' && clamped < STARTER_FLOOR ? STARTER_FLOOR : clamped

  const binding =
    tier === 'Unrated'
      ? 'tier multiple 0 — no ceiling at all'
      : computed > hardCap
        ? `hard cap, tier ${tier} — binding`
        : clamped < STARTER_FLOOR
          ? 'starter floor 1.0000 — binding'
          : 'computed value — binding'

  const bump = (next: bigint, previous: bigint) =>
    setFlash(`${next < previous ? 'debit' : 'credit'}${Date.now()}`)

  return (
    <div className="card">
      <div className="card-head">Drive it yourself</div>
      <div style={{ padding: '22px 20px', display: 'grid', gap: 18 }}>
        <div>
          <SliderLabel left="trailing revenue" right={`${format(revenueMicro)} USDC`} />
          <input
            type="range"
            min={0}
            max={2_000_000}
            step={1000}
            value={Number(revenueMicro)}
            aria-label="Trailing attested revenue per window"
            onChange={(e) => {
              const next = micro(BigInt(e.target.value))
              bump(next, revenueMicro)
              setRevenueMicro(next)
            }}
          />
        </div>
        <div>
          <SliderLabel left="tier" right={`${tier} · ${formatBpMultiple(multipleBp)}×`} />
          <div className="seg">
            {['A', 'B', 'C', 'Unrated'].map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={tier === t}
                onClick={() => {
                  bump(BigInt(TIER_MULTIPLE_BP[t] ?? 0), BigInt(multipleBp))
                  setTier(t)
                }}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
        <div>
          <SliderLabel left="ramp" right={formatBpPercent(rampBp, 0)} />
          <input
            type="range"
            min={1500}
            max={10000}
            step={500}
            value={rampBp}
            aria-label="Ramp factor"
            onChange={(e) => {
              const next = bp(Number(e.target.value))
              bump(BigInt(next), BigInt(rampBp))
              setRampBp(next)
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
            color: inForce === 0n ? 'var(--debit)' : 'var(--pen)',
          }}
        >
          {format(inForce)}
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
