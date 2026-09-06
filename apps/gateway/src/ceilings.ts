/**
 * Consuming published ceilings.
 *
 * The engine computes a ceiling and publishes it to HCS. The gateway reads that
 * topic and enforces what it finds. Nothing private passes between them — the
 * gateway learns the ceiling from exactly the same public record a stranger
 * running `verify-ceiling` would read.
 *
 * This is what makes the attack demo mean anything. `agents/loop-attacker`'s
 * central invariant is that it uses only public surfaces and gets caught with no
 * help from us: the graph finds the funding edge, the engine publishes a
 * collapsed ceiling, and the fast path refuses the next spend from a real
 * snapshot the real engine wrote. If the gateway needed a private nudge to
 * refuse, the demo would prove nothing.
 */
import { decodeUtf8, readTopic, reassembleChunks, type MirrorClient } from '@tab/mirror'
import { format, usdc, type MicroUsdc } from '@tab/money'
import { decode } from '@tab/protocol'

export interface CeilingSnapshot {
  tab: string
  /** What to enforce. */
  ceiling: MicroUsdc
  /** Present when the asymmetry rule is holding a computed growth back. */
  computed?: MicroUsdc
  window: number
  binding: string
  cause: string
  /** Consensus timestamp of the message this came from. */
  at: string
  model: string
  hash: string
}

export interface CeilingReplay {
  /** Latest ceiling per tab, by consensus order. */
  byTab: Map<string, CeilingSnapshot>
  read: number
  skipped: number
}

/**
 * Replay the ceiling topic and keep the LATEST per tab.
 *
 * "Latest" by consensus timestamp, not by arrival: HCS orders messages and that
 * order is the only one that matters. Two engines publishing for one agent would
 * make this ambiguous, which is exactly why the README requires ceiling
 * publication to be serialised per agent — this reader cannot repair that, it
 * can only pick the last one and be wrong deterministically.
 */
export async function replayCeilings(
  mirror: MirrorClient,
  topicId: string,
): Promise<CeilingReplay> {
  const walk = await readTopic(mirror, { topicId })
  const { assembled } = reassembleChunks(walk.items)

  const byTab = new Map<string, CeilingSnapshot>()
  let read = 0
  let skipped = 0

  for (const message of assembled) {
    const result = decode(decodeUtf8(message.payload))
    if (!result.ok) {
      skipped++
      continue
    }
    if (result.message.t !== 'ceiling') continue
    const msg = result.message

    const snapshot: CeilingSnapshot = {
      tab: msg.tab,
      ceiling: usdc(msg.ceil),
      ...(msg.computed ? { computed: usdc(msg.computed) } : {}),
      window: msg.w,
      binding: msg.bind,
      cause: msg.cause,
      at: message.consensusTimestamp,
      model: msg.model,
      hash: msg.hash,
    }

    const existing = byTab.get(msg.tab)
    // Strictly later only. An equal timestamp cannot happen on one topic, and
    // treating "not earlier" as "later" would let a re-read flip between two
    // messages depending on page boundaries.
    if (!existing || snapshot.at > existing.at) byTab.set(msg.tab, snapshot)
    read++
  }

  return { byTab, read, skipped }
}

/**
 * Describe a snapshot for the console.
 *
 * The demo shows this line at the moment of the collapse, so it names the cause
 * rather than only the number: "0.0000 bound by unrated, cause graph_change" is
 * the sentence that explains a refusal, where "0.0000" alone invites the guess
 * that something broke.
 */
export function describeCeiling(snapshot: CeilingSnapshot): string {
  // `format`, not interpolation. A MicroUsdc is a bigint, so a template string
  // prints raw micro-units — the log said `0.0000 → 1000000`, which reads as a
  // ceiling a million times too large at exactly the moment an operator is
  // trying to understand a refusal.
  const held = snapshot.computed
    ? ` · computed ${format(snapshot.computed)} HELD by the asymmetry rule`
    : ''
  return (
    `${format(snapshot.ceiling)} bound by ${snapshot.binding} · cause ${snapshot.cause} · ` +
    `window ${snapshot.window} · ${snapshot.model} · hash ${snapshot.hash.slice(0, 8)}${held}`
  )
}
