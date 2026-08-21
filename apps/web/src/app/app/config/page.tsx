'use client'

import { Card, CardHead, Chip } from '@/components/ui'
import { CopyButton } from '@/components/ui/copy-button'
import { CONFIG_GROUPS, MODEL_VERSION } from '@/lib/mock/tab'

/**
 * Every parameter in force. This view exists so tuning is STATED rather than
 * discovered — an overridden value carries a chip and shows what it replaced.
 * It appears in the demo for exactly that reason.
 */
export default function ConfigView() {
  const asJson = JSON.stringify(
    {
      MODEL_VERSION,
      ...Object.fromEntries(
        CONFIG_GROUPS.flatMap((g) => g.rows.map((r) => [r.key, r.value])),
      ),
    },
    null,
    2,
  )

  return (
    <div style={{ display: 'grid', gap: 20, maxWidth: 900 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center' }}>
        <span className="t-mono" style={{ fontSize: 14, fontWeight: 600 }}>
          MODEL_VERSION {MODEL_VERSION}
        </span>
        <CopyButton value={asJson} idleLabel="Copy as JSON" className="btn btn-sm" />
      </div>

      {CONFIG_GROUPS.map((g) => (
        <Card key={g.name} style={{ overflow: 'hidden' }}>
          <CardHead title={g.name} />
          <table className="tbl">
            <tbody>
              {g.rows.map((row) => (
                <tr key={row.key}>
                  <th
                    scope="row"
                    style={{ textAlign: 'left', padding: '8px 14px', fontWeight: 400, color: 'var(--ink-2)', letterSpacing: 0, textTransform: 'none', fontSize: 12.5 }}
                  >
                    {row.key}
                  </th>
                  <td className="n" style={{ fontWeight: 600 }}>{row.value}</td>
                  <td style={{ width: '1%', whiteSpace: 'nowrap', padding: '8px 14px' }}>
                    {row.overridden ? <Chip tone="caution">overridden</Chip> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ))}
    </div>
  )
}
