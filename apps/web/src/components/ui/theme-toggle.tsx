'use client'

import { useTheme } from '@/lib/hooks/use-theme'

export function ThemeToggle() {
  const { toggle, label } = useTheme()
  return (
    <button type="button" onClick={toggle} className="btn btn-sm" aria-label={`Theme: ${label}`}>
      {label}
    </button>
  )
}
