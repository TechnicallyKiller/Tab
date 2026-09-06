/**
 * @tab/testkit — fixtures and fakes. Dev-only; never a runtime dependency.
 *
 * The fake seller is the important part: stock `@x402/hedera`, knows nothing
 * about Tab, and is what keeps "works with any unmodified x402 endpoint"
 * honest. Run it with `pnpm seller`.
 *
 * It lives here rather than in agents/honest-agent because a seller needs a key
 * and the agent must not have one — boundaries.json bans the Hedera SDK from
 * honest-agent so that claim rests on a check, not on our word.
 */
export {}
