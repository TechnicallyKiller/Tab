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
import { readTopic, reassembleChunks, type MirrorClient } from '@tab/mirror'
import { format } from '@tab/money'
import { ceilingsFromMessages, type PublishedCeiling } from '@tab/ledger'

/*
 * The decode lives in `@tab/ledger`, not here.
 *
 * Three readers wanted it — this one enforces the ceiling, `apps/engine` seeds
 * its asymmetry state from it, and both had their own copy. `tools/verify`
 * deliberately keeps a fourth, because it needs the `inputs` object VERBATIM to
 * rehash and a typed round-trip risks changing key order; that difference is
 * real, so it is not consolidated away.
 */
export type CeilingSnapshot = PublishedCeiling

export interface CeilingReplay {
  /** Latest ceiling per tab, in consensus order. */
  byTab: Map<string, CeilingSnapshot>
  read: number
}

/**
 * Replay the ceiling topic and keep the LATEST per tab.
 *
 * Two engines publishing for one agent would make this ambiguous, which is why
 * the README requires ceiling publication to be serialised per agent — this
 * reader cannot repair that, only pick the last one and be wrong
 * deterministically.
 */
export async function replayCeilings(
  mirror: MirrorClient,
  topicId: string,
): Promise<CeilingReplay> {
  const walk = await readTopic(mirror, { topicId })
  const { assembled } = reassembleChunks(walk.items)
  const byTab = ceilingsFromMessages(assembled)
  return { byTab, read: assembled.length }
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
