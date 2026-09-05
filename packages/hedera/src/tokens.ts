import {
  AccountCreateTransaction,
  AccountId,
  Hbar,
  PrivateKey,
  Status,
  TokenAssociateTransaction,
  TokenCreateTransaction,
  TokenId,
  TokenSupplyType,
  TokenType,
  TransferTransaction,
  type Client,
} from '@hiero-ledger/sdk'
import { format, type MicroUsdc } from '@tab/money'

/**
 * HTS operations. Every seller payout and every settlement transfer runs
 * through here.
 *
 * Amounts arrive as MicroUsdc and are converted to SDK units at the last
 * moment, so no float ever touches a transfer.
 */

export interface TransferResult {
  transactionId: string
  consensusStatus: string
  /** What was actually moved, echoed back for the receipt. */
  amount: MicroUsdc
}

/**
 * Move a token between two accounts.
 *
 * `idempotencyKey` becomes the transaction memo. Hedera enforces uniqueness on
 * (payer, valid-start), not on a memo, so this does NOT prevent a double-spend
 * on its own — it makes one auditable after the fact. The real guard is the
 * hold in @tab/ledger: reserve, pay, commit, with the hold id as the key.
 */
export async function transferToken(
  client: Client,
  params: {
    tokenId: string
    from: string
    to: string
    amount: MicroUsdc
    signWith?: PrivateKey
    idempotencyKey?: string
  },
): Promise<TransferResult> {
  if (params.amount <= 0n) {
    throw new Error(`Transfer amount must be positive, received ${format(params.amount)}`)
  }
  const token = TokenId.fromString(params.tokenId)
  const from = AccountId.fromString(params.from)
  const to = AccountId.fromString(params.to)
  const units = Number(params.amount)

  let tx = new TransferTransaction()
    .addTokenTransfer(token, from, -units)
    .addTokenTransfer(token, to, units)
    .setMaxTransactionFee(new Hbar(2))

  if (params.idempotencyKey) tx = tx.setTransactionMemo(params.idempotencyKey.slice(0, 100))

  const executed = params.signWith
    ? await (await tx.freezeWith(client).sign(params.signWith)).execute(client)
    : await tx.execute(client)

  const receipt = await executed.getReceipt(client)
  if (receipt.status !== Status.Success) {
    throw new Error(`Transfer failed with status ${receipt.status.toString()}`)
  }

  return {
    transactionId: executed.transactionId.toString(),
    consensusStatus: receipt.status.toString(),
    amount: params.amount,
  }
}

/**
 * Associate an account with a token.
 *
 * Skippable when the account has automatic association slots — portal accounts
 * now ship with -1, meaning unlimited. Accounts WE create do not, so bootstrap
 * must either associate explicitly or set slots at creation. A transfer to an
 * unassociated account with no slots fails, and it is not obvious why.
 */
export async function associateToken(
  client: Client,
  params: { accountId: string; tokenId: string; signWith: PrivateKey },
): Promise<{ transactionId: string; alreadyAssociated: boolean }> {
  const tx = new TokenAssociateTransaction()
    .setAccountId(AccountId.fromString(params.accountId))
    .setTokenIds([TokenId.fromString(params.tokenId)])

  try {
    const executed = await (await tx.freezeWith(client).sign(params.signWith)).execute(client)
    const receipt = await executed.getReceipt(client)
    if (receipt.status !== Status.Success) {
      throw new Error(`Association failed with status ${receipt.status.toString()}`)
    }
    return { transactionId: executed.transactionId.toString(), alreadyAssociated: false }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // Already associated is a success for our purposes — bootstrap is idempotent.
    if (message.includes('TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT')) {
      return { transactionId: '', alreadyAssociated: true }
    }
    throw err
  }
}

export interface MintedToken {
  tokenId: string
  transactionId: string
}

/**
 * Mint a 6-decimal stand-in for USDC.
 *
 * The Probe 1 fallback, decided in hour one: if testnet USDC cannot be
 * obtained, mint our own. It costs one line in the pitch and nothing
 * structural — every claim in the design is about credit mechanics, not about
 * which token moves. Six decimals so MicroUsdc reads it unchanged, and the swap
 * back to real USDC is one environment variable.
 */
