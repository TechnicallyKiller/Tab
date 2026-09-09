import { buildSettlementTransfer, scheduleSettlement, type TabClient } from '@tab/hedera'
import {
  accrue,
  type Entry,
  netWindow,
  planSettlement,
  position,
  type SettlementPlan,
} from '@tab/ledger'
import { type MirrorClient, waitForScheduleExecution } from '@tab/mirror'
import { bp, format, type MicroUsdc, micro, usdc } from '@tab/money'
import { aprBpFor, type Tier } from '@tab/params'

/**
 * The window tick.
 *
 * Every number here comes from `@tab/ledger`. This file decides *when* and
 * *how* value moves; it does no arithmetic of its own. Money math lives in a
 * pure package so it can be tested without standing up a chain.
 */

export interface TickConfig {
  tab: string
  window: number
  windowSeconds: number
  ceiling: MicroUsdc
  tokenId: string
  /** Hot float — pays out a positive net. */
  floatAccount: string
  /** Ramp in force before this window, basis points. */
  rampBp: number
  tier: Tier
  /** Balance available in the float to cover a payout. */
  floatBalance: MicroUsdc
}

export interface TickResult {
  plan: SettlementPlan
  interest: MicroUsdc
  /** Set when the net was positive and a transfer was scheduled. */
  scheduleId?: string
  /** Set once consensus has executed it. */
  executedAt?: string
  transactionId?: string
  /** True when a transfer WOULD have been made but `execute: false` held it. */
  planOnly?: boolean
}

/**
 * Compute and execute one window's settlement.
 *
 * Interest is charged BEFORE netting, on what was owed entering the window, so
 * a carried balance costs something and the net reflects it. Charging it after
 * would let an agent carry indefinitely for free.
 */
export async function tick(
  deps: { hedera: TabClient; mirror: MirrorClient },
  entries: readonly Entry[],
  config: TickConfig,
  opts: { execute?: boolean } = {},
): Promise<TickResult> {
  /*
   * `execute: false` computes the plan and moves NOTHING.
   *
   * This exists because the first version of the worker had a `--dry-run` flag
   * that suppressed only the receipt write — so a "dry run" scheduled and
   * executed a real transfer on testnet, and then omitted the receipt that
   * marks the window settled, leaving the next real pass ready to pay it a
   * second time. A dry run that moves money is worse than no dry run at all,
   * because the flag is what convinced you it was safe.
   */
  const execute = opts.execute ?? true
  const now = `${Math.floor(Date.now() / 1000)}.000000000`
  const before = position(entries, config.ceiling, now)

  // Interest on what was already owed entering this window.
  const aprBp = bp(aprBpFor(config.tier))
  const interest = accrue({
    outstanding: before.outstanding,
    aprBp,
    seconds: config.windowSeconds,
  })

  const withInterest: Entry[] =
    interest > 0n
      ? [
          ...entries,
          {
            kind: 'interest',
            at: now,
            window: config.window,
            amount: micro(-interest),
            rateBp: aprBp,
          },
        ]
      : [...entries]

  const net = netWindow(withInterest, config.window)
  const plan = planSettlement({
    net,
    outstandingBefore: before.outstanding,
    rampBp: config.rampBp,
    // A positive net we cannot cover is MISSED, not clean. Claiming a clean
    // settlement we could not fund would be the worst kind of wrong.
    funded: config.floatBalance >= net.net,
  })

  // Only a clean settlement moves value. A carried window rolls forward and a
  // missed one moves nothing — in both cases there is no transfer to schedule.
  if (plan.outcome !== 'clean' || plan.transfer <= 0n) {
    return { plan, interest }
  }

  if (!execute) return { plan, interest, planOnly: true }

  /*
   * A settlement from the float to itself is not a settlement.
   *
   * The demo ran exactly this: `apps/gateway` used the operator id as the tab
   * id, so the tab and the hot float were one account and the scheduled
   * transfer moved 0.1000 TUSD from 0.0.8812188 to 0.0.8812188. Hedera accepted
   * it, consensus executed it, and the tick printed CLEAN with a schedule id —
   * a settlement that looked perfect on camera and moved nothing between two
   * parties. Refuse it loudly instead: the tab is the agent's account, and if
   * it equals the float then the configuration is wrong, not the transfer.
   */
  if (config.tab === config.floatAccount) {
    throw new Error(
      `Refusing to settle: the tab (${config.tab}) and the hot float are the same account, ` +
        'so the transfer would be a self-transfer that moves nothing while reporting CLEAN. ' +
        "Set TAB_ACCOUNT_ID to the agent's own account — it must differ from the float.",
    )
  }

  // Scheduled at CLOSE, once the net is known. See ADR-0009: the tick is
  // executed by consensus rather than submitted by us, and survives this
  // worker dying a second from now — that is the property worth having.
  const inner = buildSettlementTransfer({
    tokenId: config.tokenId,
    from: config.floatAccount,
    to: config.tab,
    amount: plan.transfer,
  })

  const scheduled = await scheduleSettlement(deps.hedera.client, {
    inner,
    expiresAt: new Date(Date.now() + 40_000),
    memo: `tab:settlement:w${config.window}`,
    adminKey: deps.hedera.operatorKey,
  })

  const fired = await waitForScheduleExecution(deps.mirror, scheduled.scheduleId, {
    timeoutMs: 180_000,
  })

  return {
    plan,
    interest,
    scheduleId: scheduled.scheduleId,
    ...(fired.executed_timestamp ? { executedAt: fired.executed_timestamp } : {}),
    transactionId: scheduled.transactionId,
  }
}

/** Human-readable tick summary. This ends up on camera. */
export function describeTick(result: TickResult, config: TickConfig): string[] {
  const { plan } = result
  const lines = [
    `  window ${config.window}`,
    `    credits        ${format(plan.net.credits, { sign: 'always' })}`,
    `    debits         ${format(plan.net.debits, { sign: 'always' })}`,
    `    interest       ${format(micro(-result.interest), { sign: 'always' })}  (${config.tier} @ ${aprBpFor(config.tier)} bp APR)`,
    `    ${'─'.repeat(40)}`,
    `    net            ${format(plan.net.net, { sign: 'always' })}`,
    `    receipts       ${plan.net.receiptCount} → ${plan.outcome === 'clean' ? '1 transfer' : '0 transfers'}`,
    `    refusals       ${plan.net.refusalCount}`,
    `    outcome        ${plan.outcome.toUpperCase()}`,
    `    ramp           ${plan.rampFromBp / 100}% → ${plan.rampToBp / 100}%`,
    `    outstanding    ${format(plan.outstandingAfter)}`,
  ]
  if (result.planOnly) {
    lines.push(`    transfer       ${format(plan.transfer)} WOULD MOVE — held by --dry-run`)
  }
  if (result.scheduleId) {
    lines.push(`    schedule       ${result.scheduleId}`)
    lines.push(`    executed       ${result.executedAt ?? 'pending'}  (by consensus, not by us)`)
  }
  return lines
}

export { usdc }
