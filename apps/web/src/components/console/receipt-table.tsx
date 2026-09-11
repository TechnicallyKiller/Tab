'use client'

import { Pill } from '@/components/ui'
import { seq as fmtSeq } from '@/lib/format'
import type { Receipt } from '@/lib/mock/types'
import { format } from '@/lib/money'
import { TopicLink } from './topic-link'

const COLS: [string, boolean][] = [
  ['Consensus', false],
  ['Leg', false],
  ['Counterparty', false],
  ['Amount', true],
  ['Att', false],
  ['Request hash', false],
  ['Seq', true],
]

/**
 * New rows flash their ground and do NOT slide in — a slide pushes every other
 * row and makes a streaming table unreadable at speed. This one is on screen
 * during the demo while receipts land live.
 */
export function ReceiptTable({ rows }: { rows: Receipt[] }) {
  return (
    <div className="tbl-scroll">
      <table className="tbl" style={{ minWidth: 780 }}>
        <thead>
          <tr>
            {COLS.map(([label, right]) => (
              <th key={label} scope="col" className={right ? 'n' : undefined}>
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody aria-live="polite">
          {rows.map((r) => {
            const tone = r.leg === 'REFUSED' ? 'caution' : r.leg === 'CREDIT' ? 'credit' : 'debit'
            const amountColour =
              r.leg === 'REFUSED'
                ? 'var(--ink-3)'
                : r.leg === 'CREDIT'
                  ? 'var(--credit)'
                  : 'var(--debit)'
            return (
              // Keyed on the consensus timestamp, which is unique and always
              // present. `seq` is absent until a receipt is published.
              <tr key={r.consensus} data-flash={r.flash}>
                <td style={{ color: 'var(--ink-2)', whiteSpace: 'nowrap' }}>{r.consensus}</td>
                <td>
                  <Pill tone={tone}>{r.leg}</Pill>
                </td>
                <td>{r.counterparty}</td>
                <td className="n" style={{ fontWeight: 600, color: amountColour }}>
                  {r.leg === 'REFUSED' ? format(r.amount) : format(r.amount, { sign: 'always' })}
                </td>
                <td style={{ color: 'var(--ink-2)' }}>
                  {r.leg === 'REFUSED' ? '—' : r.attested ? 'yes' : 'no'}
                </td>
                <td style={{ color: 'var(--ink-3)' }}>{r.requestHash ?? '—'}</td>
                <td className="n">
                  {/*
                   * The receipts topic, read from the gateway rather than
                   * hardcoded. This said `0.0.4881203` — a mock id that holds
                   * no messages — so every sequence number on the busiest
                   * table in the console linked to an empty topic.
                   */}
                  <TopicLink kind="receipts" style={{ color: 'var(--pen)' }}>
                    {r.seq === undefined ? 'pending' : fmtSeq(r.seq)}
                  </TopicLink>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
