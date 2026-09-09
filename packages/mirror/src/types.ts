/**
 * Mirror Node REST API shapes, transcribed from live testnet responses on
 * 2026-08-22 rather than from documentation. Only the fields Tab reads.
 */

/** "seconds.nanos", e.g. "1787424141.254251949". Lexicographically sortable. */
export type ConsensusTimestamp = string

/** "0.0.429274" */
export type EntityId = string

export interface MirrorLinks {
  /**
   * Path for the next page, or null when the walk is complete.
   *
   * NOT a reliable emptiness signal: a page can return zero rows and still
   * carry a next link, and empty pages appear in the MIDDLE of a real result
   * set. Stop only when this is null.
   */
  next: string | null
}

export interface TokenTransfer {
  token_id: EntityId
  account: EntityId
  /** Signed. Negative debits the account, positive credits it. */
  amount: number
  is_approval: boolean
}

export interface HbarTransfer {
  account: EntityId
  amount: number
  is_approval: boolean
}

export interface MirrorTransaction {
  consensus_timestamp: ConsensusTimestamp
  transaction_id: string
  name: string
  /** "SUCCESS" or a failure code. Failed transactions ARE returned; filter them. */
  result: string
  charged_tx_fee: number
  token_transfers?: TokenTransfer[]
  transfers?: HbarTransfer[]
  entity_id?: EntityId | null
}

export interface TransactionsPage {
  transactions: MirrorTransaction[]
  links: MirrorLinks
}

export interface MirrorAccount {
  account: EntityId
  /**
   * Exact account age. This is a direct input to Sybil scoring and is strictly
   * better than inferring age from a first operation.
   */
  created_timestamp: ConsensusTimestamp
  max_automatic_token_associations: number
  memo?: string | null
  evm_address?: string | null
  /**
   * The balance SNAPSHOT, with the timestamp it was taken at.
   *
   * `timestamp` is the last activity that updated these balances, not "now".
   * Modelled explicitly because `verify-tab` asserts a balance against replayed
   * receipts, and comparing a stale snapshot to receipts replayed to the present
   * fails on a perfectly reconciled ledger — the worst possible failure for the
   * one command whose job is proving correctness. The caller must replay only
   * up to this timestamp.
   */
  balance?: {
    timestamp: ConsensusTimestamp
    /** Tinybars. */
    balance: number
    tokens?: { token_id: EntityId; balance: number }[]
  }
}

export interface TokenRelationship {
  token_id: EntityId
  /** Integer in the token's own decimals — micro-USDC for USDC. */
  balance: number
  /**
   * STRING OR NUMBER. Mirror Node is inconsistent about this field.
   *
   * `/tokens/{id}` returns it as a string and `/accounts/{id}/tokens` has been
   * observed returning a number — and `TokenInfo` below has always typed the
   * union for that reason. This one said `number`, which made a strict
   * `!== 6` comparison in `getUsdcBalance` fail on a perfectly good 6-decimal
   * token with the least helpful message imaginable:
   *
   *     Token 0.0.429274 has 6 decimals, not 6
   *
   * An hour went into that sentence once. Every reader must coerce before
   * comparing; see `decimalsOf`.
   */
  decimals: string | number
  automatic_association: boolean
  freeze_status: 'NOT_APPLICABLE' | 'FROZEN' | 'UNFROZEN'
  kyc_status: 'NOT_APPLICABLE' | 'GRANTED' | 'REVOKED'
  created_timestamp: ConsensusTimestamp
}

export interface TokenRelationshipsPage {
  tokens: TokenRelationship[]
  links: MirrorLinks
}

/**
 * One HCS message. A payload over ~1KB is SPLIT ACROSS CHUNKS and must be
 * reassembled in `number` order before parsing — see reassembleChunks().
 */
export interface TopicMessage {
  topic_id: EntityId
  consensus_timestamp: ConsensusTimestamp
  /** Consensus-assigned and monotonic. The ordering key for a replay. */
  sequence_number: number
  /** base64. */
  message: string
  payer_account_id: EntityId
  running_hash: string
  running_hash_version: number
  chunk_info?: {
    initial_transaction_id: {
      account_id: EntityId
      nonce: number
      scheduled: boolean
      transaction_valid_start: string
    }
    number: number
    total: number
  } | null
}

export interface TopicMessagesPage {
  messages: TopicMessage[]
  links: MirrorLinks
}

export interface TokenInfo {
  token_id: EntityId
  symbol: string
  name: string
  decimals: string | number
  type: string
  treasury_account_id: EntityId
  total_supply: string
  pause_status: string
  freeze_default: boolean
}
