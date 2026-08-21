'use client'

import { useCallback, useState } from 'react'

/**
 * Confirms in place: the control says what happened, not that it tried.
 * A clipboard failure is reported rather than silently swallowed.
 */
export function CopyButton({
  value,
  idleLabel = 'Copy',
  className = 'btn-inline',
}: {
  value: string
  idleLabel?: string
  className?: string
}) {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle')

  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value)
      setState('done')
    } catch {
      setState('failed')
    }
    setTimeout(() => setState('idle'), 1400)
  }, [value])

  return (
    <button type="button" onClick={onCopy} className={className}>
      {state === 'done' ? 'Copied' : state === 'failed' ? 'Press ⌘C' : idleLabel}
    </button>
  )
}
