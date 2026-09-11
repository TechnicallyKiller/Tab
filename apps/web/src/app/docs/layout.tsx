import { MODEL_ID as MODEL_VERSION } from '@tab/params'
import Link from 'next/link'
import { SearchPalette } from '@/components/docs/search-palette'
import { ThemeToggle } from '@/components/ui/theme-toggle'
import { OUTLINE, SIDEBAR } from '@/lib/docs'

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="docs-head">
        <span className="t-display" style={{ fontSize: 24 }}>
          Tab
        </span>
        <span className="t-label">docs.tab.xyz</span>
        <SearchPalette />
        <nav className="docs-toplinks">
          <Link href="/" style={{ color: 'var(--ink-2)', textDecoration: 'none' }}>
            Landing
          </Link>
          <Link href="/app/tab" style={{ color: 'var(--ink-2)', textDecoration: 'none' }}>
            App
          </Link>
        </nav>
        <ThemeToggle />
      </header>

      <div className="docs-shell">
        <aside className="docs-rail">
          {SIDEBAR.map((group) => (
            <div key={group.group} style={{ marginBottom: 24 }}>
              <div className="t-label" style={{ marginBottom: 8 }}>
                {group.group}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {group.items.map((item) => (
                  <a
                    key={`${group.group}-${item.label}`}
                    href={item.href}
                    className="docs-navlink"
                    data-active={item.active ? '1' : '0'}
                  >
                    {item.label}
                  </a>
                ))}
              </div>
            </div>
          ))}
        </aside>

        <main className="docs-main">{children}</main>

        <aside className="docs-outline">
          <div className="t-label" style={{ marginBottom: 10 }}>
            On this page
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {OUTLINE.map((o) => (
              <a
                key={o.label}
                href={o.href}
                style={{
                  fontSize: 14,
                  color: 'var(--ink-2)',
                  textDecoration: 'none',
                  lineHeight: 1.4,
                  paddingLeft: o.indent * 12,
                }}
              >
                {o.label}
              </a>
            ))}
          </div>
          <div className="t-label" style={{ marginTop: 24 }}>
            Documents
          </div>
          <div className="t-mono" style={{ fontSize: 12.5, marginTop: 6 }}>
            {MODEL_VERSION}
          </div>
        </aside>
      </div>
    </>
  )
}
