'use client'

import { params } from '@tab/params'
import { Card, CardHead, Chip } from '@/components/ui'
import { CopyButton } from '@/components/ui/copy-button'
import { configGroups, MODEL_VERSION } from '@/lib/config'

/**
 * Every parameter in force. This view exists so tuning is STATED rather than
 * discovered — a tuned value carries a chip and says what it replaced and why.
 * It appears in the demo for exactly that reason.
 *
 * The rows come from `@tab/params`, the same frozen set the engine computed
 * every published ceiling under. "Copy as JSON" dumps that set verbatim rather
 * than the formatted strings on screen, so a verifier gets the numbers the
 * model actually used, not a rendering of them.
 */
export default function ConfigView() {
  const groups = configGroups()
  const asJson = JSON.stringify(params, null, 2)

  return (
    <div style={{ display: 'grid', gap: 20, maxWidth: 900 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center' }}>
        <span className="t-mono" style={{ fontSize: 14, fontWeight: 600 }}>
          MODEL_VERSION {MODEL_VERSION}
        </span>
        <Chip tone="pen">frozen</Chip>
        <CopyButton value={asJson} idleLabel="Copy as JSON" className="btn btn-sm" />
      </div>

      <p style={{ margin: 0, maxWidth: 640, color: 'var(--ink-2)', fontSize: 13 }}>
        Every published ceiling carries this model id. A parameter set is frozen once a ceiling has
        been published under it — changing a number means a new version, so that a ceiling from last
        week stays recomputable this week.
      </p>

      {groups.map((g) => (
        <Card key={g.name} style={{ overflow: 'hidden' }}>
          <CardHead
            title={g.name}
            right={
              <span
                style={{
                  fontWeight: 400,
                  color: 'var(--ink-2)',
                  textTransform: 'none',
                  letterSpacing: 0,
                }}
              >
                {g.note}
              </span>
            }
          />
          <table className="tbl">
            <tbody>
              {g.rows.map((row) => (
                <tr key={row.key}>
                  <th
                    scope="row"
                    style={{
                      textAlign: 'left',
                      padding: '8px 14px',
                      fontWeight: 400,
                      color: 'var(--ink-2)',
                      letterSpacing: 0,
                      textTransform: 'none',
                      fontSize: 12.5,
                    }}
                  >
                    {row.key}
                  </th>
                  <td className="n" style={{ fontWeight: 600 }}>
                    {row.value}
                  </td>
                  <td style={{ width: '1%', whiteSpace: 'nowrap', padding: '8px 14px' }}>
                    {row.tuned ? <Chip tone="caution">tuned for testnet</Chip> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {g.rows.some((r) => r.tuned) ? (
            <p
              style={{
                margin: 0,
                padding: '10px 14px',
                borderTop: '1px solid var(--rule-soft)',
                color: 'var(--ink-2)',
                fontSize: 12.5,
              }}
            >
              {g.rows.find((r) => r.tuned)?.tuned}
            </p>
          ) : null}
        </Card>
      ))}
    </div>
  )
}
