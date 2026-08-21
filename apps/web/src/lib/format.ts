/** Consensus timestamps and sequence numbers, formatted the way the ledger reads them. */

/** Thin-space grouping keeps a sequence number scannable without a comma. */
export function seq(n: number): string {
  return n.toLocaleString('en-US').replace(/,/g, ' ')
}

/** Show the tail of a consensus timestamp when the leading epoch adds nothing. */
export function shortConsensus(ts: string): string {
  const dot = ts.indexOf('.')
  if (dot < 0) return ts
  return `…${ts.slice(dot - 3)}`
}

export function mmss(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** Greenbar striping. Tables use nth-child; lists that can't need this. */
export function stripe(i: number): string {
  return i % 2 ? 'var(--sunk)' : 'transparent'
}
