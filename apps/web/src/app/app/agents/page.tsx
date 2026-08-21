'use client'

import Link from 'next/link'
import { Card, CardHead, Chip, Stamp } from '@/components/ui'
import { STARTER_TAB } from '@/lib/mock/tab'

const REGISTRY = [
  { id: '0.0.4482091', registered: '4d ago', tier: 'C', ceiling: '1.0000', state: 'ACTIVE' as const },
  { id: '0.0.4901337', registered: '2d ago', tier: 'C', ceiling: '1.0000', state: 'ACTIVE' as const },
  { id: '0.0.5120988', registered: '9h ago', tier: 'Unrated', ceiling: '0.0000', state: 'FROZEN' as const },
  { id: '0.0.5591771', registered: '4s ago', tier: 'Unrated', ceiling: '1.0000', state: 'STARTER' as const },
]

export default function AgentsView() {
  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <Card style={{ overflow: 'hidden' }}>
        <CardHead>
          <span>Registry</span>
          <span style={{ marginLeft: 'auto', color: 'var(--ink-3)', textTransform: 'none', letterSpacing: 0 }}>
            one Starter Tab per funding root
          </span>
        </CardHead>
        <div className="tbl-scroll">
          <table className="tbl" style={{ minWidth: 640 }}>
            <thead>
              <tr>
                <th scope="col">Agent</th>
                <th scope="col">Registered</th>
                <th scope="col">Tier</th>
                <th scope="col" className="n">Ceiling</th>
                <th scope="col">State</th>
              </tr>
            </thead>
            <tbody>
              {REGISTRY.map((a) => (
                <tr key={a.id}>
                  <td style={{ fontWeight: 500 }}>
                    <Link href="/app/tab" style={{ color: 'var(--pen)' }}>{a.id}</Link>
                  </td>
                  <td style={{ color: 'var(--ink-3)' }}>{a.registered}</td>
                  <td style={{ color: a.tier === 'Unrated' ? 'var(--debit)' : 'var(--ink-2)' }}>{a.tier}</td>
                  <td className="n" style={{ fontWeight: 600 }}>{a.ceiling}</td>
                  <td>
                    <Chip tone={a.state === 'FROZEN' ? 'block' : a.state === 'STARTER' ? 'caution' : 'clean'}>
                      {a.state}
                    </Chip>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card style={{ padding: '20px 22px', maxWidth: 600 }}>
        <div className="t-label" style={{ marginBottom: 14 }}>
          0.0.5591771 · registered 4 seconds ago
        </div>
        <div style={{ marginBottom: 16 }}>
          <Stamp kind="issued">STARTER TAB ISSUED</Stamp>
        </div>
        <table className="tbl">
          <tbody>
            {STARTER_TAB.map((s) => (
              <tr key={s.k}>
                <th scope="row" style={{ textAlign: 'left', fontWeight: 400, color: 'var(--ink-2)', letterSpacing: 0, textTransform: 'none', fontSize: 12.5 }}>
                  {s.k}
                </th>
                <td className="n" style={{ fontWeight: 600 }}>{s.v}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--ink-2)', margin: '16px 0 0' }}>
          $1.00 sits below the cost of the Sybil setup needed to farm it, and the funding-root check
          means minting a hundred agents from one wallet yields one Starter Tab, not a hundred.
        </p>
      </Card>
    </div>
  )
}
