/**
 * The engine — the slow path.
 *
 *   pnpm engine            recompute on a loop
 *   pnpm engine:once       one recompute, then exit
 *   pnpm engine:once --publish   also write the ceiling to HCS
 *
 * Mirror Node → graph → scoring → a ceiling → HCS. It is allowed to be slow;
 * that is the entire point of splitting the paths. The gateway's fast path
 * never waits on this.
 *
 * ## What is deferred, said out loud
 *
 * The README specifies a BullMQ worker over a Postgres graph with a Redis
 * snapshot. This runs the same compute against Mirror Node directly, because
 * `@tab/db` and `@tab/cache` are not written yet. That is a real difference and
 * it costs two things: the indexer's incremental `edge-discovered` job, and the
 * snapshot the fast path would read instead of recomputing.
 *
 * What it does NOT cost is correctness of the numbers — the ceiling comes from
 * the same pure packages a stranger would rerun, from the same public data. So
 * the transparency claim holds today and the persistence layer is a performance
 * story, which is the right order to build them in.
 */

import { type AccountFacts, type AccountId, fundingRoot, WEIGHT_REASON_DETAIL } from '@tab/graph'
import { clientFromEnv } from '@tab/hedera'
import {
  ceilingsFromMessages,
  factsFromMessages,
  rampAfter,
  registrationsFromMessages,
  starterGrantFor,
} from '@tab/ledger'
import { configureGlobalHttp, MirrorClient } from '@tab/mirror'
import { bp, format, formatBpMultiple, formatBpPercent, usdc } from '@tab/money'
import { caps, describeParams, MODEL_ID, params, windowOf } from '@tab/params'
import { resolveAncestry } from './ancestry.ts'
import { edgesFor, isYoungFrom, observeAccount, revenueFromEntries } from './gather.ts'
import { type CeilingState, transition } from './guards/asymmetry.ts'
import { publishCeiling } from './publish/ceiling.ts'
import { type ObservedFact, publishFacts } from './publish/facts.ts'
import { publishRegistration } from './publish/registration.ts'
import { publishWeights } from './publish/weights.ts'
import { recompute } from './recompute.ts'
import { entriesFromMessages, readTopic, reassembleChunks } from './replay.ts'

configureGlobalHttp({ connectTimeoutMs: 60_000 })

const once = process.argv.includes('--once')
const publish = process.argv.includes('--publish')

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value || value.includes('xxxxx')) {
    throw new Error(`The engine cannot start. Missing from .env: ${name}`)
  }
  return value
}

const tokenId = requireEnv('USDC_TOKEN_ID')
const receiptTopic = requireEnv('TOPIC_RECEIPTS')
const settlementTopic = requireEnv('TOPIC_SETTLEMENTS')
const ceilingTopic = requireEnv('TOPIC_CEILINGS')
const tabAccount = requireEnv('TAB_ACCOUNT_ID')

const demoMode = process.env['DEMO_MODE'] === 'true'
const windowSeconds = demoMode
  ? Number(process.env['WINDOW_SECONDS'] ?? params.window.seconds)
  : params.window.seconds

/** How many trailing windows the revenue average spans. */
const TRAILING_WINDOWS = Number(process.env['TRAILING_WINDOWS'] ?? 6)

const hedera = clientFromEnv()
const mirror = new MirrorClient({
  network: hedera.network,
  timeoutMs: 45_000,
  maxRetries: 4,
  maxPages: 12,
})

/*
 * The ceiling state lives in this process for now.
 *
 * It belongs in the Redis snapshot — the README is right that there must be ONE
 * writer and many readers. Held here it does not survive a restart, which means
 * a restart re-derives `inForce` from the recompute and so briefly forgets that
 * a growth was pending. That is the safe direction to fail (a pending growth is
 * held, never applied), but it IS a difference from the specified design and
 * belongs in the handoff rather than in a comment nobody reads.
 */
let ceilingState: CeilingState | undefined

