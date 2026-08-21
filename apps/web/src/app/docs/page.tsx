import { SequenceDiagram } from '@/components/landing/diagrams'
import { Callout, DocsH2, DocsP } from '@/components/docs/parts'
import { Card, CardHead, Chip, CodeBlock } from '@/components/ui'
import { CopyButton } from '@/components/ui/copy-button'
import { MODEL_VERSION, TOPICS } from '@/lib/mock/tab'
import { CALLOUTS, QUICKSTART, RECEIPT_SCHEMA, REFUSAL_CODES, SPEND_PARAMS } from '@/lib/mock/docs'

export default function DocsPage() {
  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 14 }}>
        <span className="t-label">Start here</span>
        <Chip tone="pen">{MODEL_VERSION}</Chip>
      </div>
      <h1 id="quickstart" className="t-display" style={{ fontSize: 44, margin: '0 0 16px' }}>
        Quickstart
      </h1>
      <DocsP>
        Four steps. At the end of them, an agent with no wallet, no key and no USDC has paid a seller
        and you can read the receipt on HCS. The numbering is a sequence — order carries information.
      </DocsP>

      {QUICKSTART.map((s) => (
        <div key={s.n} style={{ display: 'grid', gridTemplateColumns: '34px minmax(0,1fr)', gap: 16, marginBottom: 26 }}>
          <div
            className="t-mono"
            style={{
              fontSize: 19, fontWeight: 600, border: 'var(--bw) solid var(--ink)', borderRadius: 2,
              width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'var(--surface)',
            }}
          >
            {s.n}
          </div>
          <div style={{ minWidth: 0 }}>
            <h3 className="t-display-700" style={{ fontSize: 19, margin: '4px 0 6px' }}>{s.title}</h3>
            <p style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--ink-2)', margin: '0 0 12px', maxWidth: '68ch' }}>
              {s.body}
            </p>
            <CodeBlock lang={s.lang} code={s.code} action={<CopyButton value={s.code} />} />
          </div>
        </div>
      ))}

      <Card style={{ background: 'var(--sunk)', padding: 22, margin: '36px 0 56px' }}>
        <div className="t-display" style={{ fontSize: 24, marginBottom: 6 }}>The agent signed nothing.</div>
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
        Requests a spend against the tab. The gateway performs the six fast-path checks, writes a hold,
        pays the seller over x402, and returns the seller&rsquo;s response body.
      </DocsP>

      <div className="card-flat t-mono" style={{ padding: '14px 16px', fontSize: 14, marginBottom: 22, overflowX: 'auto' }}>
        <span style={{ color: 'var(--pen)', fontWeight: 600 }}>spend</span>
        {'(url: '}<span style={{ color: 'var(--pen)' }}>string</span>
        {', max: '}<span style={{ color: 'var(--pen)' }}>Usdc</span>
        {', idempotencyKey?: '}<span style={{ color: 'var(--pen)' }}>string</span>
        {') → '}<span style={{ color: 'var(--pen)' }}>SpendResult</span>
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
                  <td style={{ color: 'var(--ink-2)', lineHeight: 1.6, fontFamily: 'var(--font-sans)' }}>
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
        <CardHead title="Refusal codes" right={<span style={{ color: 'var(--ink-3)', textTransform: 'none', letterSpacing: 0 }}>every row is linkable</span>} />
        <div className="tbl-scroll">
          <table className="tbl" style={{ minWidth: 620, fontSize: 14 }}>
            <thead>
              <tr>
                <th scope="col">Code</th>
                <th scope="col">Fires when</th>
                <th scope="col">Agent should</th>
              </tr>
            </thead>
            <tbody>
              {REFUSAL_CODES.map((c) => (
                <tr key={c.id} id={c.id}>
                  <td style={{ fontWeight: 600, whiteSpace: 'nowrap', color: 'var(--debit)' }}>{c.code}</td>
                  <td style={{ color: 'var(--ink-2)', lineHeight: 1.6, fontFamily: 'var(--font-sans)' }}>{c.when}</td>
                  <td style={{ lineHeight: 1.6, fontFamily: 'var(--font-sans)' }}>{c.next}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <DocsH2 id="ceiling-formula">The ceiling formula</DocsH2>
      <DocsP>
        Displayed as arithmetic, with each term labelled, because a reader has to be able to check it
        against the CEILING view in the console.
      </DocsP>
      <Card style={{ padding: 22, marginBottom: 20 }}>
        <div className="t-mono" style={{ fontSize: 14, lineHeight: 2.2 }}>
          <div style={{ marginBottom: 12 }}>
            <span style={{ color: 'var(--pen)', fontWeight: 600 }}>ceiling</span> = min(
          </div>
          <div style={{ paddingLeft: 22, display: 'grid', gap: 10 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <Boxed>trailing_attested_revenue</Boxed><Op>×</Op>
              <Boxed>tier_multiple</Boxed><Op>×</Op>
              <Boxed>ramp_factor</Boxed><Op>,</Op>
            </div>
            <div><Boxed>hard_cap[tier]</Boxed></div>
          </div>
          <div style={{ marginTop: 12 }}>)</div>
          <div style={{ borderTop: '1px solid var(--rule-soft)', marginTop: 16, paddingTop: 12, fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.9 }}>
            <div>tier_multiple &nbsp;A 3.0 · B 2.0 · C 1.0 · Unrated 0</div>
            <div>ramp_factor &nbsp;&nbsp;starts 15%, +15% per clean settlement, −30% per missed</div>
            <div>a tab below its starter floor is raised to the floor unless the tier is Unrated</div>
          </div>
        </div>
      </Card>

      <DocsH2 id="schema">HCS receipt message</DocsH2>
      <div style={{ marginBottom: 56 }}>
        <CodeBlock
          lang="json · schema v2"
          code={RECEIPT_SCHEMA}
          action={<span className="t-label" style={{ textTransform: 'none', letterSpacing: 0 }}>topic {TOPICS.receipts}</span>}
        />
      </div>

      <DocsH2 id="sequence">Spend, as a sequence</DocsH2>
      <Card style={{ padding: 22, marginBottom: 40 }}>
        <SequenceDiagram />
      </Card>
    </>
  )
}

function Boxed({ children }: { children: string }) {
  return (
    <span style={{ border: 'var(--bw) solid var(--ink)', borderRadius: 2, padding: '5px 9px', background: 'var(--sunk)' }}>
      {children}
    </span>
  )
}
function Op({ children }: { children: string }) {
  return <span style={{ color: 'var(--ink-3)' }}>{children}</span>
}
