'use client'

import { type Topics, topicUrl, useTopics } from '@/lib/hooks/use-topics'

/**
 * The HCS topic ids, and links to them, taken from the running gateway.
 *
 * Every one of these used to come from `lib/mock/tab.ts`, which held
 * `0.0.4881203` / `0.0.4881204` / `0.0.4881190`. None of those is one of our
 * topics: a mirror-node read of 0.0.4881203 returns no messages at all. So on
 * the screens whose entire argument is *do not trust me, go and look*, every
 * "view on HashScan" sent the reader somewhere empty — the most expensive
 * possible link to get wrong.
 *
 * A client component so that server-rendered pages (the landing page, the docs)
 * can show the same ids without a build-time environment variable, which would
 * be inlined once and could then go stale silently.
 *
 * While the gateway has not answered yet the id is simply absent. Rendering a
 * placeholder that looks like an account id would be the original bug again.
 */

type Kind = keyof Topics

/** The bare topic id as text, or nothing until the gateway has answered. */
export function TopicId({ kind }: { kind: Kind }) {
  const { value } = useTopics()
  return <>{value[kind] ?? '…'}</>
}

/**
 * A link to a topic on HashScan.
 *
 * With no id yet there is no anchor — the children render as plain text rather
 * than as a link that goes nowhere. A dead link on these pages is worse than no
 * link, because it reads as a broken claim rather than a loading one.
 */
export function TopicLink({
  kind,
  children,
  style,
}: {
  kind: Kind
  children: React.ReactNode
  style?: React.CSSProperties
}) {
  const { value } = useTopics()
  const href = topicUrl(value[kind])
  if (!href) return <span style={style}>{children}</span>
  return (
    <a href={href} target="_blank" rel="noreferrer" style={style}>
      {children}
    </a>
  )
}
