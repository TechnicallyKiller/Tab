# tools/ — operational scripts

Not services and not libraries. Each runs to completion and exits.

| Tool | Runs | Purpose |
|---|---|---|
| [`probes`](probes/) | first, before anything else | Phase 0. Answers four questions that could invalidate the plan |
| [`bootstrap`](bootstrap/) | once per environment | create topics, associate USDC, fund hot float |
| [`verify`](verify/) | on camera | **the trust artifact.** `verify-tab` and `verify-ceiling` |
| [`guards`](guards/) | every CI run | the architectural bans, mechanised |

## `verify` and `guards` are product, not tooling

`tools/verify` is what replaces a smart contract. The argument for having no contract is that HCS
records better *and anyone can check it*. `verify-tab` and `verify-ceiling` are the "anyone can
check it" half — without them the argument is a slogan.

`tools/guards` is what makes the README's architectural rules true rather than aspirational. A rule
in prose survives until the first tired commit; a rule in CI survives the project.
