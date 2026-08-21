'use client'

import { useCallback, useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'
const KEY = 'tab-theme'

/**
 * Explicit choice stamps data-theme on <html>. No choice leaves it unstamped,
 * so prefers-color-scheme decides — which is why globals.css defines the dark
 * palette in both a media query and a [data-theme] block.
 */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>('light')

  useEffect(() => {
    const stored = window.localStorage.getItem(KEY) as Theme | null
    if (stored === 'dark' || stored === 'light') {
      setTheme(stored)
      document.documentElement.setAttribute('data-theme', stored)
      return
    }
    const dark = window.matchMedia?.('(prefers-color-scheme: dark)').matches
    setTheme(dark ? 'dark' : 'light')
  }, [])

  const toggle = useCallback(() => {
    setTheme((current) => {
      const next: Theme = current === 'dark' ? 'light' : 'dark'
      document.documentElement.setAttribute('data-theme', next)
      try {
        window.localStorage.setItem(KEY, next)
      } catch {
        // Private mode. The stamp still applies for this session.
      }
      return next
    })
  }, [])

  // "Ledger" is the paper theme; "Carbon" is the copy.
  return { theme, toggle, label: theme === 'dark' ? 'Carbon' : 'Ledger' }
}
