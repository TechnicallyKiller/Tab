/* House diagram style: ink strokes at 2.5px, square boxes, mono labels.
   Shared with the docs so a reader recognises them across surfaces. */

const MONO = 'IBM Plex Mono, monospace'

export function ProblemDiagram({ kind }: { kind: 'cold' | 'reject' | 'human' | 'hot' }) {
  const stroke = 'var(--paper)'
  const muted = 'var(--rule-soft)'
  const caution = 'var(--caution)'
  const common = {
    viewBox: '0 0 200 90',
    style: { width: '100%', height: 'auto', display: 'block' },
  }

  if (kind === 'cold')
    return (
      <svg {...common} aria-hidden="true">
        <circle
          cx={42}
          cy={45}
          r={24}
          fill="none"
          stroke={stroke}
          strokeWidth={2.5}
          strokeDasharray="5 6"
        />
        <text x={42} y={50} textAnchor="middle" fontFamily={MONO} fontSize={11} fill={muted}>
          0.00
        </text>
        <line x1={70} y1={45} x2={138} y2={45} stroke={stroke} strokeWidth={2.5} />
        <line x1={146} y1={36} x2={168} y2={54} stroke={caution} strokeWidth={3.5} />
        <line x1={168} y1={36} x2={146} y2={54} stroke={caution} strokeWidth={3.5} />
      </svg>
    )

  if (kind === 'reject')
    return (
      <svg {...common} aria-hidden="true">
        <rect x={16} y={14} width={168} height={28} fill="none" stroke={muted} strokeWidth={2.5} />
        <text x={26} y={33} fontFamily={MONO} fontSize={11} fill={muted}>
          job +0.18 profitable
        </text>
        <line x1={20} y1={28} x2={180} y2={28} stroke={caution} strokeWidth={2.5} />
        <rect x={16} y={52} width={168} height={28} fill="none" stroke={stroke} strokeWidth={2.5} />
        <text x={26} y={71} fontFamily={MONO} fontSize={11} fill={stroke}>
          job +0.01 taken
        </text>
      </svg>
    )

  if (kind === 'human')
    return (
      <svg {...common} aria-hidden="true">
        <rect x={12} y={30} width={46} height={34} fill="none" stroke={stroke} strokeWidth={2.5} />
        <text x={35} y={51} textAnchor="middle" fontFamily={MONO} fontSize={10} fill={stroke}>
          human
        </text>
        <line
          x1={60}
          y1={47}
          x2={136}
          y2={47}
          stroke={caution}
          strokeWidth={2.5}
          strokeDasharray="6 6"
        />
        <text x={98} y={38} textAnchor="middle" fontFamily={MONO} fontSize={10} fill={caution}>
          manual
        </text>
        <rect x={140} y={30} width={46} height={34} fill="none" stroke={stroke} strokeWidth={2.5} />
        <text x={163} y={51} textAnchor="middle" fontFamily={MONO} fontSize={10} fill={stroke}>
          agent
        </text>
      </svg>
    )

  return (
    <svg {...common} aria-hidden="true">
      <circle cx={100} cy={45} r={36} fill="none" stroke={caution} strokeWidth={4} />
      <text x={100} y={42} textAnchor="middle" fontFamily={MONO} fontSize={13} fill={stroke}>
        500.00
      </text>
      <rect x={86} y={52} width={28} height={14} fill="none" stroke={stroke} strokeWidth={2} />
      <text x={100} y={63} textAnchor="middle" fontFamily={MONO} fontSize={9} fill={muted}>
        key
      </text>
    </svg>
  )
}

function Arrowhead({ id }: { id: string }) {
  return (
    <defs>
      <marker
        id={id}
        viewBox="0 0 10 10"
        refX="9"
        refY="5"
        markerWidth="6"
        markerHeight="6"
        orient="auto-start-reverse"
      >
        <path d="M0 0 L10 5 L0 10 z" fill="var(--ink)" />
      </marker>
    </defs>
  )
}

