/**
 * Publishing observed graph facts.
 *
 * The independence graph **failed open**, and this is what closes it. Funding
 * ancestry was re-derived every pass from Mirror Node's
 * transactions-by-account index, which is *intermittent* for new accounts —
 * measured returning 5 transactions once and 0 both before and after, minutes
 * apart. A failed lookup weighted the counterparty **independent**, and the
 * loop attacker went uncaught on its first full run because of exactly that.
 *
 * The scoped fix was `@tab/db`. A private database would have worked, and it
 * would have put the graph's inputs somewhere a stranger cannot see — which
 * contradicts the whole no-contract argument. Every other input to a ceiling is
 * on a topic; the graph's were the exception, which is why `verify-ceiling`
 * could check a ceiling's arithmetic but never its graph.
 *
 * So the facts go on the topic instead. Durable, monotonic, no database, and
 * checkable by anyone with a Mirror Node URL.
 *
 * ## Only what is NEW
 *
 * A pass publishes a fact only when it learned something the topic does not
 * already carry. Republishing every account every window would add N messages
 * per window forever to say nothing — and the reader is monotonic, so a
 * duplicate is harmless but not free.
 */
import { submitMessage, type TabClient } from '@tab/hedera'
import type { RememberedFacts } from '@tab/ledger'
import { encode, graphFact } from '@tab/protocol'

export interface ObservedFact {
  account: string
  createdAt?: string
  funder?: string
}

export interface PublishFactsParams {
  hedera: TabClient
  topicId: string
  /** The tab whose pass observed these. See `graphFact.acct` for why. */
  tab: string
  window: number
  observed: readonly ObservedFact[]
  /** What the topic already carries, so nothing is republished. */
  known: ReadonlyMap<string, RememberedFacts>
}

export interface PublishedFact {
  account: string
  sequenceNumber: number | null
  /** What this message added, for the log line. */
  added: 'funder' | 'birth' | 'both'
}

/**
 * Is this observation worth a message?
 *
 * Exported for testing, because "publish only what is new" is the rule that
 * keeps a per-window message count from growing forever, and the asymmetry
 * below is the rule that keeps it SAFE.
 *
 * Only when it adds a field the topic does not have. Note the asymmetry: a
 * funder we did NOT observe is never worth publishing, because absence carries
 * no information — the reader treats it as "not observed" and keeps what it
 * knew. Publishing an empty fact would be paying for a message to say nothing.
 */
export function newFactFields(
  fact: ObservedFact,
  known: ReadonlyMap<string, RememberedFacts>,
): PublishedFact['added'] | undefined {
  const have = known.get(fact.account)
  const newFunder = fact.funder !== undefined && have?.funder === undefined
  const newBirth = fact.createdAt !== undefined && have?.createdAt === undefined
  if (newFunder && newBirth) return 'both'
  if (newFunder) return 'funder'
  if (newBirth) return 'birth'
  return undefined
}

export async function publishFacts(params: PublishFactsParams): Promise<PublishedFact[]> {
  const published: PublishedFact[] = []

  for (const fact of params.observed) {
    const added = newFactFields(fact, params.known)
    if (!added) continue

    const message = graphFact.parse({
      v: 1,
      t: 'fact',
      tab: params.tab,
      w: params.window,
      acct: fact.account,
      ...(fact.createdAt ? { born: fact.createdAt } : {}),
      ...(fact.funder ? { by: fact.funder } : {}),
      /*
       * No `tok`.
       *
       * Every other message carries the token its amounts are denominated in.
       * A fact has no amounts — it is a statement about account provenance, not
       * about money — so a token field here would be noise a reader might try
       * to interpret.
       */
    })

    const receipt = await submitMessage(params.hedera.client, params.topicId, encode(message))
    published.push({
      account: fact.account,
      sequenceNumber: receipt.sequenceNumber,
      added,
    })
  }

  return published
}
