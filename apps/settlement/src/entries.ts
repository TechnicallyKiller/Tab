import { entriesFromMessages, type Entry, type Replay } from '@tab/ledger'
import { readTopic, reassembleChunks, type MirrorClient } from '@tab/mirror'

/**
 * Rebuild ledger entries from the receipt topic.
 *
 * The settlement worker never trusts the gateway's memory. It replays HCS, the
 * same way a stranger running `verify-tab` would — so a settlement is computed
 * from the public record rather than from our own process state. If those two
 * ever disagreed, the public record is the one that counts.
 */
export async function replayEntries(mirror: MirrorClient, topicId: string): Promise<Replay> {
  const walk = await readTopic(mirror, { topicId })
  const { assembled } = reassembleChunks(walk.items)
  // The decode lives in @tab/ledger so the engine can share it — two apps
  // needing the same logic means the logic belongs in a package.
  return entriesFromMessages(assembled)
}

/** Windows that have receipts but no settlement message yet. */
export function unsettledWindows(entries: readonly Entry[], currentWindow: number): number[] {
  const settled = new Set(entries.filter((e) => e.kind === 'settlement').map((e) => e.window))
  const seen = new Set(
    entries
      .filter((e) => e.kind === 'debit' || e.kind === 'credit' || e.kind === 'interest' || e.kind === 'repair')
      .map((e) => e.window),
  )
  // Never settle the window still in progress — receipts are still arriving.
  return [...seen].filter((w) => !settled.has(w) && w < currentWindow).sort((a, b) => a - b)
}