/** Spend leg. The payment dot travels the path so the mechanism is visible. */
export function SpendDiagram({ dotX, balance }: { dotX: number; balance: string }) {
  return (
    <svg
      viewBox="0 0 620 300"
      style={{ width: '100%', height: '100%', display: 'block' }}
      role="img"
      aria-label="Spend leg: agent to gateway to seller"
    >
      <Arrowhead id="spend-arrow" />
      <rect
        x={14}
        y={112}
        width={130}
        height={76}
        fill="var(--surface)"
        stroke="var(--ink)"
        strokeWidth={2.5}
      />
      <text x={79} y={144} textAnchor="middle" fontFamily={MONO} fontSize={14} fill="var(--ink)">
        agent
      </text>
      <text x={79} y={164} textAnchor="middle" fontFamily={MONO} fontSize={11} fill="var(--ink-3)">
        no wallet
      </text>
      <rect
        x={238}
        y={92}
        width={146}
        height={116}
        fill="var(--pen-soft)"
        stroke="var(--ink)"
        strokeWidth={2.5}
      />
      <text x={311} y={132} textAnchor="middle" fontFamily={MONO} fontSize={14} fill="var(--ink)">
        gateway
      </text>
      <text x={311} y={154} textAnchor="middle" fontFamily={MONO} fontSize={11} fill="var(--ink-3)">
        pays from float
      </text>
      <text x={311} y={172} textAnchor="middle" fontFamily={MONO} fontSize={11} fill="var(--ink-3)">
        debits the tab
      </text>
      <rect
        x={476}
        y={112}
        width={130}
        height={76}
        fill="var(--surface)"
        stroke="var(--ink)"
        strokeWidth={2.5}
      />
      <text x={541} y={144} textAnchor="middle" fontFamily={MONO} fontSize={14} fill="var(--ink)">
        seller
      </text>
      <text x={541} y={164} textAnchor="middle" fontFamily={MONO} fontSize={11} fill="var(--ink-3)">
        plain x402
      </text>
      <line
        x1={144}
        y1={150}
        x2={232}
        y2={150}
        stroke="var(--ink)"
        strokeWidth={2.5}
        markerEnd="url(#spend-arrow)"
      />
      <line
        x1={384}
        y1={150}
        x2={470}
        y2={150}
        stroke="var(--ink)"
        strokeWidth={2.5}
        markerEnd="url(#spend-arrow)"
      />
      <circle cx={dotX} cy={150} r={7} fill="var(--debit)" stroke="var(--ink)" strokeWidth={2} />
      <rect
        x={476}
        y={212}
        width={130}
        height={30}
        fill="var(--credit)"
        stroke="var(--ink)"
        strokeWidth={2.5}
      />
      <text
        x={541}
        y={232}
        textAnchor="middle"
        fontFamily={MONO}
        fontSize={11}
        fill="var(--on-credit)"
      >
        402 → paid
      </text>
      <text x={14} y={42} fontFamily={MONO} fontSize={11} fill="var(--ink-3)">
        TAB BALANCE
      </text>
      <text x={14} y={76} fontFamily={MONO} fontSize={30} fontWeight={600} fill="var(--debit)">
        {balance}
      </text>
    </svg>
  )
}

