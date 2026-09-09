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

import {
  ceilingHistoryFromMessages,
  factsFromMessages,
  type PublishedCeiling,
  type PublishedWeight,
  type Registration,
  type RememberedFacts,
  registrationsFromMessages,
  weightsFromMessages,
} from '@tab/ledger'
import { type MirrorClient, readTopic, reassembleChunks } from '@tab/mirror'
import { format } from '@tab/money'

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
  /**
   * Latest independence weight per counterparty.
   *
   * On the same topic as the ceiling because they are the ceiling's evidence —
   * one read gives the console both the number and the reasons for it.
   */
  weights: Map<string, PublishedWeight>
  /**
   * Every ceiling ever published, per tab, ascending.
   *
   * The console's ceiling view needs the SERIES, not the latest value: the
   * demo's central moment is a collapse, and a collapse is only visible next to
   * what it collapsed from. Served from the same replay so the number in force
   * and the history behind it cannot disagree on screen.
   */
  history: Map<string, PublishedCeiling[]>
  /**
   * Published account provenance — creation time and funder.
   *
   * Served so the Counterparties view can show the EVIDENCE for a reason
   * rather than only the reason. `COMMON_FUNDER` is decided by comparing two
   * values — the tab's funder and the counterparty's — and until these were
   * published the console rendered `—` for both, so the strongest claim in the
   * demo was unfalsifiable on screen.
   *
   * These are the two values the rule actually compared, not a re-derivation.
   */
  facts: Map<string, RememberedFacts>
  /**
   * Starter Tab claims, by tab.
   *
   * The gateway reports these; it does not decide them. Resolving a funding
   * root needs `@tab/graph`, which `boundaries.json` bars this app from — and
   * rightly: the engine resolves the root, publishes the claim, and the fast
   * path reads the consequence as a ceiling like everything else.
   */
  registrations: Map<string, Registration>
  /**
   * How many funding ROOTS are claimed — not how many tabs registered.
   *
   * They differ, and the difference is not academic: one tab can hold claims on
   * several roots over its life (an early claim can be left inert when the root
   * resolution itself changes, as happened when `0.0.2` stopped being a valid
   * root). Serving `registrations.size` as a root count reported 1 on live data
   * where 2 roots were claimed.
   */
  rootsClaimed: number
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
  const weights = weightsFromMessages(assembled)

  /*
   * `byTab` is derived from the history rather than read separately.
   *
   * `ceilingsFromMessages` would give the same answer, and calling both would
   * decode the topic twice — but the real reason is that two independent
   * readers can disagree. The history is ascending by consensus timestamp, so
   * its last element IS the latest, and deriving it here makes "the ceiling in
   * force" and "the last row of the chart" the same fact by construction.
   */
  const facts = factsFromMessages(assembled).byAccount
  const allRegistrations = registrationsFromMessages(assembled)
  const history = ceilingHistoryFromMessages(assembled)
  const byTab = new Map<string, CeilingSnapshot>()
  for (const [tab, list] of history) {
    const latest = list.at(-1)
    if (latest) byTab.set(tab, latest)
  }

  return {
    byTab,
    weights,
    history,
    facts,
    registrations: allRegistrations.byTab,
    rootsClaimed: allRegistrations.byRoot.size,
    read: assembled.length,
  }
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
