import type { ReactNode } from 'react'

/**
 * Four callouts, distinguished by border and label, never by icon.
 * REFUSES is Tab-specific and belongs on every endpoint that can decline.
 */
const TONES = {
  ink: 'var(--ink)',
  pen: 'var(--pen)',
  caution: 'var(--caution)',
  debit: 'var(--debit)',
} as const

export function Callout({
  label,
  tone,
  children,
}: {
  label: string
  tone: keyof typeof TONES
  children: ReactNode
}) {
  return (
    <div
      style={{
        border: `var(--bw) solid ${TONES[tone]}`,
        borderLeftWidth: 8,
        borderRadius: 2,
        background: 'var(--surface)',
        padding: '14px 16px',
      }}
    >
      <div
        className="t-mono"
        style={{
          fontSize: 11,
          letterSpacing: '0.13em',
          textTransform: 'uppercase',
          fontWeight: 600,
          color: TONES[tone],
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--ink-2)', maxWidth: '66ch' }}>
        {children}
      </div>
    </div>
  )
}

export function DocsH2({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="t-display-700" style={{ fontSize: 32, margin: '44px 0 12px' }}>
      {children}
    </h2>
  )
}

export function DocsP({ children }: { children: ReactNode }) {
  return (
    <p
      style={{
        fontSize: 16,
        lineHeight: 1.7,
        color: 'var(--ink-2)',
        maxWidth: '68ch',
        margin: '0 0 20px',
      }}
    >
      {children}
    </p>
  )
}
