/**
 * Report layout.
 *
 * **This appears on camera.** It reconciles to the cent in the demo, so the
 * output is a designed deliverable rather than console.log debugging — and it
 * is designed for one specific reader: a stranger deciding whether to believe
 * us. That reader needs to see the check, the inputs it used, and the verdict,
 * in that order, without knowing anything about this codebase.
 *
 * The rules it follows:
 *
 *  - Every claim shows the numbers it rests on. "PASS" alone is worth nothing;
 *    a stranger cannot audit a conclusion whose inputs are hidden.
 *  - A failure explains what would have to be true for it to pass, because the
 *    most likely cause of a red line is a stale snapshot, not fraud.
 *  - Nothing is coloured. It is read over a screen recording and through a
 *    terminal whose theme we do not control.
 */

export function heading(title: string, subtitle?: string): string {
  const line = '─'.repeat(Math.max(title.length, subtitle?.length ?? 0))
  return subtitle ? `\n${title}\n${subtitle}\n${line}` : `\n${title}\n${line}`
}

export function field(label: string, value: string, note?: string): string {
  return `  ${label.padEnd(18)}${value}${note ? `   ${note}` : ''}`
}

/** A claim and whether it held. Never just the verdict. */
export function claim(
  ok: boolean,
  statement: string,
  evidence: readonly string[] = [],
): string {
  const lines = [`  ${ok ? 'PASS' : 'FAIL'}  ${statement}`]
  for (const line of evidence) lines.push(`        ${line}`)
  return lines.join('\n')
}

export function verdict(
  ok: boolean,
  checked: number,
  whatFailed?: string,
  /**
   * Why a failure most likely happened, in THIS command's terms.
   *
   * Passed in rather than hardcoded because the two commands fail for
   * completely different reasons, and the first version printed verify-tab's
   * snapshot-staleness hint under a verify-ceiling failure — sending a reader
   * to check balance timestamps for a problem that has nothing to do with
   * balances.
   */
  guidance: readonly string[] = [],
): string {
  if (ok) {
    return `
  ${checked} check(s), all passed.

  Nothing here relied on our database, our cache, our gateway, or our
  cooperation. Every input came from the public Hedera Mirror Node and the
  public HCS topics named above. Re-run it yourself.
`
  }
  return `
  ${checked} check(s), and this did not pass:

    ${whatFailed}
${guidance.length > 0 ? `\n${guidance.map((l) => `  ${l}`).join('\n')}\n` : ''}`
}

/** Why a verify-tab failure is usually not fraud. */
export const TAB_GUIDANCE = [
  'Before concluding the ledger is wrong, check the snapshot timestamps above.',
  'Mirror Node account balances are SNAPSHOTS — the timestamp is the last',
  'activity that touched them — so receipts replayed past that point look like',
  'a discrepancy on a perfectly reconciled ledger. That is the most common',
  'cause of a red line here, and it is a measurement error, not a money error.',
]

/**
 * How to read a verify-ceiling failure, which has two very different kinds.
 *
 * Keeping them apart is the whole value of this command. A hash mismatch says
 * the published record is not what it claims. A hash MATCH with a different
 * recomputed number says the record is authentic and the code that produced it
 * has since changed — an integrity problem in our release process, not in the
 * ledger, and the opposite conclusion about whether to trust the topic.
 */
export const CEILING_GUIDANCE = [
  'Two kinds of failure, and they mean opposite things:',
  '',
  '  HASH MISMATCH — the published inputs do not hash to the published hash.',
  '    The record contradicts itself. Suspect the publisher.',
  '',
  '  HASH MATCHES but the recomputed ceiling or binding differs — the record',
  '    is authentic and today\'s code no longer reproduces it. The formula or',
  '    the parameter set changed after publication WITHOUT a MODEL_VERSION',
  '    bump. That is a release-process failure, not a ledger failure, and the',
  '    fix is to bump the version and never edit a published generation.',
]
