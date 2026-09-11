'use client'

import { caps, params } from '@tab/params'
import type { TabSummary } from '@tab/sdk'
import Link from 'next/link'
import { Card, CardHead, Chip } from '@/components/ui'
import { seq as fmtSeq } from '@/lib/format'
import { useTabs } from '@/lib/hooks/use-tabs'
import { TAB_ID } from '@/lib/live/client'
import { bp, format, formatBpPercent } from '@/lib/money'

/**
 * The tabs this gateway knows about — deliberately NOT called a registry.
 *
 * ## What this view used to claim
 *
 * A table headed "Registry" with four invented agents, a `registered` column
 * reading `4d ago` / `4s ago`, a green `STARTER TAB ISSUED` stamp, and the
 * sentence "the funding-root check means minting a hundred agents from one
 * wallet yields one Starter Tab, not a hundred".
 *
 * **Every one of those was a claim the system does not support.** Nothing
 * writes a `register` message — the README labels one-Starter-Tab-per-funding-
 * root OPEN, and HANDOFF ranks it as gap #2 — so there is no registration time
 * to show, nothing is issued, and bulk-minting agents to farm Starter Tabs is
 * not prevented. The `$1.00` in that sentence was also two versions stale; the
 * starter ceiling is 0.250000 under v2.
 *
 * So the view now shows what the gateway can actually attest: the tabs that
 * appeared on the receipt topic during replay, with their real positions and
 * whatever the engine has published for them. The rule that is *not* enforced
 * is stated at the top rather than implied by a heading.
 */

/** `Unrated` means no credit at all; absent means never published for. */
function tierTone(t: TabSummary['tier']) {
  if (t === undefined) return 'var(--ink-3)'
  if (t === 'Unrated') return 'var(--debit)'
  return 'var(--ink-2)'
}

