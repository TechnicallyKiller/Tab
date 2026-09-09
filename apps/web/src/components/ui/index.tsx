import type { CSSProperties, ReactNode } from 'react'

/* ============================================================
   Shared primitives. Structure is neobrutalist; anything holding a
   figure stays silent. Every colour comes from a token.
   ============================================================ */

export function Label({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div className="t-label" style={style}>
      {children}
    </div>
  )
}

export function Card({
  children,
  flat,
  small,
  style,
  className = '',
  id,
}: {
  children: ReactNode
  flat?: boolean
  small?: boolean
  style?: CSSProperties
  className?: string
  /** Docs sections are deep-linkable, so a card can own an anchor. */
  id?: string
}) {
  const base = flat ? 'card-flat' : small ? 'card-sm' : 'card'
  return (
    <div id={id} className={`${base} ${className}`} style={style}>
      {children}
    </div>
  )
}

export function CardHead({
  title,
  right,
  children,
}: {
  title?: ReactNode
  right?: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="card-head">
      {title ? <span>{title}</span> : null}
      {children}
      {right ? <span style={{ marginLeft: 'auto' }}>{right}</span> : null}
    </div>
  )
}

/** Status pill. Form as well as colour, so it survives greyscale. */
export function Pill({
  tone = 'dim',
  children,
}: {
  tone?: 'credit' | 'debit' | 'caution' | 'dim'
  children: ReactNode
}) {
  return <span className={`pill pill-${tone}`}>{children}</span>
}

export function Chip({
  tone = 'dim',
  children,
}: {
  tone?: 'caution' | 'block' | 'clean' | 'dim' | 'pen'
  children: ReactNode
}) {
  return <span className={`chip chip-${tone}`}>{children}</span>
}

/**
 * The stamp. One per screen. `active` gates the entrance animation so it plays
 * on arrival rather than on every re-render.
 */
export function Stamp({
  kind,
  active,
  children,
  style,
}: {
  kind: 'refused' | 'verified' | 'issued'
  active?: string
  children: ReactNode
  style?: CSSProperties
}) {
  return (
    <span className={`stamp stamp-${kind}`} data-stamp={active ?? 'off'} style={style}>
      {children}
    </span>
  )
}

/** A refusal is held, not broken. Hazard, never red alert. */
export function Hazard() {
  return <div className="hazard" aria-hidden="true" />
}

/** Funding-ancestry evidence. Never state a weight without the derivation. */
export function Hops({
  hops,
}: {
  hops: { label: string; tone?: 'neutral' | 'bad'; arrow?: string }[]
}) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center' }}>
      {/*
        A funding path can revisit an account (A → B → A), so the label alone is
        not a usable key — the position in the chain is part of what identifies
        a hop. Keyed on both, built up front rather than from the map index.
      */}
      {hops
        .map((h, i) => ({ ...h, key: `${i}:${h.label}` }))
        .map((h, i) => (
          <span key={h.key} style={{ display: 'inline-flex', alignItems: 'center' }}>
            <span className={h.tone === 'bad' ? 'hop hop-bad' : 'hop'}>{h.label}</span>
            {i < hops.length - 1 ? (
              <span className="hop-arrow">{h.arrow ?? '→'}</span>
            ) : h.arrow ? (
              <span className="hop-arrow">{h.arrow}</span>
            ) : null}
          </span>
        ))}
    </div>
  )
}

/** A figure. No gradient, no glow, no count-up. */
export function Figure({
  value,
  tone = 'ink',
  size = 40,
  flash,
  underline,
}: {
  value: string
  tone?: 'ink' | 'credit' | 'debit' | 'pen'
  size?: number
  flash?: string
  underline?: boolean
}) {
  const colour =
    tone === 'credit'
      ? 'var(--credit)'
      : tone === 'debit'
        ? 'var(--debit)'
        : tone === 'pen'
          ? 'var(--pen)'
          : 'var(--ink)'
  return (
    <span
      className="t-figure"
      data-flash={flash}
      style={{
        fontSize: size,
        color: colour,
        borderBottom: underline ? '2px solid var(--caution)' : undefined,
        display: 'inline-block',
      }}
    >
      {value}
    </span>
  )
}

export function Eyebrow({ children, tone }: { children: ReactNode; tone?: 'caution' | 'pen' }) {
  return (
    <div
      className="t-label"
      style={{
        color: tone === 'caution' ? 'var(--caution)' : tone === 'pen' ? 'var(--pen)' : undefined,
      }}
    >
      {children}
    </div>
  )
}

export function SectionHead({
  eyebrow,
  title,
  lede,
  maxWidth = '20ch',
  tone,
}: {
  eyebrow?: string
  title: string
  lede?: string
  maxWidth?: string
  tone?: 'paper'
}) {
  return (
    <>
      {eyebrow ? (
        <div
          className="t-label"
          style={{ marginBottom: 14, color: tone === 'paper' ? 'var(--rule-soft)' : undefined }}
        >
          {eyebrow}
        </div>
      ) : null}
      <h2
        className="t-display"
        style={{ fontSize: 'clamp(32px,4.5vw,68px)', margin: '0 0 20px', maxWidth }}
      >
        {title}
      </h2>
      {lede ? (
        <p
          style={{
            fontSize: 19,
            lineHeight: 1.6,
            color: tone === 'paper' ? 'var(--rule-soft)' : 'var(--ink-2)',
            maxWidth: '62ch',
            margin: '0 0 48px',
          }}
        >
          {lede}
        </p>
      ) : null}
    </>
  )
}

/** Code block: ink border, header strip, two colours at most. */
export function CodeBlock({
  lang,
  code,
  action,
  maxWidth,
}: {
  lang: string
  code: string
  action?: ReactNode
  maxWidth?: number
}) {
  return (
    <div className="card-flat" style={{ overflow: 'hidden', maxWidth }}>
      <div className="card-head" style={{ padding: '6px 12px' }}>
        <span>{lang}</span>
        {action ? <span style={{ marginLeft: 'auto' }}>{action}</span> : null}
      </div>
      <pre
        className="t-mono"
        style={{
          margin: 0,
          padding: 14,
          fontSize: 12.5,
          lineHeight: 1.8,
          color: 'var(--ink)',
          overflowX: 'auto',
        }}
      >
        <code>{code}</code>
      </pre>
    </div>
  )
}