/** Earn leg. Payment travels inward and stamps an attested receipt. */
export function EarnDiagram({ dotX, balance }: { dotX: number; balance: string }) {
  return (
    <svg
      viewBox="0 0 620 300"
      style={{ width: '100%', height: '100%', display: 'block' }}
      role="img"
      aria-label="Earn leg: payer to gateway to agent endpoint"
    >
      <Arrowhead id="earn-arrow" />
      <rect
        x={476}
        y={112}
        width={130}
        height={76}
        fill="var(--surface)"
        stroke="var(--ink)"
        strokeWidth={2.5}
      />
      <text x={541} y={144} textAnchor="middle" fontFamily={MONO} fontSize={14} fill="var(--ink)">
        payer
      </text>
      <rect
        x={238}
        y={92}
        width={146}
        height={116}
        fill="var(--pen-soft)"
        stroke="var(--ink)"
        strokeWidth={2.5}
      />
      <text x={311} y={132} textAnchor="middle" fontFamily={MONO} fontSize={14} fill="var(--ink)">
        gateway
      </text>
      <text x={311} y={154} textAnchor="middle" fontFamily={MONO} fontSize={11} fill="var(--ink-3)">
        fronts endpoint
      </text>
      <text x={311} y={172} textAnchor="middle" fontFamily={MONO} fontSize={11} fill="var(--ink-3)">
        credits the tab
      </text>
      <rect
        x={14}
        y={112}
        width={130}
        height={76}
        fill="var(--surface)"
        stroke="var(--ink)"
        strokeWidth={2.5}
      />
      <text x={79} y={144} textAnchor="middle" fontFamily={MONO} fontSize={14} fill="var(--ink)">
        agent
      </text>
      <text x={79} y={164} textAnchor="middle" fontFamily={MONO} fontSize={11} fill="var(--ink-3)">
        endpoint
      </text>
      <line
        x1={470}
        y1={150}
        x2={390}
        y2={150}
        stroke="var(--ink)"
        strokeWidth={2.5}
        markerEnd="url(#earn-arrow)"
      />
      <line
        x1={232}
        y1={150}
        x2={150}
        y2={150}
        stroke="var(--ink)"
        strokeWidth={2.5}
        markerEnd="url(#earn-arrow)"
      />
      <circle cx={dotX} cy={150} r={7} fill="var(--credit)" stroke="var(--ink)" strokeWidth={2} />
      <rect
        x={238}
        y={228}
        width={146}
        height={34}
        fill="var(--credit)"
        stroke="var(--ink)"
        strokeWidth={2.5}
      />
      <text
        x={311}
        y={250}
        textAnchor="middle"
        fontFamily={MONO}
        fontSize={11}
        fill="var(--on-credit)"
      >
        ATTESTED RECEIPT
      </text>
      <text x={14} y={42} fontFamily={MONO} fontSize={11} fill="var(--ink-3)">
        TAB BALANCE
      </text>
      <text x={14} y={76} fontFamily={MONO} fontSize={30} fontWeight={600} fill="var(--credit)">
        {balance}
      </text>
    </svg>
  )
}

/** Settlement. Many receipts physically collapse into one transfer. */
export function SettleDiagram({ collapsed }: { collapsed: boolean }) {
  const rows = Array.from({ length: 8 }, (_, i) => {
    const spread = 62 + i * 24
    const y = collapsed ? 145 : spread
    // `id` rather than the array index as the React key: the rows animate
    // between a spread and a collapsed position, and a key that changes meaning
    // when the list re-renders is how a transition ends up applied to the wrong
    // element.
    return {
      id: `row-${i}`,
      y,
      fill: i % 2 ? 'var(--credit)' : 'var(--debit)',
      op: collapsed ? 0.25 : 1,
    }
  })
  return (
    <svg
      viewBox="0 0 620 300"
      style={{ width: '100%', height: '100%', display: 'block' }}
      role="img"
      aria-label="Settlement: 43 receipts net to one transfer"
    >
      <Arrowhead id="settle-arrow" />
      {rows.map((r) => (
        <rect
          key={r.id}
          x={20}
          y={r.y}
          width={200}
          height={10}
          fill={r.fill}
          stroke="var(--ink)"
          strokeWidth={1.5}
          opacity={r.op}
          style={{ transition: 'y 320ms cubic-bezier(.2,.7,.3,1), opacity 320ms ease-out' }}
        />
      ))}
      <text x={20} y={34} fontFamily={MONO} fontSize={11} fill="var(--ink-3)">
        {collapsed ? '43 → 1' : '43'} CALLS
      </text>
      <line
        x1={250}
        y1={150}
        x2={330}
        y2={150}
        stroke="var(--ink)"
        strokeWidth={2.5}
        markerEnd="url(#settle-arrow)"
      />
      <rect
        x={352}
        y={118}
        width={248}
        height={64}
        fill="var(--pen-soft)"
        stroke="var(--ink)"
        strokeWidth={2.5}
      />
      <text x={476} y={144} textAnchor="middle" fontFamily={MONO} fontSize={13} fill="var(--ink)">
        1 TRANSFER
      </text>
      <text
        x={476}
        y={166}
        textAnchor="middle"
        fontFamily={MONO}
        fontSize={16}
        fontWeight={600}
        fill="var(--ink)"
      >
        net −0.2160
      </text>
      <text x={352} y={212} fontFamily={MONO} fontSize={11} fill="var(--ink-3)">
        scheduled tx · consensus tick
      </text>
      <text x={352} y={232} fontFamily={MONO} fontSize={11} fill="var(--credit)">
        CLEAN · ramp 30% → 45%
      </text>
    </svg>
  )
}

