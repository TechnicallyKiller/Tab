/**
 * Refusal codes.
 *
 * These are pinned by what the UI already renders — `apps/web/src/lib/mock/docs.ts`
 * documents exactly these six, and the Refusals view shows the rule that fired.
 * Changing one means changing the docs page, the console and the receipt topic
 * together, so treat this list as a published interface.
 *
 * A refusal is NOT an error. It is the product demonstrating that underwriting
 * works, which is why it gets a first-class message on the receipt topic rather
 * than a log line.
 */
export const REFUSAL_CODES = [
  'PER_CALL_CAP',
  'WINDOW_CAP',
  'CEILING_EXCEEDED',
  'CONTROL_CLUSTER',
  'SELLER_NOT_ALLOWLISTED',
  'TAB_FROZEN',
] as const

export type RefusalCode = (typeof REFUSAL_CODES)[number]

/** What the agent should do next. Handling refusal is its main job. */
export const REFUSAL_GUIDANCE: Record<RefusalCode, string> = {
  PER_CALL_CAP: 'Split the work, or quote first and wait for a ceiling raise.',
  WINDOW_CAP: 'Retry after the window tick. The countdown is in the response.',
  CEILING_EXCEEDED: 'Earn first, or wait for settlement to clear outstanding.',
  CONTROL_CLUSTER: 'Buy from an independent seller. Do not retry the same one.',
  SELLER_NOT_ALLOWLISTED: 'Graduate the tab with one clean settlement, then retry.',
  TAB_FROZEN: 'Stop spending. Surface the freeze to the operator.',
}

/** True when retrying the same request later could succeed. */
export function isRetryable(code: RefusalCode): boolean {
  return code === 'WINDOW_CAP' || code === 'CEILING_EXCEEDED'
}