export default function AgentsView() {
  const { value, live, error, loading } = useTabs()
  const rows = value.tabs

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      {/*
       * The rule, stated first — and it is now ENFORCED.
       *
       * This card used to say NO REGISTRATION FLOW, because nothing wrote a
       * `register` message and one Starter Tab per funding root was a README
       * claim rather than a rule. The engine now resolves each tab's funding
       * root from the published facts and claims it, first claim winning
       * permanently. The card stays because a list of agents still LOOKS like
       * a registry, and what the rule actually does is worth saying plainly.
       */}
      <Card
        style={{
          borderColor: value.registrationEnforced ? 'var(--credit)' : 'var(--caution)',
          padding: '16px 18px',
          display: 'grid',
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <Chip tone={value.registrationEnforced ? 'clean' : 'caution'}>
            {value.registrationEnforced
              ? 'ONE STARTER TAB PER FUNDING ROOT'
              : 'NO REGISTRATION FLOW'}
          </Chip>
          <span className="t-label">
            {value.registrationEnforced
              ? `${value.rootsClaimed} funding root(s) claimed`
              : 'the rule is not enforced by this gateway'}
          </span>
        </div>
        <p
          style={{ margin: 0, maxWidth: 680, fontSize: 13, lineHeight: 1.7, color: 'var(--ink-2)' }}
        >
          {value.registrationEnforced ? (
            <>
              A tab&rsquo;s <strong>funding root</strong> is the furthest non-system account that
              funded it — the operator, not the throwaway wallet that minted it, and not{' '}
              <code>0.0.2</code>, which funds every account on Hedera. The first tab to claim a root
              keeps it permanently, so minting a hundred agents from one wallet yields{' '}
              <strong>one</strong> starter floor rather than a hundred. The other ninety-nine still
              work — they are denied the free headroom, not the rail, and must earn their ceiling
              from independent revenue.
            </>
          ) : (
            <>
              This gateway reports that one Starter Tab per funding root is not enforced, so minting
              many agents from one wallet is not prevented.
            </>
          )}
        </p>
      </Card>

      <Card style={{ overflow: 'hidden' }}>
        <CardHead>
          <span>Tabs seen on the receipt topic</span>
          <span
            style={{
              marginLeft: 'auto',
              color: 'var(--ink-3)',
              textTransform: 'none',
              letterSpacing: 0,
            }}
          >
            {live ? (
              loading ? (
                'reading…'
              ) : error ? (
                `gateway unreachable — showing the last ${rows.length} known`
              ) : (
                `${rows.length} tab(s) · window ${fmtSeq(value.window)}`
              )
            ) : (
              <strong style={{ color: 'var(--caution)' }}>
                NOT CONFIGURED — set NEXT_PUBLIC_TAB_ACCOUNT_ID
              </strong>
            )}
          </span>
        </CardHead>
        <div className="tbl-scroll">
          <table className="tbl" style={{ minWidth: 860 }}>
            <thead>
              <tr>
                <th scope="col">Tab</th>
                <th scope="col" className="n">
                  Balance
                </th>
                <th scope="col" className="n">
                  Holds
                </th>
                <th scope="col" className="n">
                  Available
                </th>
                <th scope="col">Tier</th>
                <th scope="col" className="n">
                  Ceiling enforced
                </th>
                <th scope="col">Bound by</th>
                <th scope="col">Identity (HCS-14)</th>
                <th scope="col">Starter claim</th>
                <th scope="col" className="n">
                  Entries
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: '18px 14px', color: 'var(--ink-3)' }}>
                    {!live
                      ? 'No gateway configured.'
                      : loading
                        ? 'Reading the receipt topic…'
                        : 'No tab has transacted yet. Tabs appear here the first time they spend or earn.'}
                  </td>
                </tr>
              ) : null}
              {rows.map((t) => (
                <tr
                  key={t.tab}
                  style={{ background: t.tab === TAB_ID ? 'var(--pen-soft)' : undefined }}
                >
                  <td style={{ fontWeight: 500 }}>
                    {t.tab === TAB_ID ? (
                      <Link href="/app/tab" style={{ color: 'var(--pen)' }}>
                        {t.tab}
                      </Link>
                    ) : (
                      /*
                       * Only the watched tab links through.
                       *
                       * The other views read NEXT_PUBLIC_TAB_ACCOUNT_ID, so a
                       * link on another tab's row would navigate to a page
                       * showing the watched tab's figures under the wrong
                       * heading — a much worse outcome than no link.
                       */
                      <span title="The console watches one tab; set NEXT_PUBLIC_TAB_ACCOUNT_ID to inspect this one.">
                        {t.tab}
                      </span>
                    )}
                  </td>
                  <td
                    className="n"
                    style={{ color: t.balance < 0n ? 'var(--debit)' : 'var(--credit)' }}
                  >
                    {format(t.balance, { sign: 'always' })}
                  </td>
                  <td className="n" style={{ color: 'var(--ink-2)' }}>
                    {format(t.holds)}
                  </td>
                  <td className="n" style={{ fontWeight: 600 }}>
                    {format(t.available)}
                  </td>
                  <td style={{ color: tierTone(t.tier) }}>{t.tier ?? 'not published'}</td>
                  <td className="n" style={{ fontWeight: 600 }}>
                    {format(t.ceiling)}
                  </td>
                  <td style={{ color: 'var(--ink-2)' }}>
                    {t.binding ?? '—'}
                    {t.publishedCeiling !== undefined && t.publishedCeiling !== t.ceiling ? (
                      <span style={{ color: 'var(--caution)' }}>
                        {' '}
                        · published {format(t.publishedCeiling)}, not yet enforced
                      </span>
                    ) : null}
                  </td>
                  <td className="t-mono" style={{ fontSize: 12, color: 'var(--ink-2)' }}>
                    {t.uaid ? (
                      /*
                       * Truncated in the middle, not the end. The hash is the
                       * distinctive part and the `nativeId` suffix is what a
                       * reader recognises — cutting the tail would hide which
                       * account it belongs to.
                       */
                      <span title={t.uaid}>{`${t.uaid.slice(0, 18)}…${t.uaid.slice(-16)}`}</span>
                    ) : (
                      <span style={{ color: 'var(--ink-3)' }}>none published</span>
                    )}
                  </td>
                  <td style={{ color: 'var(--ink-2)' }}>
                    {t.registeredRoot ? (
                      <>
                        root {t.registeredRoot}
                        {t.registrationSeq !== undefined ? (
                          <span style={{ color: 'var(--ink-3)' }}>
                            {' '}
                            · seq {fmtSeq(t.registrationSeq)}
                          </span>
                        ) : null}
                      </>
                    ) : (
                      /*
                       * Absent is NOT "denied". The gateway cannot tell those
                       * apart — resolving a funding root needs `@tab/graph`,
                       * which it may not import — so it says what it knows.
                       */
                      <span style={{ color: 'var(--ink-3)' }}>none recorded</span>
                    )}
                  </td>
                  <td className="n" style={{ color: 'var(--ink-3)' }}>
                    {t.entries}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.some((t) => t.tier === undefined) ? (
          <p
            style={{
              margin: 0,
              padding: '10px 14px',
              borderTop: '1px solid var(--rule-soft)',
              color: 'var(--ink-2)',
              fontSize: 12.5,
            }}
          >
            <strong>none recorded</strong> means no Starter claim has been registered for that tab
            yet. <strong>not published</strong> means the engine has not scored it — different from{' '}
            <strong>Unrated</strong>, which is a tier the engine assigned and which carries a ×0
            multiple, and so no credit. Every value on this screen comes from a published message;
            nothing is inferred.
          </p>
        ) : null}
      </Card>

      {/* What a new tab actually gets — from the parameter set, not a stamp. */}
      <Card style={{ padding: '20px 22px', maxWidth: 620 }}>
        <div className="t-label" style={{ marginBottom: 14 }}>
          What a new tab starts with · {`tab-v${params.version}`}
        </div>
        <table className="tbl">
          <tbody>
            {[
              ['starter ceiling', format(caps.starterCeiling)],
              ['per-call cap', format(caps.perCall)],
              ['per-window cap', format(caps.perWindow)],
              ['opening ramp', formatBpPercent(bp(params.ramp.startBp))],
              ['tier', 'Unrated until the engine publishes'],
            ].map(([k, v]) => (
              <tr key={k}>
                <th
                  scope="row"
                  style={{
                    textAlign: 'left',
                    fontWeight: 400,
                    color: 'var(--ink-2)',
                    letterSpacing: 0,
                    textTransform: 'none',
                    fontSize: 12.5,
                  }}
                >
                  {k}
                </th>
                <td className="n" style={{ fontWeight: 600 }}>
                  {v}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--ink-2)', margin: '16px 0 0' }}>
          {format(caps.starterCeiling)} is a floor, not a grant: it exists so a brand-new agent can
          make its first calls at all, and earned credit passes it after three or four. v1&apos;s
          floor was {format(caps.perWindow)} — high enough that the grant decided a new agent&apos;s
          ceiling for its entire early life, which made the product&apos;s central claim untestable.
          That is the whole reason v2 exists.
        </p>
      </Card>
    </div>
  )
}
