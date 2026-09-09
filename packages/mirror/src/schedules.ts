import { type MirrorClient, MirrorError } from './client.ts'
import type { ConsensusTimestamp, EntityId } from './types.ts'

/**
 * Schedule state, read from Mirror Node rather than a consensus node.
 *
 * ScheduleInfoQuery against a consensus node returns INVALID_SCHEDULE_ID when
 * the query lands on a different node than the create did — the schedule has
 * not propagated there yet. Mirror Node has a single consistent view, and reads
 * belong there anyway.
 */
export interface MirrorSchedule {
  schedule_id: EntityId
  creator_account_id: EntityId
  payer_account_id: EntityId
  consensus_timestamp: ConsensusTimestamp
  /** Set once consensus has run the inner transaction. Null until then. */
  executed_timestamp: ConsensusTimestamp | null
  expiration_time: ConsensusTimestamp | null
  wait_for_expiry: boolean
  deleted: boolean
  memo: string | null
  signatures: unknown[]
}

/** Null when Mirror Node has not indexed the schedule yet. */
export async function getSchedule(
  client: MirrorClient,
  scheduleId: EntityId,
): Promise<MirrorSchedule | null> {
  try {
    return await client.get<MirrorSchedule>(`/api/v1/schedules/${scheduleId}`)
  } catch (err) {
    if (err instanceof MirrorError && err.status === 404) return null
    throw err
  }
}

/**
 * Wait for a scheduled transaction to execute.
 *
 * The settlement worker polls this rather than submitting anything: with
 * wait_for_expiry the tick is run by consensus, and our job is to observe it.
 */
export async function waitForScheduleExecution(
  client: MirrorClient,
  scheduleId: EntityId,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<MirrorSchedule> {
  const timeoutMs = opts.timeoutMs ?? 180_000
  const intervalMs = opts.intervalMs ?? 4000
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const schedule = await getSchedule(client, scheduleId)
    if (schedule?.executed_timestamp) return schedule
    if (schedule?.deleted) {
      throw new Error(`Schedule ${scheduleId} was deleted before it executed`)
    }
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  throw new Error(`Schedule ${scheduleId} did not execute within ${Math.round(timeoutMs / 1000)}s`)
}
