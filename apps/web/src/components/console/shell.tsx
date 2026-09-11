'use client'

import { MODEL_ID as MODEL_VERSION, windowOf } from '@tab/params'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { type ReactNode, useEffect, useState } from 'react'
import { ThemeToggle } from '@/components/ui/theme-toggle'
import { mmss } from '@/lib/format'
import { LIVE, TAB_ID, WINDOW_SECONDS } from '@/lib/live/client'
import { AGENT_ID, WINDOW_LABEL } from '@/lib/mock/tab'
import { useConsole } from './provider'

/**
 * Console shell. The rail order is information — most-glanced to least — and the
 * window countdown is always visible because every figure in the app is scoped
 * to a window. A reader who loses the window misreads every number on screen.
 */
const NAV: [string, string, string][] = [
  // First, because it is the only view a visitor can ACT on — every other one
  // asks them to believe a number.
  ['ASK THE AGENT', '/app/chat', ''],
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
  '/app/chat': ['Ask the agent', 'it holds no key, and it spends for real'],
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
  const { seconds, stale, toggleStale, live, error } = useConsole()

  /*
   * The chrome was reading the MOCK agent id and window label unconditionally,
   * so a console connected to a real gateway displayed `0.0.4482091` and
   * `window 0148` while flying a LIVE badge — invented identifiers presented as
   * fact, which is the exact failure the LIVE/MOCK distinction exists to
   * prevent, in the one place on screen that is never scrolled away.
   *
   * The agent id is a build-time constant either way, so it can be chosen
   * during render. The window number cannot: it comes from the clock, and
   * computing it during render makes the server's HTML disagree with the
   * client's. So it starts unset and arrives after mount, and until then the
   * label is omitted rather than guessed.
   */
  const agent = LIVE ? TAB_ID : AGENT_ID
  const [windowLabel, setWindowLabel] = useState<string | undefined>(
    LIVE ? undefined : WINDOW_LABEL,
  )
  useEffect(() => {
    if (!LIVE) return
    const tick = () => setWindowLabel(String(windowOf(Date.now() / 1000, WINDOW_SECONDS)))
    tick()
    const t = setInterval(tick, 1_000)
    return () => clearInterval(t)
  }, [])
  const [title, subtitle] = TITLES[pathname] ?? ['Tab', '']

  return (
    <div className="console">
      <aside className="console-rail">
        <div style={{ padding: '14px 18px', borderBottom: '2px solid var(--rail-rule)' }}>
          <div className="t-display" style={{ fontSize: 24 }}>
            Tab
          </div>
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
              <Link href="/" style={{ color: 'var(--rail-fg-dim)', textDecoration: 'none' }}>
                ← landing
              </Link>
              <Link href="/docs" style={{ color: 'var(--rail-fg-dim)', textDecoration: 'none' }}>
                docs
              </Link>
            </div>
          </div>
        </nav>
      </aside>

      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <header className="console-top">
          <div className="agent-chip">
            <span className="t-label">agent</span>
            <span className="t-mono" style={{ fontSize: 12.5, fontWeight: 600 }}>
              {agent}
            </span>
          </div>
          <div className="t-mono window-clock">
            <span className="t-label">window {windowLabel ?? '·'} closes in</span>
            <span style={{ fontSize: 19, fontWeight: 600 }}>{mmss(seconds)}</span>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
            {/*
              WHERE THE NUMBERS CAME FROM, always on screen.
              A console that silently falls back to mock data is a console that
              will be filmed showing invented numbers — and one figure that
              fails a HashScan cross-check makes every other figure suspect. So
              the source is stated, not implied, and MOCK is styled as a warning
              rather than as a neutral label.
            */}
            <span
              className={live ? 'pill' : 'pill pill-caution'}
              title={
                live
                  ? 'Figures polled from the gateway through @tab/sdk'
                  : 'NEXT_PUBLIC_TAB_ACCOUNT_ID is not set — these figures are invented'
              }
              style={{ background: live ? 'var(--surface)' : 'var(--caution)' }}
            >
              {live ? 'LIVE' : 'MOCK DATA'}
            </span>
            {error ? (
              /*
               * The REASON, on screen, not only in a tooltip.
               *
               * "GATEWAY UNREACHABLE" alone is the least useful true statement
               * the console can make: a CORS rejection, a cold-start timeout
               * and a wrong URL all look identical, and the one person who can
               * fix it is usually looking at the screen rather than hovering
               * it. It cost hours of guessing at exactly that.
               *
               * Truncated so a long message cannot push the toolbar around,
               * with the full text still on the tooltip.
               */
              <span
                className="pill pill-caution"
                title={error}
                style={{
                  background: 'var(--caution)',
                  maxWidth: 460,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {/*
                 * A TIMEOUT is reported as "no response yet", not as
                 * unreachable.
                 *
                 * The gateway is hosted on a tier that suspends idle services;
                 * waking one was measured at 71.9s. During that window every
                 * poll times out and the console was announcing the gateway as
                 * unreachable while it was merely asleep — the loudest
                 * possible way to say something untrue, on first impression,
                 * to someone who just opened the link.
                 *
                 * A timeout genuinely cannot distinguish "waking" from "dead",
                 * so the label claims neither and says what is actually known:
                 * nothing has answered yet, and here is how long that can
                 * legitimately take. Any OTHER error is a real fault and still
                 * reads as unreachable.
                 */}
                {/timed out/i.test(error)
                  ? 'NO RESPONSE YET · a suspended free-tier service takes ~60s to wake'
                  : `GATEWAY UNREACHABLE · ${error}`}
              </span>
            ) : null}
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
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 12,
              marginBottom: 18,
              flexWrap: 'wrap',
            }}
          >
            <h1 className="t-display" style={{ fontSize: 32, margin: 0 }}>
              {title}
            </h1>
            <span className="t-mono" style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
              {subtitle}
            </span>
          </div>
          {children}
        </main>
      </div>
    </div>
  )
}
