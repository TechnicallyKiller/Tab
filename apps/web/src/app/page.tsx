import Link from 'next/link'
import { Attack } from '@/components/landing/attack'
import { CeilingPlayground } from '@/components/landing/ceiling-playground'
import { ProblemDiagram } from '@/components/landing/diagrams'
import { Flows } from '@/components/landing/flows'
import { HeroScene } from '@/components/landing/hero-scene'
import { Tape } from '@/components/landing/tape'
import { CopyButton } from '@/components/ui/copy-button'
import { ThemeToggle } from '@/components/ui/theme-toggle'
import {
  FAST_PATH_CHECKS,
  HEDERA_REASONS,
  NOT_BUILT,
  PRIMITIVES,
  PROBLEMS,
  REMOVED_SURFACE,
  SLOW_PATH_STAGES,
  VERBS,
} from '@/lib/mock/landing'
import { TOPICS } from '@/lib/mock/tab'

const NAV = [
  ['Problem', '#problem'],
  ['How', '#flows'],
  ['Ceiling', '#engine'],
  ['Attack', '#attack'],
]

export default function LandingPage() {
  return (
    <>
      <header className="site-head">
        <span className="t-display" style={{ fontSize: 24 }}>Tab</span>
        <span className="t-label">tab.xyz</span>
        <nav className="site-nav">
          {NAV.map(([label, href]) => (
            <a key={href} href={href} style={{ color: 'var(--ink-2)', textDecoration: 'none' }}>
              {label}
            </a>
          ))}
          <Link href="/app/tab" style={{ color: 'var(--ink-2)', textDecoration: 'none' }}>App</Link>
          <Link href="/docs" style={{ color: 'var(--ink-2)', textDecoration: 'none' }}>Docs</Link>
        </nav>
        <span style={{ marginLeft: 'auto' }}><ThemeToggle /></span>
      </header>

      {/* ── HERO ─────────────────────────────────────────────────────────── */}
      <section className="hero rule-b">
        <HeroScene>
          {/* Server-rendered fallback. Correct on its own; hidden only once
              WebGL is confirmed. Reduced motion and no-WebGL both keep it. */}
          <svg viewBox="0 0 1200 700" preserveAspectRatio="xMidYMid slice" style={{ width: '100%', height: '100%', display: 'block' }}>
            <g stroke="var(--rule-soft)" strokeWidth={1} opacity={0.7}>
              <path d="M0 470 L1200 470" /><path d="M0 510 L1200 510" /><path d="M0 560 L1200 560" />
              <path d="M0 620 L1200 620" /><path d="M0 692 L1200 692" />
              <path d="M120 470 L40 692" /><path d="M300 470 L280 692" /><path d="M480 470 L520 692" />
              <path d="M660 470 L760 692" /><path d="M840 470 L1000 692" /><path d="M1020 470 L1240 692" />
            </g>
            <line x1={60} y1={330} x2={1140} y2={330} stroke="var(--ink)" strokeWidth={2.5} />
            <text x={60} y={320} fontFamily="IBM Plex Mono, monospace" fontSize={13} fill="var(--ink-3)">ZERO</text>
            <rect x={60} y={512} width={1080} height={8} fill="var(--pen)" opacity={0.12} />
            <line x1={60} y1={516} x2={1140} y2={516} stroke="var(--pen)" strokeWidth={2.5} />
            <text x={1140} y={506} textAnchor="end" fontFamily="IBM Plex Mono, monospace" fontSize={13} fill="var(--pen)">CEILING 1.0000</text>
            <path
              d="M60 330 C 200 330 250 470 380 486 C 470 497 520 440 610 388 C 700 336 760 268 860 262 C 960 256 1010 300 1080 330 L1140 330"
              fill="none" stroke="var(--debit)" strokeWidth={9} strokeLinecap="round"
            />
          </svg>
        </HeroScene>

        <div className="hero-copy">
          <div className="t-label" style={{ color: 'var(--ink-2)', marginBottom: 20 }}>
            CREDIT RAIL FOR AUTONOMOUS AGENTS · HEDERA
          </div>
          <h1 className="t-display" style={{ fontSize: 'clamp(40px,7vw,104px)', lineHeight: 0.94, margin: '0 0 24px', maxWidth: '18ch' }}>
            Agents shouldn&rsquo;t need a wallet to do business.
          </h1>
          <p style={{ fontSize: 19, lineHeight: 1.6, color: 'var(--ink-2)', maxWidth: '58ch', margin: '0 0 32px' }}>
            Tab is a running balance for autonomous agents. It goes negative when the agent spends,
            positive when it earns, and settles once per window in a single transfer. The agent never
            holds USDC and never signs a payment.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 28 }}>
            <Link href="/docs" className="btn btn-primary">Read the docs</Link>
            <Link href="/app/tab" className="btn">Open the app</Link>
          </div>
          <div className="t-label" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 18px' }}>
            <span>ZERO SMART CONTRACTS</span>
            <span style={{ color: 'var(--rule-soft)' }}>·</span>
            <span>4 NATIVE HEDERA SERVICES</span>
            <span style={{ color: 'var(--rule-soft)' }}>·</span>
            <span>x402 ON BOTH LEGS</span>
          </div>
        </div>
      </section>

      {/* ── PROBLEM ──────────────────────────────────────────────────────── */}
      <section id="problem" className="rule-b" style={{ background: 'var(--ink)', color: 'var(--paper)', padding: '88px 28px' }}>
        <div style={{ maxWidth: 1240, margin: '0 auto' }}>
          <h2 className="t-display" style={{ fontSize: 'clamp(32px,4.6vw,68px)', margin: '0 0 20px', maxWidth: '20ch' }}>
            x402 solved how an agent pays. Nobody solved when.
          </h2>
          <p style={{ fontSize: 19, lineHeight: 1.6, color: 'var(--rule-soft)', maxWidth: '62ch', margin: '0 0 52px' }}>
            An agent pays for inference, data and APIs before anyone has paid it. Its balance is
            structurally behind its earning capacity, and the only fix on offer is to fund a wallet first.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 20 }}>
            {PROBLEMS.map((p) => (
              <div key={p.idx} style={{ border: 'var(--bw) solid var(--paper)', borderRadius: 2, padding: 22, display: 'flex', flexDirection: 'column', gap: 18 }}>
                <div className="t-label" style={{ color: 'var(--caution)' }}>{p.idx}</div>
                <h3 className="t-display-700" style={{ fontSize: 24, margin: 0 }}>{p.title}</h3>
                <p style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--rule-soft)', margin: 0 }}>{p.body}</p>
                <div style={{ marginTop: 'auto', paddingTop: 12 }}>
                  <ProblemDiagram kind={p.diagram} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <Flows />

      {/* ── CEILING ENGINE ───────────────────────────────────────────────── */}
      <section id="engine" className="rule-b" style={{ padding: '88px 28px' }}>
        <div style={{ maxWidth: 1240, margin: '0 auto' }}>
          <h2 className="t-display" style={{ fontSize: 'clamp(32px,4.4vw,68px)', margin: '0 0 44px', maxWidth: '22ch' }}>
            The ceiling is arithmetic, not a credit committee.
          </h2>
          <div className="engine-grid">
            <div className="card" style={{ padding: 26 }}>
              <div className="t-mono" style={{ fontSize: 12.5, lineHeight: 2.2 }}>
                <div style={{ marginBottom: 14 }}>
                  <span style={{ color: 'var(--pen)', fontWeight: 600 }}>ceiling</span> =
                </div>
                <Term>trailing_attested_revenue_per_window</Term>
                <Term op="×" note="A 3.0 · B 2.0 · C 1.0 · Unrated 0">tier_multiple</Term>
                <Term op="×" note="starts 15%, +15% clean, −30% missed">ramp_factor</Term>
                <Term op=",">clamped by hard_cap[tier]</Term>
              </div>
            </div>
            <CeilingPlayground />
          </div>

          {/* The deliberate speed asymmetry. */}
          <div className="card paths-grid" style={{ marginTop: 28 }}>
            <div style={{ padding: 26 }}>
              <div className="t-label" style={{ marginBottom: 12 }}>
                Fast path · every spend · under 50ms · cache only
              </div>
              <ol className="t-mono" style={{ fontSize: 12.5, lineHeight: 2, color: 'var(--ink-2)', margin: 0, paddingLeft: 24 }}>
                {FAST_PATH_CHECKS.map((c) => <li key={c}>{c}</li>)}
              </ol>
            </div>
            <div className="paths-divider" />
            <div style={{ padding: 26 }}>
              <div className="t-label" style={{ marginBottom: 12 }}>Slow path · background</div>
              <div className="t-mono" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, fontSize: 12.5, marginBottom: 22 }}>
                {SLOW_PATH_STAGES.map((s, i) => (
                  <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ border: '2px solid var(--ink)', padding: '5px 9px', borderRadius: 2 }}>{s}</span>
                    {i < SLOW_PATH_STAGES.length - 1 ? <span style={{ color: 'var(--ink-3)' }}>→</span> : null}
                  </span>
                ))}
              </div>
              <div className="t-mono" style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 11, marginBottom: 10 }}>
                <span style={{ flex: 1, height: 0, borderTop: '2.5px solid var(--pen)' }} />
                <span style={{ color: 'var(--pen)', fontWeight: 600 }}>writes cache</span>
              </div>
              <div className="t-mono" style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 11, opacity: 0.55 }}>
                <span style={{ flex: 1, height: 0, borderTop: '2.5px dashed var(--ink-3)' }} />
                <span style={{ color: 'var(--ink-3)', textDecoration: 'line-through' }}>never calls Mirror Node</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <Attack />

      {/* ── WHY HEDERA ───────────────────────────────────────────────────── */}
      <section className="rule-b" style={{ padding: '88px 28px' }}>
        <div style={{ maxWidth: 1240, margin: '0 auto' }}>
          <h2 className="t-display" style={{ fontSize: 'clamp(32px,4.4vw,68px)', margin: '0 0 40px', maxWidth: '18ch' }}>
            Why Hedera, in four numbers.
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(250px,1fr))', gap: 20 }}>
            {HEDERA_REASONS.map((h) => (
              <div key={h.figure} className="card" style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div className="t-figure" style={{ fontSize: 32, color: 'var(--pen)' }}>{h.figure}</div>
                <div className="t-display-700" style={{ fontSize: 19 }}>{h.title}</div>
                <p style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--ink-2)', margin: 0 }}>{h.body}</p>
              </div>
            ))}
          </div>

          <div className="card" style={{ marginTop: 20, overflow: 'hidden' }}>
            <div className="card-head" style={{ padding: '14px 20px', letterSpacing: 0, textTransform: 'none', flexWrap: 'wrap', alignItems: 'baseline' }}>
              <span className="t-display" style={{ fontSize: 24 }}>No Solidity.</span>
              <span style={{ fontSize: 16, color: 'var(--ink-2)', fontFamily: 'var(--font-sans)' }}>
                Contracts replaced by native primitives.
              </span>
            </div>
            <div className="tbl-scroll">
              <table className="tbl" style={{ minWidth: 560 }}>
                <thead>
                  <tr>
                    <th style={{ padding: '9px 20px' }}>Would normally be a contract</th>
                    <th style={{ padding: '9px 20px' }}>Replaced by</th>
                  </tr>
                </thead>
                <tbody>
                  {PRIMITIVES.map(([a, b]) => (
                    <tr key={a}>
                      <td style={{ padding: '9px 20px', color: 'var(--ink-2)' }}>{a}</td>
                      <td style={{ padding: '9px 20px', fontWeight: 500 }}>{b}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="rule-t t-mono" style={{ padding: '16px 20px', display: 'flex', flexWrap: 'wrap', gap: 10, fontSize: 11, letterSpacing: '0.06em', color: 'var(--ink-3)' }}>
              <span style={{ color: 'var(--ink-2)', fontWeight: 600 }}>ATTACK SURFACE REMOVED:</span>
              {REMOVED_SURFACE.map((s) => (
                <span key={s} style={{ textDecoration: 'line-through' }}>{s}</span>
              ))}
            </div>
          </div>
        </div>
      </section>

      <Tape />

      {/* ── CLOSE ────────────────────────────────────────────────────────── */}
      <section style={{ background: 'var(--ink)', color: 'var(--paper)', padding: '88px 28px 40px' }}>
        <div className="close-grid" style={{ maxWidth: 1240, margin: '0 auto' }}>
          <div>
            <h2 className="t-display" style={{ fontSize: 44, margin: '0 0 24px' }}>
              Five verbs is the whole agent surface.
            </h2>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 26 }}>
              {VERBS.map((v) => (
                <span key={v} className="t-mono" style={{ fontSize: 14, padding: '7px 14px', border: 'var(--bw) solid var(--paper)', borderRadius: 2 }}>
                  {v}
                </span>
              ))}
            </div>
            <div style={{ border: 'var(--bw) solid var(--paper)', borderRadius: 2, overflow: 'hidden', maxWidth: 520 }}>
              <div className="t-label" style={{ background: 'var(--deep)', borderBottom: 'var(--bw) solid var(--paper)', padding: '7px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'var(--rail-fg-mute)' }}>
                <span>install</span>
                <CopyButton value="npm i @tab/sdk" className="tape-copy" />
              </div>
              <pre className="t-mono" style={{ margin: 0, padding: 14, fontSize: 14, color: 'var(--paper)' }}>
                <code>npm i @tab/sdk</code>
              </pre>
            </div>
            <p style={{ fontSize: 16, lineHeight: 1.7, color: 'var(--rule-soft)', margin: '20px 0 0', maxWidth: '56ch' }}>
              Ships as a Hedera Agent Kit v4 plugin, an MCP server, a TypeScript SDK, and a CLI.
            </p>
          </div>
          <div>
            <h3 className="t-display-700" style={{ fontSize: 24, margin: '0 0 18px' }}>
              What we deliberately did not build
            </h3>
            <ul className="t-mono" style={{ listStyle: 'none', margin: 0, padding: 0, fontSize: 14 }}>
              {NOT_BUILT.map((n) => (
                <li key={n} style={{ padding: '11px 0', borderBottom: '1px solid var(--rail-rule)', display: 'flex', gap: 12, alignItems: 'baseline' }}>
                  <span style={{ color: 'var(--caution)' }}>—</span>
                  <span style={{ color: 'var(--rule-soft)' }}>{n}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="t-mono" style={{ maxWidth: 1240, margin: '56px auto 0', borderTop: 'var(--bw) solid var(--paper)', paddingTop: 20, display: 'flex', flexWrap: 'wrap', gap: 20, fontSize: 11, letterSpacing: '0.06em', color: 'var(--rail-fg-mute)' }}>
          <a href="https://github.com/TechnicallyKiller/ethonline-1" style={{ color: 'var(--rule-soft)' }}>repo</a>
          <span>receipt topic {TOPICS.receipts}</span>
          <span>ceiling topic {TOPICS.ceilings}</span>
          <span>float account {TOPICS.float}</span>
          <span style={{ marginLeft: 'auto' }}>
            Built for ETHOnline 2026 · Hedera Testnet · No Solidity was deployed at any point.
          </span>
        </div>
      </section>
    </>
  )
}

function Term({ children, op, note }: { children: string; op?: string; note?: string }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 10 }}>
      {op ? <span style={{ color: 'var(--ink-3)', width: 14 }}>{op}</span> : null}
      <span style={{ border: 'var(--bw) solid var(--ink)', borderRadius: 2, padding: '6px 10px', background: 'var(--sunk)' }}>
        {children}
      </span>
      {note ? <span style={{ color: 'var(--ink-3)', fontSize: 11 }}>{note}</span> : null}
    </div>
  )
}
