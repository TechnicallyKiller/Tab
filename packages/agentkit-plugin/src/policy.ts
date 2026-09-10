import {
  AbstractPolicy,
  type PostParamsNormalizationParams,
  type PreToolExecutionParams,
} from '@hashgraph/hedera-agent-kit'
import { format, type MicroUsdc, usdc } from '@tab/money'
import { TAB_SPEND_TOOL } from './tools/spend.ts'

/**
 * A spend cap enforced at the TOOL boundary, before the gateway is called.
 *
 * ## Why this exists when the gateway already refuses
 *
 * It is not the defence. The gateway's per-call cap and ceiling are, and they
 * live where the agent cannot reach them — an agent that talks to the rail over
 * HTTP cannot raise a limit enforced inside it. This policy is a **second, local
 * limit that the operator embedding the agent controls**, and it answers a
 * different question: not "may this tab afford it" but "did I intend this agent
 * to spend that much per call, whatever its tab allows".
 *
 * The two differ in a way that matters. A tab's ceiling grows as the agent earns;
 * an operator wiring a summarisation agent into a customer workflow may still
 * want it never to spend more than a cent a call, and to find out immediately if
 * the model starts trying. Blocking here means the request never leaves the
 * process, so it costs nothing and shows up in the agent's own trace rather than
 * as a refusal receipt on a public topic.
 *
 * ## Stage 3, not stage 1
 *
 * `shouldBlockPostParamsNormalization` runs after defaults are resolved, so the
 * value checked is the one the tool will actually use. Checking raw input would
 * miss anything filled in during normalisation — and a limit that can be
 * sidestepped by omitting a field is not a limit.
 */
export class TabSpendCapPolicy extends AbstractPolicy {
  name = 'Tab spend cap'
  description =
    'Blocks a tab spend whose cap exceeds an operator-set per-call limit, before the gateway ' +
    'is called. Local to this agent, and separate from the ceiling the rail enforces.'
  relevantTools = [TAB_SPEND_TOOL]

  private readonly maxPerCall: MicroUsdc

  /**
   * @param maxPerCall Decimal amount, e.g. `'0.010000'` or `'0.01'`.
   *
   * Deliberately more forgiving than the tool's own schema, which demands
   * exactly six decimals. The tool's `max` comes from an LLM, where `"0.04"`
   * could be a model dropping digits and strictness removes the guess. This
   * comes from a human writing agent wiring, where `'0.01'` is unambiguous —
   * rejecting it would fail correct config for no safety gain.
   */
  constructor(maxPerCall: string) {
    super()
    // Parsed once, at construction, so a malformed limit fails when the agent is
    // WIRED rather than on the first spend it tries to block.
    this.maxPerCall = usdc(maxPerCall)
  }

  protected override shouldBlockPostParamsNormalization(
    params: PostParamsNormalizationParams,
    method: string,
  ): boolean {
    if (!this.relevantTools.includes(method)) return false

    const max = (params.normalisedParams as { max?: unknown }).max
    if (typeof max !== 'string') {
      /*
       * Unreadable input BLOCKS, rather than passing.
       *
       * The Zod schema should have caught this, so reaching here means something
       * upstream changed. A cap policy that waves through what it cannot parse
       * is not a cap — failing closed costs one refused call and failing open
       * costs whatever the model asked for.
       */
      throw new Error(
        `[tab-spend-cap] Refusing ${method}: could not read a spend cap from the parameters, ` +
          'so the operator limit cannot be checked.',
      )
    }

    let requested: MicroUsdc
    try {
      requested = usdc(max)
    } catch {
      throw new Error(
        `[tab-spend-cap] Refusing ${method}: "${max}" is not a valid amount ` +
          '(expected six decimal places, e.g. "0.040000").',
      )
    }

    if (requested > this.maxPerCall) {
      // Thrown rather than returned, so the agent sees WHY and can pick a
      // smaller amount instead of retrying the same one.
      throw new Error(
        `[tab-spend-cap] Refusing ${method}: requested ${format(requested)} exceeds the ` +
          `operator's per-call limit of ${format(this.maxPerCall)}. This limit is set where the ` +
          'agent was wired, and is separate from the ceiling the rail enforces.',
      )
    }
    return false
  }

  /**
   * Read tools are never blocked, and that is deliberate.
   *
   * An agent refused a spend needs `tab_ceiling` and `tab_counterparties` to
   * understand why and choose different work. A policy that blocked reads
   * alongside writes would leave it unable to do anything but retry.
   */
  protected override shouldBlockPreToolExecution(
    _params: PreToolExecutionParams,
    _method: string,
  ): boolean {
    return false
  }
}