/**
 * Read a topic and decode it into ledger entries.
 *
 * The five lines of fetch are duplicated in `apps/settlement` on purpose. The
 * decode itself is shared via `@tab/ledger`, which may NOT import
 * `@tab/mirror` — a pure accounting package that can make network requests
 * would be a far worse trade than a repeated `readTopic` call.
 */
async function replayTopic(topicId: string) {
  const walk = await readTopic(mirror, { topicId })
  const { assembled } = reassembleChunks(walk.items)
  return entriesFromMessages(assembled)
}

async function pass(): Promise<void> {
  const nowSeconds = Math.floor(Date.now() / 1000)
  const currentWindow = windowOf(nowSeconds, windowSeconds)

  const receipts = await replayTopic(receiptTopic)
  const settlements = await replayTopic(settlementTopic)

  /*
   * The ceiling topic, read ONCE per pass and used three ways.
   *
   * Remembered graph facts (the fail-open fix), the in-force ceiling to resume
   * on a cold start, and the check on what is worth republishing. It was read
   * lazily inside the cold-start branch before; facts are needed on every pass,
   * and reading the same topic twice in one pass would give two readers a
   * chance to disagree about it.
   */
  const ceilingMessages = reassembleChunks(
    (await readTopic(mirror, { topicId: ceilingTopic })).items,
  ).assembled
  const entries = [
    ...(receipts.byTab.get(tabAccount) ?? []),
    ...(settlements.byTab.get(tabAccount) ?? []),
  ]

  const revenue = revenueFromEntries(entries, TRAILING_WINDOWS, currentWindow)

  const settlementEntries = entries.filter((e) => e.kind === 'settlement')
  const hasDefaulted = settlementEntries.some(
    (e) => e.kind === 'settlement' && e.outcome === 'missed',
  )

  // Consecutive clean settlements, counted from the most recent backwards. A
  // total count would let an old good history outweigh a recent miss.
  let cleanStreak = 0
  for (let i = settlementEntries.length - 1; i >= 0; i--) {
    const entry = settlementEntries[i]!
    if (entry.kind !== 'settlement' || entry.outcome === 'missed') break
    if (entry.outcome === 'clean') cleanStreak++
  }

  const counterparties = [...revenue.revenueByCounterparty.keys()]

  console.log(
    `\n  window ${currentWindow} · ${revenue.history.length} closed window(s) of revenue · ` +
      `${counterparties.length} counterparty(ies)`,
  )

  /*
   * Funding ancestry, one hop per counterparty.
   *
   * Mirror Node does not expose a funder, so it is derived from the earliest
   * inbound transfer. A failure here is NOT fatal: Mirror Node lag is normal,
   * and an account whose ancestry could not be fetched is treated as having
   * none — which fails OPEN, weighting it as independent. That is the wrong
   * direction for safety and is exactly why it is said here rather than buried:
   * the fix is a persisted graph, which is what @tab/db is for.
   */
  const facts = new Map<AccountId, AccountFacts>()
  const young = new Set<AccountId>()

  /*
   * What the topic already remembers.
   *
   * Read once per pass and used two ways: as the FALLBACK when Mirror Node
   * cannot answer, and as the check on what is worth publishing. The reader is
   * monotonic — a fact with no funder cannot erase a known one — which is the
   * property the whole fix rests on. See `factsFromMessages`.
   */
  const remembered = factsFromMessages(ceilingMessages)
  if (remembered.conflicts.length > 0) {
    /*
     * Never expected: an account has exactly one creating payer, forever.
     *
     * Reported rather than resolved. Two different answers means either a bug
     * in whatever published, or a writer on this topic who should not be — and
     * silently taking one would hide both.
     */
    for (const c of remembered.conflicts) {
      console.log(
        `    CONFLICT  ${c.account} was published as funded by both ${c.kept} and ${c.rejected}; ` +
          `keeping the first observation (${c.kept})`,
      )
    }
  }

  /** Everything this pass actually saw, for the publisher to diff. */
  const observed: ObservedFact[] = []
  const stats = { fetched: 0, remembered: 0, unknown: 0 }

  /*
   * The TAB's own ancestry, which was missing.
   *
   * Without an entry for the tab, `sharedFundingRoot(tab, counterparty, ...)`
   * returns false every time — the tab simply is not in the map — so the shared
   * -root discount and the common-funder block were both structurally
   * impossible. Neither rule was wrong; neither was ever asked.
   */
  /**
   * Walk ancestry to the HOP LIMIT, not one hop.
   *
   * The third gap of this family, and the same shape as the first two: the rule
   * was fine and was never asked. `facts` only ever held one `fundedBy` per
   * account, so `sharedFundingRoot(tab, counterparty, facts, 3)` could see one
   * hop on each side and never the chain between them. With
   * `operator → tab` and `operator → intermediary → customer`, the shared root
   * IS the operator and the traversal could not reach it — so
   * `SHARED_FUNDING_ROOT` was as unreachable as `FUNDED_BY_AGENT` had been.
   *
   * Memoised across the pass: the whole point of an ancestry walk is that
   * accounts share ancestors, so the same funder gets asked for repeatedly.
   */
  /*
   * The walk lives in `ancestry.ts` so it can be TESTED.
   *
   * It was inline here, and the branch that matters most — Mirror Node
   * unavailable, the topic answering instead — is the branch a live run is
   * least likely to exercise, because Mirror usually works. A security rule
   * that fails open should not be trusted on a coincidence.
   *
   * The tab is walked first so its own ancestry is in `facts` before any
   * counterparty is compared against it. Without an entry for the tab,
   * `sharedFundingRoot(tab, counterparty, ...)` returns false every time — the
   * tab simply is not in the map — which made the shared-root discount and the
   * common-funder block both structurally impossible. Neither rule was wrong;
   * neither was ever asked.
   */
  const ancestry = await resolveAncestry([tabAccount, ...counterparties], {
    observe: (account) => observeAccount(mirror, account),
    remembered: remembered.byAccount,
    hops: params.fundingAncestryHops,
    note: (line) => console.log(line),
  })
  for (const [id, fact] of ancestry.facts) facts.set(id, fact)
  observed.push(...ancestry.observed)
  stats.fetched = ancestry.stats.fetched
  stats.remembered = ancestry.stats.remembered
  stats.unknown = ancestry.stats.unknown

  const tabFunder = facts.get(tabAccount)?.fundedBy?.[0]
  if (tabFunder) console.log(`    tab funded by ${tabFunder}`)

  for (const counterparty of counterparties) {
    /*
     * The age comes from the birth time the walk already has.
     *
     * `isYoung` made its OWN `getAccount` call, so every counterparty cost two
     * identical account fetches per pass — and, worse, the two answers could
     * disagree: one call could succeed and the other fail, giving an account a
     * funder but no age, or the reverse. One observation now answers both
     * questions, and it falls back to the remembered birth time exactly as the
     * ancestry does.
     */
    const age = isYoungFrom(ancestry.birthdays.get(counterparty), nowSeconds)
    if (age === true) young.add(counterparty)
    else if (age === undefined) {
      // An unknown age is not "old enough". Left out of `young` means no age
      // discount, which is the unsafe direction — the same residual as the
      // ancestry case, and named the same way rather than treated as different.
      console.log(
        `    WARNING  age for ${counterparty} unknown (not fetched, not published) — ` +
          `no age discount applied (FAILS OPEN)`,
      )
    }
  }

  /*
   * The unverifiable counterparties, named on their own line.
   *
   * `stats.unknown` counts accounts the WALK could not resolve, which includes
   * ancestors nobody is being weighted on. This counts the ones that actually
   * cost something: a counterparty contributing revenue whose provenance we
   * cannot establish, and which v3 therefore discounts rather than trusts.
   */
  const unverifiedCounterparties = counterparties.filter((c) => ancestry.unverified.has(c))

  console.log(
    `    ancestry    ${stats.fetched} fetched · ${stats.remembered} from the topic · ` +
      `${stats.unknown} unresolved`,
  )
  if (unverifiedCounterparties.length > 0) {
    const step = params.weights?.unverifiedBp
    console.log(
      `    UNVERIFIED  ${unverifiedCounterparties.length} counterparty(ies) with no published ` +
        `provenance — discounted to ${step !== undefined ? `${step / 100}%` : 'full weight (pre-v3 set)'}: ` +
        unverifiedCounterparties.join(', '),
    )
  }

  /*
   * ── the Starter Tab claim ────────────────────────────────────────────────
   *
   * One Starter Tab per funding root. The root comes from the PUBLISHED facts
   * the walk just resolved, so the rule keys on something a stranger can check
   * rather than on whether an operator remembered to register — an attacker
   * would simply not register, and a rule keyed on registration presence
   * defends against nothing.
   */
  const registrations = registrationsFromMessages(ceilingMessages)
  const root = fundingRoot(tabAccount, facts, params.fundingAncestryHops)
  const grant = starterGrantFor(tabAccount, root?.root, registrations)

  console.log(
    `    root        ${root ? `${root.root} (${root.hops} hop(s))` : 'unresolved'} · ` +
      `starter grant ${grant.status}` +
      (grant.status === 'taken' ? ` — held by ${grant.heldBy} (seq ${grant.seq ?? '?'})` : '') +
      (grant.seq !== undefined && grant.status === 'granted'
        ? ` (claimed at seq ${grant.seq})`
        : ''),
  )
  if (grant.status === 'taken') {
    console.log(
      `    NO STARTER FLOOR — another tab already holds the claim on ${root?.root}. ` +
        'This tab must earn its ceiling from independent revenue.',
    )
  }

  const edges = await edgesFor(
    mirror,
    [tabAccount, ...counterparties],
    tokenId,
    Math.max(0, currentWindow - TRAILING_WINDOWS),
    windowSeconds,
  )

  const result = recompute({
    tab: tabAccount,
    edges,
    facts,
    history: revenue.history,
    attestedCounterparties: revenue.attestedCounterparties,
    revenueByCounterparty: revenue.revenueByCounterparty,
    young,
    unverified: ancestry.unverified,
    starterGrant: grant.status,
    rampBp: rampAfter(entries),
    cleanStreak,
    hasDefaulted,
    windowCount: TRAILING_WINDOWS,
    hardCap: usdc(process.env['TIER_HARD_CAP_USDC'] ?? '100.000000'),
  })

  console.log(`
  revenue         ${format(result.ceiling.inputs.revenue)} per window  (attested ${format(result.ceiling.inputs.attested)} · unattested ${format(result.ceiling.inputs.unattested)})
  tier            ${result.tier}  ×${formatBpMultiple(bp(result.ceiling.inputs.multipleBp))}
                  ${result.tierReason}
  ramp            ${formatBpPercent(bp(result.ceiling.inputs.rampBp), 0)}  (clean streak ${cleanStreak}${hasDefaulted ? ', HAS DEFAULTED' : ''})
  ceiling         ${format(result.ceiling.ceiling)}  bound by ${result.ceiling.binding}
  model           ${result.modelId}`)

  if (result.weights.length > 0) {
    console.log(`\n  counterparties`)
    for (const weight of result.weights) {
      // formatBpPercent, not `bp / 100`. Basis points are integers precisely so
      // display never routes a rate through a float — `guard:money` catches it,
      // and it is right to: the one place a float is harmless today is the
      // place someone copies it from tomorrow.
      const pct = formatBpPercent(bp(weight.bp), 0).padStart(4)
      console.log(`    ${weight.counterparty}  ${pct}  ${weight.blocking ? 'BLOCKED' : 'counted'}`)
      for (const reason of weight.reasons) {
        console.log(`           ${reason}: ${WEIGHT_REASON_DETAIL[reason]}`)
      }
    }
  }

  /*
   * The asymmetry rule. Shrink now; hold growth for a clean settlement.
   *
   * On a cold start the prior in-force value is read from the TOPIC, not seeded
   * from the fresh computation. Seeding from the computation was a hole in the
   * rule: a restart would accept whatever it had just computed, so a growth the
   * running engine would have held became immediately effective simply because
   * the process had been restarted. The published ceiling is the durable record
   * of what is in force, so it is the right thing to resume from.
   */
  if (!ceilingState) {
    const published = ceilingsFromMessages(ceilingMessages).get(tabAccount)
    if (published) {
      ceilingState = { inForce: published.ceiling, window: published.window }
      console.log(
        `    resumed in-force ${format(published.ceiling)} from ${ceilingTopic} (window ${published.window})`,
      )
    }
  }

  const previous: CeilingState = ceilingState ?? {
    inForce: result.ceiling.ceiling,
    window: currentWindow,
  }
  const move = transition(previous, result.ceiling.ceiling, currentWindow)
  ceilingState = move.next
  console.log(`\n  transition      ${move.action}\n                  ${move.reason}`)

  if (!publish) {
    console.log('\n  NOT PUBLISHED (pass --publish to write the ceiling to HCS)\n')
    return
  }

  /*
   * Published even when the ceiling did not change.
   *
   * "Stayed capped because concentration" is information the operator needs,
   * and an engine that only speaks when a number moves is indistinguishable
   * from one that has died.
   */
  /*
   * Weights first, then the ceiling.
   *
   * The ceiling is the CONCLUSION and the weights are the evidence for it, so a
   * reader who sees a ceiling on the topic can already find the weights that
   * produced it. Published the other way round there is a window — small, but
   * real — where the console shows a collapsed ceiling and no reason for it,
   * which is the one thing the Counterparties view exists to prevent.
   */
  /*
   * Facts first, then weights, then the ceiling — evidence before conclusion.
   *
   * A fact is the evidence for a weight, and a weight is the evidence for the
   * ceiling, so a reader who finds a ceiling on the topic can always walk back
   * to what produced it. Published the other way round there is a window —
   * small, but real — in which the record carries a conclusion whose reasons
   * have not landed yet.
   *
   * Only NEW facts are written. The reader is monotonic, so a duplicate is
   * harmless, but republishing every account every window would add N messages
   * per window forever to say nothing.
   */
  /*
   * Claim the root FIRST, before anything else this pass writes.
   *
   * The claim is a race that only one tab can win, and the winner is decided by
   * consensus order — so publishing it after the weights and the ceiling would
   * widen the window in which two concurrently-running engines both see the
   * root as free. It cannot close that window entirely (see the ceiling
   * serialisation gap), but it should not be made wider for no reason.
   *
   * Only when the root is UNCLAIMED. `granted` with a seq means this tab
   * already holds it, and re-claiming would add a message per window forever to
   * say something the topic already says.
   */
  /*
   * Publish when the root is UNCLAIMED, or when the claim we already hold
   * predates the HCS-14 identifier.
   *
   * Without the second condition a tab that registered before HCS-14 existed
   * would never carry an identity — its root is already claimed, so the first
   * condition is false forever. Re-registering is safe by construction:
   * `registrationsFromMessages` updates `byTab` but leaves `byRoot` with the
   * FIRST claim, so an upgrade cannot steal a root from anyone.
   *
   * Self-terminating: once the published registration carries a `uaid`, the
   * replay sees it and this stops firing. No republish loop.
   */
  const heldRegistration = registrations.byTab.get(tabAccount)
  const needsIdentity = grant.status === 'granted' && heldRegistration?.uaid === undefined

  if (root && grant.status === 'granted' && (grant.seq === undefined || needsIdentity)) {
    const claimed = await publishRegistration({
      hedera,
      topicId: ceilingTopic,
      tab: tabAccount,
      window: currentWindow,
      root: root.root,
      starterCeiling: caps.starterCeiling,
      perCallCap: caps.perCall,
    })
    if (claimed) {
      console.log(
        `  registration    ${grant.seq === undefined ? 'claimed' : 'upgraded'} root ${claimed.root} · ` +
          `seq ${claimed.sequenceNumber} — one Starter Tab per funding root` +
          (needsIdentity ? ' · now carrying an HCS-14 identity' : ''),
      )
    }
  }

  const factSeqs = await publishFacts({
    hedera,
    topicId: ceilingTopic,
    tab: tabAccount,
    window: currentWindow,
    observed,
    known: remembered.byAccount,
  })
  if (factSeqs.length > 0) {
    console.log(
      `  facts           ${factSeqs.length} published · ` +
        factSeqs.map((f) => `${f.account} (${f.added}) seq ${f.sequenceNumber}`).join(', '),
    )
  } else {
    console.log(
      `  facts           none new — the topic already knows ${remembered.byAccount.size} account(s)`,
    )
  }

  if (result.weights.length > 0) {
    const weightSeqs = await publishWeights({
      hedera,
      topicId: ceilingTopic,
      tab: tabAccount,
      window: currentWindow,
      tokenId,
      modelId: MODEL_ID,
      weights: result.weights,
      revenue: revenue.revenueByCounterparty,
    })
    console.log(
      `  weights         ${weightSeqs.length} published · seq ${weightSeqs.map((w) => w.sequenceNumber).join(', ')}`,
    )
  }

  const published = await publishCeiling({
    hedera,
    topicId: ceilingTopic,
    tab: tabAccount,
    window: currentWindow,
    result: result.ceiling,
    // The IN-FORCE value, not the computed one. The gateway consumes this
    // message, so publishing the formula's result while a growth was held
    // would hand the fast path the very increase the asymmetry rule withholds.
    inForce: move.next.inForce,
    cause: move.action === 'shrink_now' ? 'graph_change' : 'clean_settlement',
    modelId: MODEL_ID,
    tokenId,
  })

  console.log(`
  published       seq ${published.sequenceNumber} on ${ceilingTopic}
  input hash      ${published.hash}
                  anyone can rerun @tab/scoring on the published inputs and get
                  this hash — that is the whole transparency claim, and it is
                  checkable without our database\n`)
}

