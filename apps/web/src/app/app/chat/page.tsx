'use client'

import { useRef, useState } from 'react'
import { Card, CardHead, Chip } from '@/components/ui'

/**
 * Ask the agent to buy something, and watch it happen.
 *
 * ## Why this page is the most important one in the console
 *
 * Every other view asks a reader to believe a number. This one lets them cause
 * it. A visitor types a sentence, a language model decides to spend, the
 * gateway pays a real seller, and a receipt lands on Hedera — with no clone, no
 * install and no wallet.
 *
 * ## The tool trace is the product, not a debug panel
 *
 * The steps are rendered as prominently as the reply, deliberately. A chat that
 * showed only prose would be indistinguishable from a language model making
 * things up; showing `tab_spend → REFUSED — CEILING_EXCEEDED` beside the
 * sentence is what makes it evidence. The most interesting thing a visitor can
 * do here is get refused.
 */

interface Step {
  tool: string
  args: Record<string, unknown>
  result: string
}

interface Turn {
  /*
   * A stable id assigned when the turn is created.
   *
   * The conversation is append-only, so the array index would work — but a key
   * that means "position" silently becomes wrong the first time anything is
   * inserted or retried, and this is a list that will grow features.
   */
  id: string
  role: 'user' | 'assistant'
  content: string
  steps?: (Step & { id: string })[]
  error?: string
}

let turnCounter = 0
const nextId = () => `t${++turnCounter}`

const SUGGESTIONS = [
  'What can you afford right now?',
  'Why is your credit limit only 0.25?',
  'Try to spend 0.30 — what happens?',
  'Which of your customers count as independent revenue?',
]

/** A refusal is the point, so it gets the loudest treatment. */
function toneFor(result: string) {
  if (result.startsWith('REFUSED')) return { border: 'var(--caution)', label: 'REFUSED' }
  if (result.startsWith('PAID')) return { border: 'var(--credit)', label: 'PAID' }
  if (result.startsWith('FAILED') || result.startsWith('The tool failed')) {
    return { border: 'var(--debit)', label: 'FAILED' }
  }
  return { border: 'var(--rule-soft)', label: 'READ' }
}

export default function ChatView() {
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  async function send(text: string) {
    const question = text.trim()
    if (!question || busy) return

    const history = [...turns, { id: nextId(), role: 'user' as const, content: question }]
    setTurns(history)
    setInput('')
    setBusy(true)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          messages: history.map((t) => ({ role: t.role, content: t.content })),
        }),
      })
      const data = (await res.json()) as {
        reply?: string
        steps?: Step[]
        error?: string
        missing?: string[]
      }

      setTurns((prev) => [
        ...prev,
        {
          id: nextId(),
          role: 'assistant',
          content: data.reply ?? '',
          ...(data.steps
            ? { steps: data.steps.map((s, i) => ({ ...s, id: `${s.tool}-${i}` })) }
            : {}),
          ...(data.error
            ? {
                error: data.missing?.length
                  ? `${data.error} Missing: ${data.missing.join(', ')}.`
                  : data.error,
              }
            : {}),
        },
      ])
    } catch (error) {
      setTurns((prev) => [
        ...prev,
        {
          id: nextId(),
          role: 'assistant',
          content: '',
          error: error instanceof Error ? error.message : String(error),
        },
      ])
    } finally {
      setBusy(false)
      requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }))
    }
  }

  return (
    <div style={{ display: 'grid', gap: 20, maxWidth: 860 }}>
      <Card style={{ padding: '16px 18px', display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <Chip tone="pen">LIVE AGENT</Chip>
          <span className="t-label">it holds no key · it spends real testnet USDC</span>
        </div>
        <p
          style={{ margin: 0, maxWidth: 660, fontSize: 13, lineHeight: 1.7, color: 'var(--ink-2)' }}
        >
          Ask it to buy something and it will — through the gateway, against a ceiling it earned,
          writing a receipt to a public Hedera topic. Ask it to overspend and it gets refused, with
          the rule named. <strong>Both are worth trying.</strong> Nothing here can take more than
          the rail allows: <code>0.050000</code> per call, <code>0.250000</code> ceiling.
        </p>
      </Card>

      <Card style={{ overflow: 'hidden' }}>
        <CardHead title="Conversation" />
        <div style={{ padding: 18, display: 'grid', gap: 18, minHeight: 220 }}>
          {turns.length === 0 ? (
            <div style={{ display: 'grid', gap: 10 }}>
              <span className="t-label">Try one of these</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className="btn btn-sm"
                    onClick={() => void send(s)}
                    disabled={busy}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {turns.map((turn) => (
            <div key={turn.id} style={{ display: 'grid', gap: 10 }}>
              <div className="t-label">{turn.role === 'user' ? 'You' : 'The agent'}</div>

              {turn.content ? (
                <p style={{ margin: 0, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{turn.content}</p>
              ) : null}

              {/*
                The trace, rendered as prominently as the prose. Without it a
                visitor cannot tell a real spend from a model describing one.
              */}
              {turn.steps?.map((step) => {
                const tone = toneFor(step.result)
                return (
                  <div
                    key={step.id}
                    className="t-mono"
                    style={{
                      borderLeft: `3px solid ${tone.border}`,
                      background: 'var(--sunk)',
                      padding: '10px 14px',
                      fontSize: 12.5,
                      lineHeight: 1.7,
                    }}
                  >
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                      <strong>{step.tool}</strong>
                      {Object.keys(step.args).length > 0 ? (
                        <span style={{ color: 'var(--ink-3)' }}>{JSON.stringify(step.args)}</span>
                      ) : null}
                    </div>
                    <div style={{ whiteSpace: 'pre-wrap', color: 'var(--ink-2)' }}>
                      {step.result}
                    </div>
                  </div>
                )
              })}

              {turn.error ? (
                <div style={{ color: 'var(--caution)', fontSize: 13, lineHeight: 1.7 }}>
                  {turn.error}
                </div>
              ) : null}
            </div>
          ))}

          {busy ? (
            <div className="t-mono" style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
              thinking… a real payment settles on testnet in 25–39s, so a spend takes a moment.
            </div>
          ) : null}
          <div ref={endRef} />
        </div>

        <form
          className="rule-t"
          onSubmit={(e) => {
            e.preventDefault()
            void send(input)
          }}
          style={{ display: 'flex', gap: 10, padding: 14 }}
        >
          <input
            className="palette-input"
            style={{ flex: 1, border: '1px solid var(--rule-soft)', borderRadius: 2 }}
            placeholder="Ask the agent to buy something…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={busy}
            aria-label="Message the agent"
          />
          <button type="submit" className="btn btn-primary" disabled={busy || !input.trim()}>
            {busy ? 'Working…' : 'Send'}
          </button>
        </form>
      </Card>
    </div>
  )
}
