'use client'

import { caps, MODEL_ID as MODEL_VERSION, params } from '@tab/params'
import type { PublishedCeilingView } from '@tab/sdk'
import { TopicLink } from '@/components/console/topic-link'
import { Card, CardHead, Chip } from '@/components/ui'
import { CopyButton } from '@/components/ui/copy-button'
import { seq as fmtSeq, shortConsensus } from '@/lib/format'
import { useCeiling } from '@/lib/hooks/use-ceiling'
import { bp, format, formatBpMultiple, formatBpPercent, micro } from '@/lib/money'

/**
 * The ceiling in force, the arithmetic that produced it, and how to check it.
 *
 * Read from the CEILING TOPIC through the gateway, never recomputed here.
 * `apps/web` cannot import `@tab/scoring`, and that boundary is load-bearing: a
 * console that recomputed the ceiling would hand a viewer a second answer to
 * compare against the topic, and two answers is worse than one even when they
 * agree.
 *
 * ## The button that used to be here
 *
 * A "Recompute and verify" button flipped a boolean and stamped VERIFIED in
 * green. It recomputed nothing. On a screen whose entire purpose is the claim
 * "you do not have to trust us", a fake verification stamp was the single worst
 * thing in this console — and it would have been filmed.
 *
 * Verification cannot honestly happen here, for the same reason the recompute
 * cannot: a checker that runs inside the thing being checked proves nothing.
 * `tools/verify` replays the topic itself, resolves each message's own `model`
 * field to the frozen parameter set it was published under, and trusts nothing
 * the gateway says. So this panel hands over the facts an auditor needs and the
 * exact command, and says plainly that it is not the verifier.
 */

/* ── the arithmetic, from the published inputs ───────────────────────────── */

interface CalcRow {
  label: string
  value: string
  emphasis?: 'sub' | 'term' | 'total' | 'result'
  binding?: boolean
}

/**
 * The published inputs, laid out as a calculation.
 *
 * These are the numbers ON THE TOPIC, arranged — not derived. Every value here
 * comes straight from `inputs`; nothing multiplies anything, because the moment
 * this file does arithmetic it becomes a second opinion about the ceiling.
 *
 * The one exception is deliberate and marked: the terms are shown so a reader
 * can follow `revenue × multiple × ramp`, and the RESULT shown is the published
 * `computed ?? ceiling`, never a product this file worked out.
 */
function calcRows(c: PublishedCeilingView, binding: string): CalcRow[] {
  const { inputs } = c
  return [
    { label: 'trailing revenue', value: format(inputs.revenue), emphasis: 'term' },
    { label: '  attested', value: format(inputs.revenueAttested), emphasis: 'sub' },
    {
      label: `  unattested × ${formatBpPercent(bp(params.unattestedDiscountBp), 0)}`,
      value: format(inputs.revenueUnattested),
      emphasis: 'sub',
    },
    {
      label: `tier ${inputs.tier}`,
      value: `× ${formatBpMultiple(bp(inputs.multBp))}`,
      emphasis: 'term',
    },
    { label: 'earned ramp', value: `× ${formatBpPercent(bp(inputs.rampBp), 0)}`, emphasis: 'term' },
    {
      label: 'hard cap',
      value: format(inputs.cap),
      emphasis: 'total',
      binding: binding === 'hard_cap',
    },
    {
      label: 'starter floor',
      value: format(inputs.floor),
      emphasis: 'total',
      binding: binding === 'starter_floor',
    },
    {
      label: inputs.defaulted ? 'DEFAULTED — zero, whatever the revenue' : 'ceiling in force',
      value: format(c.computed ?? c.ceiling),
      emphasis: 'result',
      binding: binding === 'computed' || binding === 'unrated',
    },
  ]
}

function ruleFor(row: CalcRow): string {
  if (row.emphasis === 'result') return '0'
  if (row.emphasis === 'total') return 'var(--bw) solid var(--ink)'
  if (row.binding) return '4px double var(--ink)'
  return '1px solid var(--rule-soft)'
}

/** What actually bound, in a sentence. The most useful fact on the screen. */
function bindingNote(c: PublishedCeilingView): string {
  const cause = `cause ${c.cause}`
  switch (c.binding) {
    case 'starter_floor':
      return `The starter floor bound at ${format(c.inputs.floor)} — earned credit has not yet passed it. ${cause}.`
    case 'hard_cap':
      return `The hard cap bound at ${format(c.inputs.cap)} — earned credit exceeded the tier limit. ${cause}.`
    case 'unrated':
      return c.inputs.defaulted
        ? `This tab has MISSED a settlement, so the ceiling is exactly zero whatever the revenue. ${cause}.`
        : `Tier Unrated carries a ×0 multiple, so earned credit computes to zero. ${cause}.`
    case 'computed':
      return `Earned credit bound — neither the floor nor the cap. ${cause}.`
    default:
      return `Bound by ${c.binding}. ${cause}.`
  }
}

