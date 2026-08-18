# @tab/guards

**The architectural bans, mechanised. Runs in CI on every push.**

The README states several rules as prose. Prose rules survive until the first tired commit at 2am
during a hackathon. These four scripts are the same rules, enforced.

```
pnpm guard            # all four
pnpm guard:solidity   pnpm guard:sdk   pnpm guard:boundaries   pnpm guard:money
```

Each is a standalone Node script under 100 lines with no dependencies. **They must not need
`pnpm install` to run** — `guard:solidity` in particular is a track requirement and should work on
a bare clone.

---

## `guard:solidity` — no Solidity anywhere

The "No Solidity Allowed" track requires it, and the README promises CI fails if a `.sol` file
appears.

- Reject any `.sol` or `.vy` file anywhere in the repo.
- Reject `hardhat.config.*`, `foundry.toml`, `truffle-config.js`.
- Reject these dependencies in any `package.json`: `hardhat`, `solc`, `ethers`, `web3`, `viem`,
  `wagmi`, `@openzeppelin/contracts`, `truffle`, `@nomicfoundation/*`.

Print the count of native Hedera services in use — HCS, HTS, Schedule Service, Mirror Node — since
the track requires at least two and we claim four.

## `guard:sdk` — exactly one Hedera SDK

`@hashgraph/sdk` was renamed `@hiero-ledger/sdk`. Both still publish and neither is deprecated on
npm, so nothing stops you installing both.

- Reject `@hashgraph/sdk` in any `dependencies`, `devDependencies` or `peerDependencies`.
- Reject `from '@hashgraph/sdk'` or `require('@hashgraph/sdk')` in any source file.
- Assert exactly one resolved version of `@hiero-ledger/sdk` in the lockfile.

**The error message must explain why**, because this looks pedantic until it bites: two copies means
two `Transaction` classes, `instanceof` returns false across the boundary, and a partially-signed
x402 transfer fails to serialize at request time — not at build time, and not in a unit test that
stays inside one copy. See [ADR-0002](../../docs/adr/0002-single-hedera-sdk.md).

## `guard:boundaries` — the dependency tiers

Read [`boundaries.json`](../../boundaries.json). For every workspace package, assert that every
`@tab/*` dependency appears in that package's `allow` list, and that nothing in `denyExplicit`
appears. Honour `externalAllowList` / `externalDenyList` for third-party deps.

The three bans this enforces, each of which is a README claim:

| Ban | README calls it | Mechanism |
|---|---|---|
| fast path never touches Mirror Node | "a hard rule, not a performance target" | `fastpath` cannot declare `mirror`, `db`, `hedera`, `x402`, `graph`, `scoring` |
| ceiling independently recomputable | `verify-ceiling` ships for exactly this | `verify` cannot declare `db`, `cache`, `fastpath`, `sdk` |
| agent holds no key | the demo's central claim | `honest-agent` cannot declare `@hiero-ledger/sdk` |

**The error message should quote the `why` field** from `boundaries.json` for the offending
package. A boundary violation is usually someone taking a reasonable shortcut, and the reason it is
banned is not obvious from the import.

## `guard:money` — no floating-point money

`verify-tab` claims the ledger reconciles to the cent. In `money`, `ledger`, `scoring`, `fastpath`,
`gateway`, `settlement` and `engine`, reject: `parseFloat`, `Number.parseFloat`, `toFixed`,
`* 1e6`, `/ 1e6`.

Exempt files matching `format|display|present` inside `@tab/money`. Allow a per-line opt-out via
`// allow-float` **with a reason on the same line**. See
[ADR-0006](../../docs/adr/0006-money-as-bigint.md).

---

## Add a fifth: `guard:secrets`

Reject anything matching a Hedera DER private key (`302e...`, `302a...`) in tracked files, and any
`.env` that is not `.env.example`. Cheap to write, and it prevents the single worst possible
outcome of a public hackathon repo.
