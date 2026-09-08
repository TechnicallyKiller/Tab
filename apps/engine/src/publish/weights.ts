/**
 * Publishing counterparty weights.
 *
 * The engine has always computed these and published them NOWHERE — the
 * three-way weight table that is the strongest artifact in the demo existed
 * only in engine stdout. A number nobody can read is a number nobody can
 * check, and "the graph blocked this counterparty" is exactly the claim a
 * sceptical reader would want to see on the public record rather than in our
 * terminal.
 *
 * One message per counterparty, because an array inside the ceiling message
 * would hit the 1024-byte single-chunk limit as soon as an agent had a handful
 * of them. See `weightUpdate` in `@tab/protocol` for why that limit is fatal
 * rather than merely awkward.
 */
import { submitMessage, type TabClient } from '@tab/hedera'
import { toWire, type MicroUsdc } from '@tab/money'
import { encode, weightUpdate } from '@tab/protocol'
import type { Weight } from '@tab/graph'

export interface PublishWeightsParams {
  hedera: TabClient
  topicId: string
  tab: string
  window: number
  tokenId: string
  weights: readonly Weight[]
  /** Revenue per counterparty, for the share the console renders. */
  revenue: ReadonlyMap<string, MicroUsdc>
}

export interface PublishedWeight {
  counterparty: string
  sequenceNumber: number | null
}

export async function publishWeights(
  params: PublishWeightsParams,
): Promise<PublishedWeight[]> {
  let total = 0n
  for (const amount of params.revenue.values()) total += amount

  const published: PublishedWeight[] = []

  for (const weight of params.weights) {
    const attributed = params.revenue.get(weight.counterparty) ?? 0n

    const message = weightUpdate.parse({
      v: 1,
      t: 'weight',
      tok: params.tokenId,
      tab: params.tab,
      w: params.window,
      cp: weight.counterparty,
      bp: weight.bp,
      /*
       * Every reason, not just the first.
       *
       * Three fired at once on live data — `SHARED_FUNDING_ROOT`,
       * `YOUNG_ACCOUNT`, `CONCENTRATED` — and their product is the weight. A
       * single reason would make the number unexplainable: 33% is `0.7 × 0.6 ×
       * 0.8`, and dropping two of the three leaves arithmetic nobody can
       * reproduce.
       */
      why: [...weight.reasons],
      block: weight.blocking,
      rev: toWire(attributed as MicroUsdc),
      /*
       * Integer basis points, truncating.
       *
       * Zero total revenue yields a zero share rather than a division by zero —
       * a brand-new agent has no concentration, and reporting 100% would make
       * it look maximally risky for the one reason that says nothing about it.
       */
      share: total === 0n ? 0 : Number((attributed * 10_000n) / total),
    })

    const written = await submitMessage(params.hedera.client, params.topicId, encode(message))
    published.push({ counterparty: weight.counterparty, sequenceNumber: written.sequenceNumber })
  }

  return published
}
