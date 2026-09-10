import { BaseTool, type Context } from '@hashgraph/hedera-agent-kit'
import type { Tab } from '@tab/sdk'
import type { TabPluginConfig } from './context.ts'

/**
 * The shared base for every Tab tool.
 *
 * ## Every tool here stops after `coreAction`, including the one that spends
 *
 * The Agent Kit's mutation shape is: `coreAction` builds a `Transaction`,
 * `secondaryAction` signs and submits it. **Tab cannot use that shape, and the
 * reason is the whole product.** The agent holds no key, so it cannot build a
 * transaction anyone would accept — the gateway holds the float and signs on its
 * behalf, against a ceiling the agent earned.
 *
 * So `shouldSecondaryAction` returns `false` for every tool in this plugin. The
 * consequence is worth stating plainly: **an LLM driving these tools cannot
 * produce a Hedera transaction to sign, even if it tries.** The claim is
 * structural rather than promised, and it holds at the surface most likely to be
 * handed a key "just for this one call".
 *
 * The `client` argument is accepted and ignored throughout, and typed `unknown`
 * rather than `Client` — this package does not depend on the Hedera SDK at all.
 * It could: `boundaries.json` permits it. It does not need to, and a package
 * that cannot import a signer is a stronger statement than one that imports it
 * and promises not to use it.
 */
export abstract class TabBaseTool<TParams> extends BaseTool<TParams, TParams> {
  protected readonly tab: Tab
  protected readonly config: TabPluginConfig

  constructor(tab: Tab, config: TabPluginConfig) {
    super()
    this.tab = tab
    this.config = config
  }

  abstract override normalizeParams(params: TParams): Promise<TParams>
  abstract override coreAction(params: TParams, context: Context, client: unknown): Promise<string>

  /** No transaction to submit. See the class comment — this is the point. */
  override async shouldSecondaryAction(): Promise<boolean> {
    return false
  }

  override async secondaryAction(request: unknown): Promise<unknown> {
    return request
  }

  /**
   * Tagged with the tool method, so a failure in someone else's agent loop can
   * be traced back here rather than looking like the Agent Kit misbehaving.
   */
  override async handleError(error: unknown): Promise<{ raw: unknown; humanMessage: string }> {
    const message = error instanceof Error ? error.message : String(error)
    const tagged = `[${this.method}] ${message}`
    return { raw: { status: 'ERROR', error: tagged }, humanMessage: tagged }
  }
}
