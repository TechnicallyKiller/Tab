'use client'

import { useEffect, useState } from 'react'
import { SEARCH_INDEX } from '@/lib/mock/docs'

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

      {open ? (
        <div
          className="palette-scrim"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Search the docs"
        >
          <div className="palette" onClick={(e) => e.stopPropagation()}>
            <input
              autoFocus
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
                  <div key={r.title} className="palette-row">
                    <span className="t-label" style={{ width: 110, flex: 'none' }}>{r.section}</span>
                    <span style={{ fontSize: 14 }}>{highlight(r.title, q)}</span>
                  </div>
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
