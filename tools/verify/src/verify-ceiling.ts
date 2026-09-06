/**
 * verify-ceiling — recompute a published ceiling and check the hash.
 *
 *   pnpm verify-ceiling            every published ceiling
 *   pnpm verify-ceiling --seq 3    just sequence number 3
 *
 * Takes a ceiling message off the topic, feeds its PUBLISHED inputs back
 * through the real `@tab/scoring` under the frozen parameter set the message
 * names, and compares both the number and the canonical hash.
 *
 * ## Why a reimplementation here would be worthless
 *
 * It would prove that two copies of the formula agree, not that the published
 * ceiling is right. So this imports `computeCeiling` itself — which is why
 * `@tab/scoring` is a pure package with no database access rather than a
 * directory inside `apps/engine`. If scoring could read our Postgres, this
 * command could not run on a stranger's machine and the whole claim would be
 * decoration.
 *
 * ## Why parameter sets are frozen
 *
 * A ceiling published in week one must still verify in week three. The message
 * carries `model`, this resolves it through `paramsForVersion`, and that
 * function throws on an unknown version rather than falling back to the current
 * set — verifying a v1 ceiling against v2 numbers would report a mismatch that
 * looks exactly like fraud and is only a lookup bug.
 */
import { configureGlobalHttp, MirrorClient } from '@tab/mirror'
import { format } from '@tab/money'
import { readCeilings } from './replay.ts'
// The tested logic, so the code that runs is the code the tests cover.
import { recheck } from './recheck.ts'
import { CEILING_GUIDANCE, claim, field, heading, verdict } from './report.ts'

configureGlobalHttp({ connectTimeoutMs: 60_000 })

const ceilingTopic = process.env['TOPIC_CEILINGS']
if (!ceilingTopic || ceilingTopic.includes('xxxxx')) {
  throw new Error('TOPIC_CEILINGS is required. It is the only input this command needs.')
}
/*
 * Narrowed rather than cast.
 *
 * An unrecognised network name would otherwise reach MirrorClient and produce
 * requests against a nonexistent host, which surfaces as a timeout — an
 * unhelpful failure for a stranger whose only misstep was a typo.
 */
const NETWORKS = ['testnet', 'mainnet', 'previewnet'] as const
const requested = process.env['HEDERA_NETWORK'] ?? 'testnet'
const network = NETWORKS.find((n) => n === requested)
if (!network) {
  throw new Error(`HEDERA_NETWORK "${requested}" is not one of ${NETWORKS.join(', ')}`)
}
const seqArg = process.argv.find((a) => a.startsWith('--seq'))
const wanted = seqArg
  ? Number(seqArg.includes('=') ? seqArg.split('=')[1] : process.argv[process.argv.indexOf(seqArg) + 1])
  : undefined

const mirror = new MirrorClient({ network, timeoutMs: 45_000, maxRetries: 4 })

console.log(heading('verify-ceiling', 'recompute from published inputs, compare hashes'))
console.log(field('network', network))
console.log(field('ceiling topic', ceilingTopic))

const all = await readCeilings(mirror, ceilingTopic)
const targets = wanted === undefined ? all : all.filter((c) => c.sequenceNumber === wanted)

console.log(field('published', `${all.length} ceiling(s)`, wanted !== undefined ? `verifying seq ${wanted}` : 'verifying all'))

if (targets.length === 0) {
  console.log(
    `\n  Nothing to verify${wanted !== undefined ? ` — no ceiling at sequence ${wanted}` : ' — the topic is empty'}.\n`,
  )
  process.exit(wanted !== undefined ? 1 : 0)
}

console.log(heading('checks'))

const results: { ok: boolean; text: string }[] = []

for (const published of targets) {
  const label = `seq ${published.sequenceNumber} · tab ${published.tab} · window ${published.window}`
  try {
    const r = await recheck(published)

    /*
     * Name the KIND of failure, not just that there was one.
     *
     * A matching hash with a differing recomputation is a completely different
     * finding from a hash mismatch, and a reader who cannot tell them apart
     * cannot act on either.
     */
    const kind =
      r.failure === 'hash_mismatch'
        ? 'HASH MISMATCH — the published inputs do not hash to the published hash. ' +
          'The record contradicts itself.'
        : r.failure === 'not_reproducible'
          ? 'AUTHENTIC BUT NOT REPRODUCIBLE — the hash matches, so the record is genuine; ' +
            'today’s formula or parameter set no longer produces it, which means one of them ' +
            'changed after publication without a MODEL_VERSION bump'
          : undefined

    results.push({
      ok: r.ok,
      text: claim(r.ok, label, [
        ...(kind ? [kind, ''] : []),
        `model            ${published.model}  (frozen parameter set v${r.parameterVersion})`,
        `published hash   ${published.hash}`,
        `recomputed hash  ${r.rehash}${r.hashOk ? '' : '   MISMATCH'}`,
        `published ceil   ${format(published.ceiling)}${
          r.heldBack
            ? `  (in force; the formula gave ${format(r.claimed)}, held by the asymmetry rule)`
            : ''
        }`,
        `recomputed       ${format(r.recomputed)}${r.valueOk ? '' : '   MISMATCH'}`,
        `binding          ${published.binding} vs ${r.recomputedBinding}${r.bindingOk ? '' : '   MISMATCH'}`,
        `inputs           rev ${published.inputs['rev']} · tier ${published.inputs['tier']} · mult ${published.inputs['mult']} · ramp ${published.inputs['ramp']} · def ${published.inputs['def'] ?? false}`,
      ]),
    })
  } catch (error) {
    /*
     * A ceiling that cannot be verified is a FAILURE, not a skip.
     *
     * An unknown parameter version or a malformed input record means the
     * published claim is unverifiable, and "unverifiable" must not read as
     * "fine" in the output of the one tool whose job is proving the numbers.
     */
    results.push({
      ok: false,
      text: claim(false, label, [
        `could not verify: ${error instanceof Error ? error.message : String(error)}`,
        'An unverifiable ceiling is a failure, not a skip.',
      ]),
    })
  }
}

for (const r of results) console.log(r.text)

const failed = results.find((r) => !r.ok)
console.log(verdict(!failed, results.length, failed?.text.trim().split('\n')[0], CEILING_GUIDANCE))
process.exit(failed ? 1 : 0)
