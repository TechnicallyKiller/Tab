import { MODEL_ID as MODEL_VERSION } from '@tab/params'
import { TopicId } from '@/components/console/topic-link'
import { Callout, DocsH2, DocsP } from '@/components/docs/parts'
import { SequenceDiagram } from '@/components/landing/diagrams'
import { Card, CardHead, Chip, CodeBlock } from '@/components/ui'
import { CopyButton } from '@/components/ui/copy-button'
import {
  BUILD_ON_TAB,
  CALLOUTS,
  HCS14_DERIVATION,
  PROTOCOL_MESSAGES,
  QUICKSTART,
  RECEIPT_SCHEMA,
  REFUSAL_CODES_DOC as REFUSAL_CODES,
  SPEND_ORDER,
  SPEND_PARAMS,
  WEIGHT_ALGEBRA,
} from '@/lib/docs'

export default function DocsPage() {
  return (
    <>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 10,
          alignItems: 'center',
          marginBottom: 14,
        }}
      >
        <span className="t-label">Start here</span>
        <Chip tone="pen">{MODEL_VERSION}</Chip>
      </div>
      <h1 id="quickstart" className="t-display" style={{ fontSize: 44, margin: '0 0 16px' }}>
        Quickstart
      </h1>
      <DocsP>
        Four steps. At the end of them, an agent with no wallet, no key and no USDC has paid a
        seller and you can read the receipt on HCS. The numbering is a sequence — order carries
        information.
      </DocsP>

      {QUICKSTART.map((s) => (
        <div
          key={s.n}
          style={{
            display: 'grid',
            gridTemplateColumns: '34px minmax(0,1fr)',
            gap: 16,
            marginBottom: 26,
          }}
        >
          <div
            className="t-mono"
            style={{
              fontSize: 19,
              fontWeight: 600,
              border: 'var(--bw) solid var(--ink)',
              borderRadius: 2,
              width: 34,
              height: 34,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--surface)',
            }}
          >
            {s.n}
          </div>
          <div style={{ minWidth: 0 }}>
            <h3 className="t-display-700" style={{ fontSize: 19, margin: '4px 0 6px' }}>
              {s.title}
            </h3>
            <p
              style={{
                fontSize: 14,
                lineHeight: 1.7,
                color: 'var(--ink-2)',
                margin: '0 0 12px',
                maxWidth: '68ch',
              }}
            >
              {s.body}
            </p>
            <CodeBlock lang={s.lang} code={s.code} action={<CopyButton value={s.code} />} />
          </div>
        </div>
      ))}

      <Card style={{ background: 'var(--sunk)', padding: 22, margin: '36px 0 56px' }}>
        <div className="t-display" style={{ fontSize: 24, marginBottom: 6 }}>
          The agent signed nothing.
        </div>
        <div style={{ fontSize: 16, lineHeight: 1.7, color: 'var(--ink-2)' }}>
          It holds no USDC. No key was provisioned. The gateway paid the seller from house float and
          moved your running balance by 0.0400.
        </div>
      </Card>

      <DocsH2 id="callouts">Reading the callouts</DocsH2>
      <DocsP>
        Four kinds, distinguished by border and label. <b>REFUSES</b> is Tab-specific and appears on
        every endpoint that can decline.
      </DocsP>
      <div style={{ display: 'grid', gap: 12, marginBottom: 56 }}>
        {CALLOUTS.map((c) => (
          <Callout key={c.label} label={c.label} tone={c.tone}>
            {c.body}
          </Callout>
        ))}
      </div>

      <DocsH2 id="spend">POST /v1/spend</DocsH2>
      <DocsP>
        Requests a spend against the tab. The gateway performs the six fast-path checks, writes a
        hold, pays the seller over x402, and returns the seller&rsquo;s response body.
      </DocsP>

      <div
        className="card-flat t-mono"
        style={{ padding: '14px 16px', fontSize: 14, marginBottom: 22, overflowX: 'auto' }}
      >
        <span style={{ color: 'var(--pen)', fontWeight: 600 }}>spend</span>
        {'(url: '}
        <span style={{ color: 'var(--pen)' }}>string</span>
        {', max: '}
        <span style={{ color: 'var(--pen)' }}>Usdc</span>
        {', idempotencyKey?: '}
        <span style={{ color: 'var(--pen)' }}>string</span>
        {') → '}
        <span style={{ color: 'var(--pen)' }}>SpendResult</span>
      </div>

      <Card flat style={{ overflow: 'hidden', marginBottom: 22 }}>
        <CardHead title="Parameters" />
        <div className="tbl-scroll">
          <table className="tbl" style={{ minWidth: 520, fontSize: 14 }}>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Type</th>
                <th scope="col">Meaning</th>
              </tr>
            </thead>
            <tbody>
              {SPEND_PARAMS.map((p) => (
                <tr key={p.name}>
                  <td style={{ fontWeight: 600 }}>{p.name}</td>
                  <td style={{ color: 'var(--pen)' }}>{p.type}</td>
                  <td
                    style={{
                      color: 'var(--ink-2)',
                      lineHeight: 1.6,
                      fontFamily: 'var(--font-sans)',
                    }}
                  >
                    {p.meaning}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div style={{ marginBottom: 18 }}>
        <Callout label="Refuses" tone="caution">
          Handling refusal is the agent developer&rsquo;s main job. Every code this endpoint can
          return, and the condition that fires it:
        </Callout>
      </div>

      <Card id="refusal-codes" style={{ overflow: 'hidden', marginBottom: 56 }}>
        <CardHead
          title="Refusal codes"
          right={
            <span style={{ color: 'var(--ink-3)', textTransform: 'none', letterSpacing: 0 }}>
              every row is linkable
            </span>
          }
        />
        <div className="tbl-scroll">
          <table className="tbl" style={{ minWidth: 620, fontSize: 14 }}>
            <thead>
              <tr>
                <th scope="col">Code</th>
                <th scope="col">Fires when</th>
                <th scope="col">Agent should</th>
                <th scope="col">Retry?</th>
              </tr>
            </thead>
            <tbody>
              {REFUSAL_CODES.map((c) => (
                <tr key={c.id} id={c.id}>
                  <td style={{ fontWeight: 600, whiteSpace: 'nowrap', color: 'var(--debit)' }}>
                    {c.code}
                  </td>
                  <td
                    style={{
                      color: 'var(--ink-2)',
                      lineHeight: 1.6,
                      fontFamily: 'var(--font-sans)',
                    }}
                  >
                    {c.when}
                  </td>
                  <td style={{ lineHeight: 1.6, fontFamily: 'var(--font-sans)' }}>{c.next}</td>
                  {/*
                   * Straight from `isRetryable` in @tab/protocol. Two of the six
                   * can succeed later and four never can, and an agent that
                   * retries the four burns its budget rediscovering that.
                   */}
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {c.retryable ? (
                      <Chip tone="pen">later</Chip>
                    ) : (
                      <span style={{ color: 'var(--ink-3)' }}>never</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <DocsH2 id="ceiling-formula">The ceiling formula</DocsH2>
      <DocsP>
        Displayed as arithmetic, with each term labelled, because a reader has to be able to check
        it against the CEILING view in the console.
      </DocsP>
      <Card style={{ padding: 22, marginBottom: 20 }}>
        <div className="t-mono" style={{ fontSize: 14, lineHeight: 2.2 }}>
          <div style={{ marginBottom: 12 }}>
            <span style={{ color: 'var(--pen)', fontWeight: 600 }}>ceiling</span> = min(
          </div>
          <div style={{ paddingLeft: 22, display: 'grid', gap: 10 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <Boxed>trailing_attested_revenue</Boxed>
              <Op>×</Op>
              <Boxed>tier_multiple</Boxed>
              <Op>×</Op>
              <Boxed>ramp_factor</Boxed>
              <Op>,</Op>
            </div>
            <div>
              <Boxed>hard_cap[tier]</Boxed>
            </div>
          </div>
          <div style={{ marginTop: 12 }}>)</div>
          <div
            style={{
              borderTop: '1px solid var(--rule-soft)',
              marginTop: 16,
              paddingTop: 12,
              fontSize: 12.5,
              color: 'var(--ink-3)',
              lineHeight: 1.9,
            }}
          >
            <div>tier_multiple &nbsp;A 3.0 · B 2.0 · C 1.0 · Unrated 0</div>
            <div>
              ramp_factor &nbsp;&nbsp;starts 15%, +15% per clean settlement, −30% per missed
            </div>
            <div>
              a tab below its starter floor is raised to the floor unless the tier is Unrated
            </div>
          </div>
        </div>
      </Card>

      <DocsH2 id="schema">HCS receipt message</DocsH2>
      <div style={{ marginBottom: 56 }}>
        <CodeBlock
          lang="json · a message off the receipts topic"
          code={RECEIPT_SCHEMA}
          action={
            <span className="t-label" style={{ textTransform: 'none', letterSpacing: 0 }}>
              topic <TopicId kind="receipts" />
            </span>
          }
        />
      </div>

      <DocsH2 id="sequence">Spend, as a sequence</DocsH2>
      <Card style={{ padding: 22, marginBottom: 40 }}>
        <SequenceDiagram />
      </Card>

      <DocsH2 id="messages">The ten messages</DocsH2>
      <DocsP>
        This is the whole protocol. Everything the console shows, everything <code>verify-tab</code>{' '}
        checks and everything a stranger can replay is one of these — there is no private
        side-channel and no stored row that is not derived from a message on one of the three
        topics. Field names are the wire names, kept short because HCS charges by the byte and a
        receipt that needs chunking is one that can arrive in pieces.
      </DocsP>
      <Card style={{ overflow: 'hidden', marginBottom: 40 }}>
        <div className="tbl-scroll">
          <table className="tbl" style={{ minWidth: 760, fontSize: 13.5 }}>
            <thead>
              <tr>
                <th scope="col">Type</th>
                <th scope="col">Written by</th>
                <th scope="col">Topic</th>
                <th scope="col">Fields</th>
                <th scope="col">When</th>
              </tr>
            </thead>
            <tbody>
              {PROTOCOL_MESSAGES.map((m) => (
                <tr key={m.t}>
                  <td className="t-mono" style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                    {m.t}
                  </td>
                  <td style={{ color: 'var(--ink-2)', whiteSpace: 'nowrap' }}>{m.by}</td>
                  <td style={{ color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>{m.topic}</td>
                  <td className="t-mono" style={{ color: 'var(--ink-3)', fontSize: 12 }}>
                    {m.fields}
                  </td>
                  <td style={{ lineHeight: 1.6, fontFamily: 'var(--font-sans)' }}>{m.when}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <DocsH2 id="write-ahead">The write-ahead order</DocsH2>
      <DocsP>
        <code>reserve → pay → commit</code>. The hold is published and <em>awaited to consensus</em>{' '}
        before the seller is called. That costs two to four seconds and buys the one thing a
        stranger cannot otherwise check: that every debit was authorised before the money moved.
      </DocsP>
      <div style={{ display: 'grid', gap: 12, marginBottom: 40 }}>
        {SPEND_ORDER.map((s, i) => (
          <div
            key={s.step}
            style={{
              display: 'grid',
              gridTemplateColumns: '26px 92px 1fr',
              gap: 14,
              alignItems: 'start',
            }}
          >
            <span className="t-mono" style={{ color: 'var(--ink-3)', fontSize: 12, paddingTop: 3 }}>
              {i + 1}
            </span>
            <span className="t-mono" style={{ fontWeight: 600, fontSize: 13 }}>
              {s.step}
            </span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13.5 }}>{s.what}</div>
              <div style={{ color: 'var(--ink-2)', fontSize: 13, lineHeight: 1.6 }}>
                {s.guarantee}
              </div>
            </div>
          </div>
        ))}
      </div>

      <DocsH2 id="weights">How revenue is weighted</DocsH2>
      <DocsP>
        A counterparty&rsquo;s revenue is not worth its face value. Three reasons zero it outright —
        the revenue is not independent demand in any amount — and the rest multiply, truncating down
        at each step in a fixed order, so the result never depends on evaluation order and never
        rounds in the agent&rsquo;s favour.
      </DocsP>
      <div className="grid2" style={{ display: 'grid', gap: 16, marginBottom: 40 }}>
        <Card style={{ overflow: 'hidden' }}>
          <CardHead title="Blocking · weight becomes zero" />
          <table className="tbl">
            <tbody>
              {WEIGHT_ALGEBRA.blocking.map((r) => (
                <tr key={r.reason}>
                  <td
                    className="t-mono"
                    style={{ fontWeight: 600, whiteSpace: 'nowrap', color: 'var(--debit)' }}
                  >
                    {r.reason}
                  </td>
                  <td
                    style={{
                      color: 'var(--ink-2)',
                      lineHeight: 1.6,
                      fontFamily: 'var(--font-sans)',
                    }}
                  >
                    {r.detail}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card style={{ overflow: 'hidden' }}>
          <CardHead title="Discounting · these multiply" />
          <table className="tbl">
            <tbody>
              {WEIGHT_ALGEBRA.discounts.map((r) => (
                <tr key={r.reason}>
                  <td className="t-mono" style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                    {r.reason}
                  </td>
                  <td className="n" style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                    {r.multiplier}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <DocsH2 id="identity">HCS-14 identity</DocsH2>
      <DocsP>
        The agent is addressable as a UAID, not only as an account number — and the identifier is
        derived from what the agent <em>is</em>, so two parties computing it from the same facts get
        the same string and nobody has to be trusted to issue it.
      </DocsP>
      <div style={{ marginBottom: 16 }}>
        <CodeBlock
          lang="text · derivation"
          code={
            HCS14_DERIVATION.fields.join(' · ') +
            '\n\n' +
            HCS14_DERIVATION.steps.map((s, i) => `${i + 1}. ${s}`).join('\n') +
            '\n\n' +
            HCS14_DERIVATION.live
          }
        />
      </div>
      <DocsP>{HCS14_DERIVATION.note}</DocsP>

      <DocsH2 id="build">Build on Tab</DocsH2>
      <DocsP>
        Four surfaces over one gateway, and deliberately the same ten verbs: <code>@tab/sdk</code>{' '}
        defines the interface, and the MCP server, the Agent Kit plugin and the CLI all bind to it.
        Two of the ten act; the other eight only read what was published.
      </DocsP>
      <DocsP>
        Published on npm as <code>@0xdivyanshh/tab-*</code>. The HTTP API needs no install at all —
        which is why the quickstart above is curl.
      </DocsP>

      <div style={{ display: 'grid', gap: 16, marginBottom: 56 }}>
        {BUILD_ON_TAB.map((b) => (
          <div key={b.id} id={b.id}>
            <h3 style={{ margin: '0 0 6px', fontSize: 16 }}>{b.title}</h3>
            <p
              style={{
                margin: '0 0 12px',
                color: 'var(--ink-2)',
                fontSize: 13.5,
                lineHeight: 1.65,
                maxWidth: 680,
              }}
            >
              {b.body}
            </p>
            <CodeBlock lang={b.lang} code={b.code} />
          </div>
        ))}
      </div>
    </>
  )
}

function Boxed({ children }: { children: string }) {
  return (
    <span
      style={{
        border: 'var(--bw) solid var(--ink)',
        borderRadius: 2,
        padding: '5px 9px',
        background: 'var(--sunk)',
      }}
    >
      {children}
    </span>
  )
}
function Op({ children }: { children: string }) {
  return <span style={{ color: 'var(--ink-3)' }}>{children}</span>
}
