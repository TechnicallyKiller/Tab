'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { ThemeToggle } from '@/components/ui/theme-toggle'
import { useConsole } from './provider'
import { mmss } from '@/lib/format'
import { AGENT_ID, MODEL_VERSION, WINDOW_LABEL } from '@/lib/mock/tab'

/**
 * Console shell. The rail order is information — most-glanced to least — and the
 * window countdown is always visible because every figure in the app is scoped
 * to a window. A reader who loses the window misreads every number on screen.
 */
const NAV: [string, string, string][] = [
  ['TAB', '/app/tab', ''],
  ['CEILING', '/app/ceiling', ''],
  ['COUNTERPARTIES', '/app/counterparties', '12'],
  ['RECEIPTS', '/app/receipts', ''],
  ['SETTLEMENTS', '/app/settlements', '6'],
  ['REFUSALS', '/app/refusals', '3'],
  ['AGENTS', '/app/agents', '4'],
  ['CONFIG', '/app/config', ''],
]

const TITLES: Record<string, [string, string]> = {
  '/app/tab': ['Tab', 'balance, ceiling, available, holds'],
  '/app/ceiling': ['Ceiling', 'inputs, tier, ramp, model version, verify'],
  '/app/counterparties': ['Counterparties', 'weights and the reason behind each'],
  '/app/receipts': ['Receipts', 'live stream, both legs'],
  '/app/settlements': ['Settlements', 'window history'],
  '/app/refusals': ['Refusals', 'every refused spend, and why'],
  '/app/agents': ['Agents', 'registry and starter tabs'],
  '/app/config': ['Config', 'every parameter in force'],
}

export function ConsoleShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const { seconds, stale, toggleStale } = useConsole()
  const [title, subtitle] = TITLES[pathname] ?? ['Tab', '']

  return (
    <div className="console">
      <aside className="console-rail">
        <div style={{ padding: '14px 18px', borderBottom: '2px solid var(--rail-rule)' }}>
          <div className="t-display" style={{ fontSize: 24 }}>Tab</div>
          <div className="t-label" style={{ color: 'var(--rail-fg-mute)', marginTop: 2 }}>
            operator console
          </div>
        </div>
        <nav style={{ padding: '10px 0', display: 'flex', flexDirection: 'column', flex: 1 }}>
          {NAV.map(([label, href, count]) => {
            const active = pathname === href
            return (
              <Link
                key={href}
                href={href}
                className="rail-item"
                data-active={active ? '1' : '0'}
                aria-current={active ? 'page' : undefined}
              >
                <span>{label}</span>
                <span className="rail-count">{count}</span>
              </Link>
            )
          })}
          <div className="t-mono rail-foot">
            <div>MODEL_VERSION</div>
            <div style={{ color: 'var(--rail-fg)' }}>{MODEL_VERSION}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 10 }}>
              <Link href="/" style={{ color: 'var(--rail-fg-dim)', textDecoration: 'none' }}>← landing</Link>
              <Link href="/docs" style={{ color: 'var(--rail-fg-dim)', textDecoration: 'none' }}>docs</Link>
            </div>
          </div>
        </nav>
      </aside>

      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <header className="console-top">
          <div className="agent-chip">
            <span className="t-label">agent</span>
            <span className="t-mono" style={{ fontSize: 12.5, fontWeight: 600 }}>{AGENT_ID}</span>
          </div>
          <div className="t-mono window-clock">
            <span className="t-label">window {WINDOW_LABEL} closes in</span>
            <span style={{ fontSize: 19, fontWeight: 600 }}>{mmss(seconds)}</span>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* Stale is a real state to design, so it is togglable in the mock. */}
            <button
              type="button"
              onClick={toggleStale}
              className={stale ? 'pill pill-caution' : 'pill'}
              style={{ cursor: 'pointer', background: stale ? 'var(--caution)' : 'var(--surface)' }}
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: 999,
                  background: stale ? 'var(--ink)' : 'var(--credit)',
                  display: 'inline-block',
                }}
              />
              {stale ? 'STALE' : 'STREAMING'}
            </button>
            <ThemeToggle />
          </div>
        </header>

        <main style={{ padding: 22, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
            <h1 className="t-display" style={{ fontSize: 32, margin: 0 }}>{title}</h1>
            <span className="t-mono" style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{subtitle}</span>
          </div>
          {children}
        </main>
      </div>
    </div>
  )
}