console.log('\nTab · engine (the slow path)\n')
console.log(`  network         ${hedera.network}`)
console.log(`  tab             ${tabAccount}`)
console.log(`  token           ${tokenId}`)
console.log(`  ceiling topic   ${ceilingTopic}`)
console.log(`  trailing        ${TRAILING_WINDOWS} window(s)`)
console.log(
  `  mode            ${once ? 'single pass' : 'loop'}${publish ? ' · PUBLISHING' : ' · dry'}`,
)
if (demoMode && windowSeconds !== params.window.seconds) {
  console.log(
    `  window          ${windowSeconds}s  (DEMO_MODE override of params' ${params.window.seconds}s)`,
  )
}
console.log()
for (const line of describeParams()) console.log(`  ${line}`)

if (once) {
  await pass()
  hedera.close()
  process.exit(0)
}

let running = true
process.on('SIGINT', () => {
  console.log('\n  stopping after this pass\n')
  running = false
})

while (running) {
  try {
    await pass()
  } catch (error) {
    /*
     * Mirror Node lag is normal and is NOT an error.
     *
     * When it lags or pages out, the ceiling HOLDS at its last computed value
     * and the fast path is unaffected. Deliberately no retry loop waiting for
     * history to catch up: a retry loop here turns a routine indexer delay into
     * an engine that appears hung, and the fast path has a ceiling it can
     * enforce either way.
     */
    console.error(
      `  pass failed, holding the last ceiling: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  const nextBoundary = (windowOf(Math.floor(Date.now() / 1000), windowSeconds) + 1) * windowSeconds
  const sleepMs = Math.max(5_000, (nextBoundary - Math.floor(Date.now() / 1000)) * 1000)
  console.log(`  next pass in ${Math.round(sleepMs / 1000)}s (window boundary)\n`)
  await new Promise((resolve) => setTimeout(resolve, sleepMs))
}

hedera.close()
process.exit(0)