/* ── the history chart ───────────────────────────────────────────────────── */

const PLOT = { left: 66, right: 706, top: 30, bottom: 214 }

/**
 * A stepped path from the published series.
 *
 * Stepped, not smoothed: a ceiling changes discretely, at the moment a message
 * lands, and a curve between two points would draw a value that was never in
 * force. The demo's central moment is a vertical drop to zero, and a spline
 * would soften exactly the thing worth showing.
 */
function stepPath(series: readonly PublishedCeilingView[], max: bigint): string {
  if (series.length === 0) return ''
  const span = PLOT.right - PLOT.left
  const height = PLOT.bottom - PLOT.top
  // Presentation geometry only — never a decision input, which is why floats
  // are fine here and nowhere near the money.
  const x = (i: number) =>
    PLOT.left + (series.length === 1 ? span : (span * i) / (series.length - 1))
  const y = (v: bigint) =>
    max <= 0n ? PLOT.bottom : PLOT.bottom - (height * Number(v)) / Number(max)

  let d = `M${x(0)} ${y(series[0]!.ceiling)}`
  for (let i = 1; i < series.length; i++) {
    // Horizontal to the new x at the OLD y, then vertical to the new y. That is
    // what "held, then changed" looks like.
    d += ` L${x(i)} ${y(series[i - 1]!.ceiling)} L${x(i)} ${y(series[i]!.ceiling)}`
  }
  return d
}

