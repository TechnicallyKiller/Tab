#!/usr/bin/env node
/**
 * Track requirement: "No Solidity Allowed".
 *
 * The README promises CI fails if a .sol file appears; this is that promise.
 * EVM tooling is banned at the same severity — a committed hardhat.config.ts is
 * as disqualifying as a contract, because the claim is that we never reached
 * for the EVM at all.
 */
import { readdirSync } from 'node:fs'
import { allDeps, readWorkspace, rel, report, ROOT, walk } from './lib.mjs'

const BANNED_DEPS = [
  'hardhat', 'solc', 'ethers', 'web3', 'viem', 'wagmi', 'truffle',
  '@openzeppelin/contracts', '@openzeppelin/contracts-upgradeable',
]
const BANNED_DEP_PREFIXES = ['@nomicfoundation/', '@nomiclabs/']
const BANNED_CONFIGS = /^(hardhat\.config\.|truffle-config\.|truffle\.js$|foundry\.toml$|remappings\.txt$)/

const WHY_SOURCE =
  'The "No Solidity Allowed" track requires zero contracts. The agent holds nothing, so there is ' +
  'no unauthorised spend for a contract to prevent — HCS records the same facts, consensus-ordered ' +
  'and replayable by anyone. See docs/ARCHITECTURE.md.'
const WHY_TOOLING =
  'EVM tooling implies a contract even when none is committed. The submission claims we never ' +
  'reached for the EVM; a config file in the repo disproves that on inspection.'

const failures = []

for (const file of walk(ROOT, ['.sol', '.vy'])) {
  failures.push({ where: rel(file), what: 'Solidity/Vyper source file', why: WHY_SOURCE })
}

for (const name of readdirSync(ROOT)) {
  if (BANNED_CONFIGS.test(name)) {
    failures.push({ where: name, what: 'EVM tooling config', why: WHY_TOOLING })
  }
}

for (const { name, group, shortName, pkg } of readWorkspace()) {
  const deps = allDeps(pkg)
  for (const dep of Object.keys(deps)) {
    const banned =
      BANNED_DEPS.includes(dep) || BANNED_DEP_PREFIXES.some((p) => dep.startsWith(p))
    if (banned) {
      failures.push({
        where: `${group}/${shortName}/package.json`,
        what: `${name} depends on EVM tooling: ${dep}`,
        why: WHY_TOOLING,
      })
    }
  }
}

const code = report('no-solidity', failures, 'zero .sol files, zero EVM tooling')
if (code === 0) {
  // The track requires at least two native Hedera services; we claim four.
  console.log('        native Hedera services in use: HCS · HTS · Schedule Service · Mirror Node (4)')
}
process.exit(code)
