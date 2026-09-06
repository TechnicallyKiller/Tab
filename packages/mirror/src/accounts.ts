import { micro, type MicroUsdc } from '@tab/money'
import { MirrorError, type MirrorClient } from './client.ts'
import type {
  ConsensusTimestamp,
  EntityId,
  MirrorAccount,
  TokenInfo,
  TokenRelationship,
  TokenRelationshipsPage,
} from './types.ts'

/** Exact account age, the Sybil input. Better than a first-operation heuristic. */
export async function getAccount(client: MirrorClient, id: EntityId): Promise<MirrorAccount> {
  return client.get<MirrorAccount>(`/api/v1/accounts/${id}?limit=1`)
}

/** Whole days since the account was created, at `now`. */
export function accountAgeDays(
  account: MirrorAccount,
  now: ConsensusTimestamp | Date = new Date(),
): number {
  const createdMs = consensusToMillis(account.created_timestamp)
  const nowMs = now instanceof Date ? now.getTime() : consensusToMillis(now)
  return Math.max(0, Math.floor((nowMs - createdMs) / 86_400_000))
}

export function consensusToMillis(ts: ConsensusTimestamp): number {
  const [seconds = '0', nanos = '0'] = ts.split('.')
  return Number(seconds) * 1000 + Math.floor(Number(nanos.padEnd(9, '0')) / 1e6)
}

/**
 * The association check.
 *
 * A transfer to an account that is neither associated with the token nor
 * holding a free auto-association slot fails — silently, if you do not look
 * for it. Mirror Node is the reliable source here; consensus-node token
 * queries no longer return this dependably, which is why @x402/hedera's own
 * preflight uses Mirror Node too.
 */
export async function getTokenRelationship(
  client: MirrorClient,
  accountId: EntityId,
  tokenId: EntityId,
): Promise<TokenRelationship | null> {
  try {
    const page = await client.get<TokenRelationshipsPage>(
      `/api/v1/accounts/${accountId}/tokens?token.id=${tokenId}&limit=2`,
    )
    return page.tokens[0] ?? null
  } catch (err) {
    // A 404 here means Mirror Node has not indexed the account yet, NOT that it
    // does not exist — a just-created account reaches consensus seconds before
    // it reaches the mirror. Either way there is no relationship to report.
    if (err instanceof MirrorError && err.status === 404) return null
    throw err
  }
}

/**
 * Wait for a freshly created entity to appear on Mirror Node.
 *
 * Consensus is immediate; indexing is not. Anything that creates an account or
 * token and then reads it back must wait, or it reads a 404 and concludes the
 * entity does not exist.
 */
export async function waitForAccount(
  client: MirrorClient,
  id: EntityId,
  opts: { attempts?: number; intervalMs?: number } = {},
): Promise<MirrorAccount> {
  const attempts = opts.attempts ?? 15
  const intervalMs = opts.intervalMs ?? 2000
  let last: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await getAccount(client, id)
    } catch (err) {
      if (!(err instanceof MirrorError) || err.status !== 404) throw err
      last = err
      await new Promise((r) => setTimeout(r, intervalMs))
    }
  }
  throw new Error(
    `Account ${id} did not appear on Mirror Node after ${attempts} attempts ` +
      `(~${Math.round((attempts * intervalMs) / 1000)}s). Last error: ${String(last)}`,
  )
}

export interface ReceiveCheck {
  canReceive: boolean
  associated: boolean
  frozen: boolean
  autoAssociationSlots: number
  reason?: string
}

/** Can this account actually receive the token right now, and if not, why. */
export async function canReceiveToken(
  client: MirrorClient,
  accountId: EntityId,
  tokenId: EntityId,
): Promise<ReceiveCheck> {
  const [account, relationship] = await Promise.all([
    getAccount(client, accountId),
    getTokenRelationship(client, accountId, tokenId),
  ])
  const slots = account.max_automatic_token_associations

  if (relationship) {
    const frozen = relationship.freeze_status === 'FROZEN'
    return {
      canReceive: !frozen,
      associated: true,
      frozen,
      autoAssociationSlots: slots,
      ...(frozen ? { reason: `${accountId} is FROZEN for token ${tokenId}` } : {}),
    }
  }
  // -1 means unlimited automatic associations.
  const hasSlot = slots === -1 || slots > 0
  return {
    canReceive: hasSlot,
    associated: false,
    frozen: false,
    autoAssociationSlots: slots,
    ...(hasSlot
      ? {}
      : {
          reason:
            `${accountId} is not associated with ${tokenId} and has no automatic ` +
            'association slots. Associate it in bootstrap, or the transfer fails.',
        }),
  }
}

/** Token balance as MicroUsdc. Only valid for a 6-decimal token. */
export async function getUsdcBalance(
  client: MirrorClient,
  accountId: EntityId,
  tokenId: EntityId,
): Promise<MicroUsdc> {
  const rel = await getTokenRelationship(client, accountId, tokenId)
  if (!rel) return micro(0n)
  if (rel.decimals !== 6) {
    throw new Error(
      `Token ${tokenId} has ${rel.decimals} decimals, not 6. MicroUsdc would misread it.`,
    )
  }
  return micro(BigInt(rel.balance))
}

export async function getToken(client: MirrorClient, tokenId: EntityId): Promise<TokenInfo> {
  return client.get<TokenInfo>(`/api/v1/tokens/${tokenId}`)
}

/** A token balance together with the timestamp it was snapshotted at. */
export interface BalanceSnapshot {
  balance: MicroUsdc
  /**
   * When Mirror Node last updated this balance.
   *
   * Not "now". `verify-tab` replays receipts only up to this point, because a
   * receipt that landed after the snapshot would appear as a discrepancy on a
   * correct ledger.
   */
  asOf: ConsensusTimestamp
  /** HBAR balance in tinybars, for reporting the fee payer's runway. */
  tinybars: bigint
}

/**
 * Token balance AND its snapshot timestamp, from one request.
 *
 * `getUsdcBalance` answers "how much" and is the right call for a funding
 * check. This answers "how much, as of when", which is what an INVARIANT needs
 * — the timestamp is not a detail, it is the difference between a check that
 * means something and one that fails at random.
 */
export async function getBalanceSnapshot(
  client: MirrorClient,
  accountId: EntityId,
  tokenId: EntityId,
): Promise<BalanceSnapshot> {
  const account = await getAccount(client, accountId)
  const snapshot = account.balance
  if (!snapshot) {
    throw new Error(
      `Mirror Node returned no balance snapshot for ${accountId}. Without the snapshot ` +
        'timestamp an invariant cannot be asserted honestly — a balance with no "as of" is ' +
        'not comparable to a replayed ledger.',
    )
  }
  const token = (snapshot.tokens ?? []).find((t) => t.token_id === tokenId)
  return {
    balance: micro(BigInt(token?.balance ?? 0)),
    asOf: snapshot.timestamp,
    tinybars: BigInt(snapshot.balance),
  }
}