/** Docs sequence diagram, same house style. */
export function SequenceDiagram() {
  return (
    <svg
      viewBox="0 0 660 210"
      style={{ width: '100%', height: 'auto', display: 'block' }}
      role="img"
      aria-label="Spend sequence: agent, gateway, seller"
    >
      <Arrowhead id="seq-arrow" />
      <rect
        x={10}
        y={70}
        width={130}
        height={60}
        fill="var(--surface)"
        stroke="var(--ink)"
        strokeWidth={2.5}
      />
      <text x={75} y={96} textAnchor="middle" fontFamily={MONO} fontSize={13} fill="var(--ink)">
        agent
      </text>
      <text x={75} y={114} textAnchor="middle" fontFamily={MONO} fontSize={10} fill="var(--ink-3)">
        no wallet
      </text>
      <rect
        x={256}
        y={52}
        width={150}
        height={96}
        fill="var(--pen-soft)"
        stroke="var(--ink)"
        strokeWidth={2.5}
      />
      <text x={331} y={84} textAnchor="middle" fontFamily={MONO} fontSize={13} fill="var(--ink)">
        gateway
      </text>
      <text x={331} y={104} textAnchor="middle" fontFamily={MONO} fontSize={10} fill="var(--ink-3)">
        6 checks · hold
      </text>
      <text x={331} y={122} textAnchor="middle" fontFamily={MONO} fontSize={10} fill="var(--ink-3)">
        pays from float
      </text>
      <rect
        x={520}
        y={70}
        width={130}
        height={60}
        fill="var(--surface)"
        stroke="var(--ink)"
        strokeWidth={2.5}
      />
      <text x={585} y={96} textAnchor="middle" fontFamily={MONO} fontSize={13} fill="var(--ink)">
        seller
      </text>
      <text x={585} y={114} textAnchor="middle" fontFamily={MONO} fontSize={10} fill="var(--ink-3)">
        plain x402
      </text>
      <line
        x1={140}
        y1={88}
        x2={250}
        y2={88}
        stroke="var(--ink)"
        strokeWidth={2.5}
        markerEnd="url(#seq-arrow)"
      />
      <text x={195} y={78} textAnchor="middle" fontFamily={MONO} fontSize={10} fill="var(--ink-3)">
        spend()
      </text>
      <line
        x1={406}
        y1={88}
        x2={514}
        y2={88}
        stroke="var(--ink)"
        strokeWidth={2.5}
        markerEnd="url(#seq-arrow)"
      />
      <text x={460} y={78} textAnchor="middle" fontFamily={MONO} fontSize={10} fill="var(--ink-3)">
        402 → pay
      </text>
      <line
        x1={514}
        y1={116}
        x2={410}
        y2={116}
        stroke="var(--ink)"
        strokeWidth={2.5}
        markerEnd="url(#seq-arrow)"
      />
      <text x={462} y={132} textAnchor="middle" fontFamily={MONO} fontSize={10} fill="var(--ink-3)">
        200 body
      </text>
      <line
        x1={250}
        y1={116}
        x2={146}
        y2={116}
        stroke="var(--ink)"
        strokeWidth={2.5}
        markerEnd="url(#seq-arrow)"
      />
      <text x={198} y={132} textAnchor="middle" fontFamily={MONO} fontSize={10} fill="var(--ink-3)">
        result
      </text>
      <line x1={10} y1={176} x2={650} y2={176} stroke="var(--rule-soft)" strokeWidth={1.5} />
      <text x={10} y={196} fontFamily={MONO} fontSize={10} fill="var(--ink-3)">
        HCS receipt written after settle-of-hold · balance −0.4421 → −0.4821
      </text>
    </svg>
  )
}
