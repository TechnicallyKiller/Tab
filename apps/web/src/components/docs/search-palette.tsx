'use client'

import { useEffect, useState } from 'react'
import { SEARCH_INDEX } from '@/lib/docs'

/** ⌘K. The only animation in the docs, and it opens on `snap`. */
export function SearchPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(true)
      }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const q = query.trim().toLowerCase()
  const results = SEARCH_INDEX.filter((r) => !q || r.title.toLowerCase().includes(q))

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="docs-search">
        <span style={{ flex: 1 }}>Search the docs</span>
        <span style={{ color: 'var(--ink-2)' }}>⌘K</span>
      </button>

      {/*
        The scrim is a BACKDROP, not the dialog. `role="dialog"` used to sit on
        the full-screen click-to-close layer, so a screen reader was told the
        backdrop was the dialog and the palette inside it was just content. The
        roles now sit where the elements actually are.

        Escape is handled by a window listener above, which a linter cannot see;
        the `onKeyDown` here is the same behaviour bound to the element, so the
        click target is genuinely keyboard-reachable rather than merely asserted
        to be.
      */}
      {open ? (
        <div className="palette-scrim">
          {/*
            A real <button> for the backdrop, not a div with a click handler.
            Click-to-dismiss has to be reachable by keyboard and announced, and
            a button is the element that already is both — where a div needs a
            role, a tabindex and a key handler bolted on to imitate one.
            `aria-label` because it has no visible text.
          */}
          <button
            type="button"
            className="palette-scrim-dismiss"
            aria-label="Close search"
            onClick={() => setOpen(false)}
          />
          <div
            className="palette"
            role="dialog"
            aria-modal="true"
            aria-label="Search the docs"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="refusal codes, ceiling, attested…"
              className="t-mono palette-input"
            />
            <div style={{ maxHeight: '52vh', overflowY: 'auto' }}>
              {results.length === 0 ? (
                <div style={{ padding: '16px', fontSize: 14, color: 'var(--ink-3)' }}>
                  Nothing matches “{query}”. Try a refusal code, or a concept like attested revenue.
                </div>
              ) : (
                results.map((r) => (
                  /*
                   * An anchor, not a div.
                   *
                   * Every result used to be inert: the palette found things and
                   * then could not take you to them, which is a worse
                   * experience than having no search at all — it looks like the
                   * page is broken rather than absent. Each entry now carries
                   * the anchor it describes, and selecting one closes the
                   * palette on the way.
                   */
                  <a
                    key={r.href}
                    href={r.href}
                    className="palette-row"
                    onClick={() => setOpen(false)}
                    style={{ color: 'inherit', textDecoration: 'none', cursor: 'pointer' }}
                  >
                    <span className="t-label" style={{ width: 110, flex: 'none' }}>
                      {r.section}
                    </span>
                    <span style={{ fontSize: 14 }}>{highlight(r.title, q)}</span>
                  </a>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

function highlight(title: string, q: string) {
  if (!q) return title
  const i = title.toLowerCase().indexOf(q)
  if (i < 0) return title
  return (
    <>
      {title.slice(0, i)}
      <b style={{ color: 'var(--pen)' }}>{title.slice(i, i + q.length)}</b>
      {title.slice(i + q.length)}
    </>
  )
}