export async function mintStandInToken(
  client: Client,
  params: {
    treasuryId: string
    treasuryKey: PrivateKey
    initialSupply: MicroUsdc
    symbol?: string
    name?: string
  },
): Promise<MintedToken> {
  const tx = new TokenCreateTransaction()
    .setTokenName(params.name ?? 'Tab Test Dollar')
    .setTokenSymbol(params.symbol ?? 'TUSD')
    .setTokenType(TokenType.FungibleCommon)
    .setDecimals(6)
    .setInitialSupply(Number(params.initialSupply))
    .setTreasuryAccountId(AccountId.fromString(params.treasuryId))
    .setSupplyType(TokenSupplyType.Infinite)
    .setSupplyKey(params.treasuryKey.publicKey)
    .setAdminKey(params.treasuryKey.publicKey)
    // No freeze key and no KYC key: a token that can freeze the float is a
    // failure mode we do not need to demonstrate.
    .setMaxTransactionFee(new Hbar(40))

  const executed = await (await tx.freezeWith(client).sign(params.treasuryKey)).execute(client)
  const receipt = await executed.getReceipt(client)
  if (receipt.status !== Status.Success) {
    throw new Error(`Token creation failed with status ${receipt.status.toString()}`)
  }
  const tokenId = receipt.tokenId
  if (!tokenId) throw new Error('Token creation returned no token id')

  return { tokenId: tokenId.toString(), transactionId: executed.transactionId.toString() }
}

export interface CreatedAccount {
  accountId: string
  privateKey: PrivateKey
  transactionId: string
}

/**
 * Create an account.
 *
 * `maxAutomaticTokenAssociations` defaults to 0 deliberately. That is the
 * README's silent-failure case — a transfer to an unassociated account with no
 * slots fails, and nothing tells you why unless you look. Tests should exercise
 * it; real Tab accounts set it explicitly.
 */
export async function createAccount(
  client: Client,
  params: { initialHbar?: number; maxAutomaticTokenAssociations?: number } = {},
): Promise<CreatedAccount> {
  const privateKey = PrivateKey.generateED25519()
  const executed = await new AccountCreateTransaction()
    .setKeyWithoutAlias(privateKey.publicKey)
    .setInitialBalance(new Hbar(params.initialHbar ?? 2))
    .setMaxAutomaticTokenAssociations(params.maxAutomaticTokenAssociations ?? 0)
    .execute(client)

  const receipt = await executed.getReceipt(client)
  if (receipt.status !== Status.Success || !receipt.accountId) {
    throw new Error(`Account creation failed with status ${receipt.status.toString()}`)
  }
  return {
    accountId: receipt.accountId.toString(),
    privateKey,
    transactionId: executed.transactionId.toString(),
  }
}

export interface CreatedEvmAccount extends CreatedAccount {
  /** Real ECDSA-derived EVM address, `0x…`. Usable with EVM-oriented tooling. */
  evmAddress: string
}

/**
 * Create an ECDSA account with a real EVM alias.
 *
 * Tab itself never needs an EVM address — we deploy no contracts and touch no
 * EVM tooling. But some faucets and explorers are EVM-oriented and only accept
 * a `0x` address, and an ED25519 Hedera account has no true one: its
 * `evm_address` is a synthetic "long-zero" encoding of the account number,
 * which EVM-oriented forms reject or misroute.
 *
 * This exists solely so an EVM-only faucet can be used. It is NOT a step toward
 * the EVM: no Solidity, no contracts, no EVM tooling in the dependency graph.
 */
export async function createEvmAccount(
  client: Client,
  params: { initialHbar?: number; maxAutomaticTokenAssociations?: number } = {},
): Promise<CreatedEvmAccount> {
  const privateKey = PrivateKey.generateECDSA()
  const executed = await new AccountCreateTransaction()
    // Two args: the account key, and the ECDSA key the EVM alias derives from.
    .setKeyWithAlias(privateKey.publicKey, privateKey)
    .setInitialBalance(new Hbar(params.initialHbar ?? 5))
    // -1 is unlimited: a faucet must be able to send a token we never associated.
    .setMaxAutomaticTokenAssociations(params.maxAutomaticTokenAssociations ?? -1)
    .execute(client)

  const receipt = await executed.getReceipt(client)
  if (receipt.status !== Status.Success || !receipt.accountId) {
    throw new Error(`ECDSA account creation failed with status ${receipt.status.toString()}`)
  }
  return {
    accountId: receipt.accountId.toString(),
    privateKey,
    evmAddress: `0x${privateKey.publicKey.toEvmAddress()}`,
    transactionId: executed.transactionId.toString(),
  }
}
