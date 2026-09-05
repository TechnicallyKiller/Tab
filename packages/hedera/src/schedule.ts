import {
  AccountId,
  Hbar,
  ScheduleCreateTransaction,
  ScheduleId,
  ScheduleInfoQuery,
  Status,
  Timestamp,
  TransferTransaction,
  type Client,
  type PrivateKey,
  type Transaction,
} from '@hiero-ledger/sdk'
import { type MicroUsdc } from '@tab/money'

/**
 * HIP-423 long-term scheduled transactions — the settlement tick.
 *
 * Shipped in mainnet v0.57. Two fields matter:
 *
 *   expiration_time   when the schedule expires. Defaults to 30 minutes,
 *                     supported out to roughly two months.
 *   wait_for_expiry   when true, the transaction is evaluated AT EXPIRY rather
 *                     than when the last required signature arrives.
 *
 * Tab creates the window's settlement transfer with `wait_for_expiry: true` and
 * an expiry at window close. Consensus executes it. No keeper, no cron, no bot
 * we run and pay for.
 *
 * NOT recurring billing: a schedule fires once and expires. Each window creates
 * its own. The README is right that claiming cron would be wrong.
 */

export interface ScheduledSettlement {
  scheduleId: string
  transactionId: string
  /** Consensus evaluates the inner transaction at this time. */
  expiresAt: Date
  waitForExpiry: boolean
}

export interface ScheduleSettlementParams {
  /** The net transfer for the window. Built, frozen by the schedule, not submitted. */
  inner: Transaction
  /** When the window closes. Consensus evaluates the inner transaction then. */
  expiresAt: Date
  memo?: string
  adminKey?: PrivateKey
  /** Who pays for the inner transaction at execution. Defaults to the operator. */
  payerAccountId?: string
}

export async function scheduleSettlement(
  client: Client,
  params: ScheduleSettlementParams,
): Promise<ScheduledSettlement> {
  let tx = new ScheduleCreateTransaction()
    .setScheduledTransaction(params.inner)
    // The whole point: evaluate at expiry, not when signatures land.
    .setWaitForExpiry(true)
    .setExpirationTime(Timestamp.fromDate(params.expiresAt))
    .setMaxTransactionFee(new Hbar(5))

  if (params.memo) tx = tx.setScheduleMemo(params.memo.slice(0, 100))
  if (params.adminKey) tx = tx.setAdminKey(params.adminKey.publicKey)
  if (params.payerAccountId) {
    tx = tx.setPayerAccountId(AccountId.fromString(params.payerAccountId))
  }

  const executed = await tx.execute(client)
  const receipt = await executed.getReceipt(client)
  if (receipt.status !== Status.Success || !receipt.scheduleId) {
    throw new Error(`Schedule creation failed with status ${receipt.status.toString()}`)
  }

  return {
    scheduleId: receipt.scheduleId.toString(),
    transactionId: executed.transactionId.toString(),
    expiresAt: params.expiresAt,
    waitForExpiry: true,
  }
}

/** Build the netted settlement transfer a window schedules. */
export function buildSettlementTransfer(params: {
  tokenId?: string
  from: string
  to: string
  amount: MicroUsdc
}): TransferTransaction {
  const from = AccountId.fromString(params.from)
  const to = AccountId.fromString(params.to)
  const units = Number(params.amount)

  const tx = new TransferTransaction().setMaxTransactionFee(new Hbar(2))
  if (params.tokenId) {
    return tx
      .addTokenTransfer(params.tokenId, from, -units)
      .addTokenTransfer(params.tokenId, to, units)
  }
  return tx.addHbarTransfer(from, Hbar.fromTinybars(-units)).addHbarTransfer(to, Hbar.fromTinybars(units))
}

export interface ScheduleState {
  scheduleId: string
  /** Set once consensus has run the inner transaction. */
  executedAt: Date | null
  deletedAt: Date | null
  expiresAt: Date | null
  waitForExpiry: boolean
  memo: string | null
}

/** Has the tick fired yet? The settlement worker polls this. */
export async function getScheduleState(
  client: Client,
  scheduleId: string,
): Promise<ScheduleState> {
  const info = await new ScheduleInfoQuery()
    .setScheduleId(ScheduleId.fromString(scheduleId))
    .execute(client)

  return {
    scheduleId,
    executedAt: info.executed ? info.executed.toDate() : null,
    deletedAt: info.deleted ? info.deleted.toDate() : null,
    expiresAt: info.expirationTime ? info.expirationTime.toDate() : null,
    waitForExpiry: info.waitForExpiry ?? false,
    memo: info.scheduleMemo ?? null,
  }
}