export default function CeilingView() {
  const { value, live, error, loading } = useCeiling()
  const current = value.current
  const history = value.history

  /*
   * Scale from the largest ceiling ever PUBLISHED — never from the hard cap.
   *
   * Seeding this with `inputs.cap` seemed safer and was wrong on live data: the
   * cap is 100.000000 while no ceiling this tab ever held exceeded 1.000000, so
   * the whole eleven-point series — including the one collapse worth showing —
   * drew as a flat line one pixel off the bottom axis.
   *
   * The starter floor is the fallback when every published ceiling is zero, so
   * a tab that has only ever been blocked still gets a scale rather than a
   * division by zero.
   */
  const ceilingMax = history.reduce((m, c) => (c.ceiling > m ? c.ceiling : m), micro(0n))
  const scaleMax = ceilingMax > 0n ? ceilingMax : (current?.inputs.floor ?? caps.starterCeiling)
  const path = stepPath(history, scaleMax)
  // The endpoint marker always sits at the right edge, because `stepPath` maps
  // the last element there. (This was a ternary whose two branches computed the
  // same number — dead choice, kept nothing.)
  const lastX = PLOT.right
  const lastY =
    scaleMax <= 0n || !current
      ? PLOT.bottom
      : PLOT.bottom - ((PLOT.bottom - PLOT.top) * Number(current.ceiling)) / Number(scaleMax)

  /** The gap that matters: published vs what the fast path is checking now. */
  const lagging = current !== undefined && current.ceiling !== value.enforced

  if (!live) {
    return (
      <Card style={{ padding: 24 }}>
        <div className="t-label" style={{ marginBottom: 8 }}>
          Ceiling
        </div>
        <p style={{ margin: 0, maxWidth: 560, lineHeight: 1.7, color: 'var(--ink-2)' }}>
          <strong style={{ color: 'var(--caution)' }}>NOT CONFIGURED.</strong> This view shows what
          the engine published to the ceiling topic. Set <code>NEXT_PUBLIC_TAB_ACCOUNT_ID</code> to
          point it at a tab.
        </p>
      </Card>
    )
  }

  return (
    <div className="ceiling-grid">
      <div style={{ display: 'grid', gap: 20 }}>
        <Card style={{ overflow: 'hidden' }}>
          <CardHead
            title="Inputs in force"
            right={
              <span style={{ textTransform: 'none', letterSpacing: 0, color: 'var(--ink-3)' }}>
                {loading
                  ? 'reading the ceiling topic…'
                  : current
                    ? `window ${fmtSeq(current.window)} · ${shortConsensus(current.at)}`
                    : 'nothing published yet'}
              </span>
            }
          />
          {current ? (
            <table className="tbl" style={{ fontSize: 14 }}>
              <tbody>
                {calcRows(current, current.binding).map((row) => {
                  const strong = row.emphasis === 'result' || row.emphasis === 'term'
                  const colour =
                    row.emphasis === 'result'
                      ? 'var(--pen)'
                      : row.emphasis === 'sub'
                        ? 'var(--ink-3)'
                        : 'var(--ink)'
                  return (
                    <tr key={row.label} style={{ background: 'transparent' }}>
                      <th
                        scope="row"
                        style={{
                          textAlign: 'left',
                          padding: '9px 16px',
                          borderBottom: ruleFor(row),
                          fontWeight: strong ? 600 : 400,
                          color: colour,
                          letterSpacing: 0,
                          textTransform: 'none',
                          fontSize: 14,
                          fontFamily: 'var(--font-mono)',
                          whiteSpace: 'pre',
                        }}
                      >
                        {row.label}
                      </th>
                      <td
                        className="n"
                        style={{
                          padding: '9px 16px',
                          borderBottom: ruleFor(row),
                          fontWeight: strong ? 600 : 400,
                          color: colour,
                        }}
                      >
                        {row.value}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          ) : (
            <div style={{ padding: 18, color: 'var(--ink-2)', lineHeight: 1.7 }}>
              {loading ? (
                'Reading the ceiling topic…'
              ) : (
                <>
                  No ceiling has been published for this tab yet — the normal state for its first
                  minutes. The gateway is enforcing{' '}
                  <strong className="t-mono">{format(value.enforced)}</strong> meanwhile: the
                  starter ceiling.
                </>
              )}
            </div>
          )}

          {current ? (
            <div
              className="rule-t"
              style={{
                padding: '12px 16px',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                flexWrap: 'wrap',
              }}
            >
              <Chip tone={current.binding === 'unrated' ? 'block' : 'caution'}>BINDING</Chip>
              <span className="t-mono" style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>
                {bindingNote(current)}
              </span>
            </div>
          ) : null}

          {current?.computed !== undefined ? (
            <div
              className="rule-t"
              style={{
                padding: '12px 16px',
                display: 'flex',
                gap: 10,
                flexWrap: 'wrap',
                alignItems: 'center',
              }}
            >
              <Chip tone="caution">HELD</Chip>
              <span className="t-mono" style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>
                The formula computes {format(current.computed)}, but {format(current.ceiling)} is in
                force — a GROWTH waits for a clean settlement, while a shrink applies at once. Trust
                is slower to earn than to lose, and the topic carries both numbers so the asymmetry
                is auditable rather than a discrepancy.
              </span>
            </div>
          ) : null}

          {lagging ? (
            <div
              className="rule-t"
              style={{
                padding: '12px 16px',
                display: 'flex',
                gap: 10,
                flexWrap: 'wrap',
                alignItems: 'center',
              }}
            >
              <Chip tone="caution">NOT YET ENFORCED</Chip>
              <span className="t-mono" style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>
                Published {format(current!.ceiling)}, enforced {format(value.enforced)}. The gateway
                polls this topic every 15s, so a fresh publication can be on the record and not yet
                in the fast path. The enforced figure is the one a spend will be checked against.
              </span>
            </div>
          ) : null}
        </Card>

        <Card>
          <CardHead
            title="Ceiling history · stepped, because a ceiling changes discretely"
            right={
              <span style={{ textTransform: 'none', letterSpacing: 0, color: 'var(--ink-3)' }}>
                {history.length} publication(s)
              </span>
            }
          />
          <div style={{ padding: '20px 16px' }}>
            {history.length === 0 ? (
              <p style={{ margin: 0, color: 'var(--ink-3)' }}>
                Nothing published yet — no series to draw. An empty chart with invented steps would
                be worse than an empty chart.
              </p>
            ) : (
              <svg
                viewBox="0 0 720 250"
                style={{ width: '100%', height: 'auto', display: 'block' }}
                role="img"
                aria-label={`Stepped ceiling history across ${history.length} publications`}
              >
                <g stroke="var(--rule-soft)" strokeWidth={1}>
                  {[PLOT.top, 75, 120, 165, PLOT.bottom].map((y) => (
                    <line key={y} x1={PLOT.left} y1={y} x2={PLOT.right} y2={y} />
                  ))}
                </g>
                <g fontFamily="IBM Plex Mono, monospace" fontSize={11} fill="var(--ink-3)">
                  {/* Axis labelled from the REAL maximum, so the shape of the
                      series is honest rather than fitted to a fixed scale. */}
                  {[0, 1, 2, 3, 4].map((i) => (
                    <text key={i} x={8} y={PLOT.bottom + 4 - ((PLOT.bottom - PLOT.top) * i) / 4}>
                      {format(micro((scaleMax * BigInt(i)) / 4n))}
                    </text>
                  ))}
                </g>
                <path d={path} fill="none" stroke="var(--ink)" strokeWidth={2.5} />
                <circle
                  cx={lastX}
                  cy={lastY}
                  r={5}
                  fill="var(--pen)"
                  stroke="var(--ink)"
                  strokeWidth={2.5}
                />
              </svg>
            )}
          </div>
          {history.length > 0 ? (
            <div className="tbl-scroll rule-t">
              <table className="tbl" style={{ minWidth: 620, fontSize: 13 }}>
                <thead>
                  <tr>
                    <th scope="col">Seq</th>
                    <th scope="col">Window</th>
                    <th scope="col" className="n">
                      Ceiling
                    </th>
                    <th scope="col">Bound by</th>
                    <th scope="col">Cause</th>
                  </tr>
                </thead>
                <tbody>
                  {[...history].reverse().map((c, i) => (
                    <tr key={`${c.seq ?? i}-${c.at}`}>
                      <td className="n" style={{ color: 'var(--ink-3)' }}>
                        {c.seq !== undefined ? fmtSeq(c.seq) : '—'}
                      </td>
                      <td>{fmtSeq(c.window)}</td>
                      <td
                        className="n"
                        style={{
                          fontWeight: 600,
                          color: c.ceiling === 0n ? 'var(--debit)' : 'var(--ink)',
                        }}
                      >
                        {format(c.ceiling)}
                      </td>
                      <td style={{ color: 'var(--ink-2)' }}>{c.binding}</td>
                      <td
                        style={{
                          color: c.cause === 'graph_change' ? 'var(--debit)' : 'var(--ink-2)',
                        }}
                      >
                        {c.cause}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </Card>
      </div>

      {/* The no-smart-contract argument, made operable — by a tool, not by us. */}
      <Card>
        <CardHead title="Verify · no contract required" />
        <div style={{ padding: 18, display: 'grid', gap: 14 }}>
          <div>
            <div className="t-label" style={{ marginBottom: 4 }}>
              MODEL_VERSION
            </div>
            <div className="t-mono" style={{ fontSize: 14, fontWeight: 600 }}>
              {current?.model ?? MODEL_VERSION}
            </div>
            {current && current.model !== MODEL_VERSION ? (
              <div style={{ fontSize: 12, color: 'var(--caution)', marginTop: 4 }}>
                Published under {current.model}; this console is built against {MODEL_VERSION}. The
                verifier resolves each message&apos;s own model field, so the older ceiling stays
                recomputable — that is why parameter sets are frozen and never edited.
              </div>
            ) : null}
          </div>

          <div
            style={{
              border: 'var(--bw) solid var(--ink)',
              borderRadius: 2,
              padding: 12,
              background: 'var(--sunk)',
              minHeight: 76,
            }}
          >
            <div className="t-label" style={{ marginBottom: 6 }}>
              Canonical input hash
            </div>
            <div
              className="t-mono"
              style={{ fontSize: 12.5, wordBreak: 'break-all', lineHeight: 1.6 }}
            >
              {current?.hash ?? (loading ? '…' : 'none published')}
            </div>
          </div>

          <div
            className="t-mono"
            style={{
              fontSize: 12.5,
              color: 'var(--ink-2)',
              display: 'flex',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <span>HCS sequence</span>
            {/*
             * The ceilings topic, read from the gateway. This linked to
             * `TOPICS.ceilings` — a mock id holding no messages — on the one
             * screen whose whole argument is "go and check this yourself".
             */}
            <TopicLink kind="ceilings" style={{ color: 'var(--pen)' }}>
              {current?.seq !== undefined ? fmtSeq(current.seq) : '—'} ↗
            </TopicLink>
          </div>

          {/*
           * No VERIFIED stamp, and no button that pretends to compute one.
           *
           * A checker that runs inside the thing being checked proves nothing.
           * The command below replays the topic itself, resolves each
           * message's own `model` field to the frozen parameter set it was
           * published under, and trusts nothing this gateway says — which is
           * the only kind of verification worth showing.
           */}
          <div
            style={{
              border: '1px dashed var(--ink-3)',
              borderRadius: 2,
              padding: 12,
              display: 'grid',
              gap: 10,
            }}
          >
            <div className="t-label">Check it yourself</div>
            <code className="t-mono" style={{ fontSize: 12.5, wordBreak: 'break-all' }}>
              pnpm verify-ceiling
            </code>
            <CopyButton
              value="pnpm verify-ceiling"
              idleLabel="Copy command"
              className="btn btn-sm"
            />
          </div>

          <p style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--ink-2)', margin: 0 }}>
            The sequence number, model id and input hash above are everything needed to find this
            message on HashScan and recompute it independently. <code>verify-ceiling</code> replays
            the topic, recomputes each ceiling from the frozen parameter set the message names, and
            reports any mismatch — no database and no credential of ours required. That is the whole
            claim, and it is checkable.
          </p>

          {error ? (
            <p style={{ margin: 0, fontSize: 12.5, color: 'var(--caution)' }}>
              Gateway unreachable — the figures above are the last ones read.
            </p>
          ) : null}
        </div>
      </Card>
    </div>
  )
}
