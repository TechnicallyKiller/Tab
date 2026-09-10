/**
 * Claiming a funding root — the Starter Tab registration.
 *
 * **One Starter Tab per funding root.** This was the last unenforced claim in
 * the README (labelled OPEN) and the first thing a sharp reviewer would have
 * found: nothing wrote a `register` message, so minting a hundred agents from
 * one wallet yielded a hundred starter grants rather than one.
 *
 * ## Why the engine claims, rather than an operator running a CLI
 *
 * An operator-run registration defends against nothing. An attacker simply does
 * not run it — and then, under a rule keyed on registration PRESENCE, holds an
 * unregistered tab that no claim blocks. The check has to key on the funding
 * root, which is derived from published facts, and the claim has to be written
 * automatically the first time a root is seen. First to arrive wins, decided by
 * consensus order, and nobody has to be trusted to opt in.
 *
 * ## What is NOT claimed
 *
 * A tab whose funding root could not be resolved claims nothing. It still gets
 * the floor — refusing would let a Mirror Node outage stop every new agent from
 * ever starting — but it must not be able to lock other tabs out of a root it
 * was never shown to belong to. Publishing a rootless claim would let an
 * attacker squat roots during an indexer outage.
 */
import { submitMessage, type TabClient } from '@tab/hedera'
import { type MicroUsdc, toWire } from '@tab/money'
import { encode, hcs14Uaid, registration, tabAgent } from '@tab/protocol'

export interface PublishRegistrationParams {
  hedera: TabClient
  topicId: string
  tab: string
  window: number
  /** The funding root being claimed. Omitted means nothing is claimed. */
  root?: string
  starterCeiling: MicroUsdc
  perCallCap: MicroUsdc
  /**
   * Sellers a starter tab may buy from before it graduates.
   *
   * Empty means UNRESTRICTED, and that is the honest state today: no seller
   * registry exists, so an allowlist would be a list of nothing enforced by
   * nobody. Published as an empty array rather than omitted so a reader can see
   * the field is deliberately unused rather than forgotten.
   */
  allowlist?: readonly string[]
  /** Network name for the HCS-14 nativeId, e.g. `testnet`. */
  network?: string
}

export interface PublishedRegistration {
  root: string
  sequenceNumber: number | null
}

/**
 * Claim the root, if there is one to claim.
 *
 * Returns `undefined` when no root was resolved — the caller has nothing to
 * publish and should not treat that as a failure.
 */
export async function publishRegistration(
  params: PublishRegistrationParams,
): Promise<PublishedRegistration | undefined> {
  if (!params.root) return undefined

  /*
   * The agent's HCS-14 identifier, derived at publish time.
   *
   * Derived rather than stored, because it is a pure function of the six
   * canonical fields — a cached copy could disagree with what those fields say
   * today, and an identifier that disagrees with itself is worse than none.
   *
   * A failure here must NOT stop a registration: the claim on the funding root
   * is what enforces one Starter Tab per operator, and losing that to a hashing
   * problem would trade a security rule for a nice-to-have.
   */
  const uaid = await hcs14Uaid(tabAgent(params.tab, params.network ?? 'testnet')).catch(
    () => undefined,
  )

  const message = registration.parse({
    v: 1,
    t: 'register',
    tab: params.tab,
    w: params.window,
    root: params.root,
    ...(uaid ? { uaid } : {}),
    ceil: toWire(params.starterCeiling),
    perCall: toWire(params.perCallCap),
    allowlist: [...(params.allowlist ?? [])],
  })

  const receipt = await submitMessage(params.hedera.client, params.topicId, encode(message))
  return { root: params.root, sequenceNumber: receipt.sequenceNumber }
}
