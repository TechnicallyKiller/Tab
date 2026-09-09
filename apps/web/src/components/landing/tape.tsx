import { shortConsensus } from '@/lib/format'
import { TAPE_ROWS } from '@/lib/mock/receipts'
import { format } from '@/lib/money'

/**
 * The page's proof of life. A linear marquee of real receipt rows — debits
 * brick, credits green, one refusal in caution yellow passing every cycle.
 * Pauses on hover, and reduced motion stops it via the global rule.
 *
 * Doubled so translateX(-50%) loops seamlessly.
 */
export function Tape() {
  /*
   * Doubled so the marquee can loop seamlessly — which means every `seq`
   * appears twice, so `seq` alone is not a usable React key. The pass tag makes
   * each copy distinct without falling back to the array index.
   */
  const rows = [
    ...TAPE_ROWS.map((r) => ({ ...r, id: `a-${r.seq}` })),
    ...TAPE_ROWS.map((r) => ({ ...r, id: `b-${r.seq}` })),
  ]
  return (
    <section
      className="rule-b"
      style={{ background: 'var(--ink)', overflow: 'hidden', padding: '16px 0' }}
      aria-label="Live receipt tape"
    >
      <div
        data-tape="1"
        className="t-mono"
        style={{ display: 'flex', width: 'max-content', fontSize: 13, color: 'var(--paper)' }}
      >
        {rows.map((r) => {
          const colour =
            r.leg === 'REFUSED' ? 'var(--caution)' : r.leg === 'CREDIT' ? '#5FCB8B' : '#F0846C'
          return (
            <span
              key={r.id}
              style={{
                display: 'inline-flex',
                gap: 18,
                padding: '0 24px',
                borderRight: '1px solid var(--rail-rule)',
                whiteSpace: 'nowrap',
              }}
            >
              <span style={{ color: 'var(--rail-fg-mute)' }}>{shortConsensus(r.consensus)}</span>
              <span style={{ color: colour, fontWeight: 600 }}>{r.leg}</span>
              <span>{r.counterparty}</span>
              <span style={{ color: colour, fontWeight: 600 }}>
                {r.leg === 'REFUSED' ? format(r.amount) : format(r.amount, { sign: 'always' })}
              </span>
              <span style={{ color: 'var(--rail-fg-mute)' }}>
                {r.leg === 'REFUSED' ? 'control_cluster' : r.attested ? 'attested' : 'unattested'}
              </span>
            </span>
          )
        })}
      </div>
    </section>
  )
}
