#!/usr/bin/env node
/**
 * Exactly one Hedera SDK in the graph.
 *
 * @hashgraph/sdk was transferred to Hiero and republished as @hiero-ledger/sdk.
 * Both scopes still publish and neither is deprecated on npm, so nothing stops
 * you installing both — and both of our load-bearing dependencies (@x402/hedera,
 * @hashgraph/hedera-agent-kit v4) already resolve the Hiero scope.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { allDeps, readWorkspace, rel, report, ROOT, walk } from './lib.mjs'

const WHY =
  'Two copies of the SDK means two distinct Transaction, AccountId and PrivateKey classes. ' +
  '`instanceof` returns false across the boundary, so a partially-signed x402 transfer handed to ' +
  '@x402/hedera fails to serialize — at request time, with an unhelpful error, not at build time ' +
  'and not in a unit test that stays inside one copy. Use @hiero-ledger/sdk. See ADR-0002.'

const failures = []

for (const { name, group, shortName, pkg, dir } of readWorkspace()) {
  if (allDeps(pkg)['@hashgraph/sdk']) {
    failures.push({
      where: `${group}/${shortName}/package.json`,
      what: `${name} declares @hashgraph/sdk`,
      why: WHY,
    })
  }
  for (const file of walk(join(dir, 'src'), ['.ts', '.tsx', '.mts', '.mjs', '.js'])) {
    const src = readFileSync(file, 'utf8')
    if (/from\s+['"]@hashgraph\/sdk['"]|require\(\s*['"]@hashgraph\/sdk['"]\s*\)/.test(src)) {
      failures.push({ where: rel(file), what: 'imports @hashgraph/sdk', why: WHY })
    }
  }
}

/**
 * Count PHYSICAL copies, which is the thing that actually breaks `instanceof`.
 *
 * When node_modules exists this is authoritative: pnpm materialises one store
 * directory per (version, peer-resolution) pair, and two directories means two
 * module instances. Falling back to the lockfile covers a bare clone.
 *
 * pnpm writes peer context as a suffix — `2.87.0(bn.js@5.2.3)` in the lockfile,
 * `2.87.0_bn.js@5.2.3` on disk. That is still ONE version; strip it before
 * comparing or every install looks like a duplicate.
 */
const stripPeers = (v) => v.replace(/[(_].*$/, '')

try {
  const storeDirs = readdirSync(join(ROOT, 'node_modules/.pnpm')).filter((d) =>
    d.startsWith('@hiero-ledger+sdk@'),
  )
  if (storeDirs.length > 1) {
    failures.push({
      where: 'node_modules/.pnpm',
      what: `${storeDirs.length} physical copies of @hiero-ledger/sdk: ${storeDirs.join(', ')}`,
      why: `${WHY} Pin it under \`overrides\` in pnpm-workspace.yaml.`,
    })
  }
} catch {
  // No node_modules — fall back to reading the lockfile.
  try {
    const lock = readFileSync(join(ROOT, 'pnpm-lock.yaml'), 'utf8')
    const versions = new Set(
      [...lock.matchAll(/^\s*'?@hiero-ledger\/sdk'?@([^:'\s]+)/gm)].map((m) => stripPeers(m[1])),
    )
    if (versions.size > 1) {
      failures.push({
        where: 'pnpm-lock.yaml',
        what: `@hiero-ledger/sdk resolved to ${versions.size} versions: ${[...versions].join(', ')}`,
        why: `${WHY} Pin it under \`overrides\` in pnpm-workspace.yaml.`,
      })
    }
  } catch {
    // No lockfile either. Nothing to assert.
  }
}

process.exit(report('single-hedera-sdk', failures, 'only @hiero-ledger/sdk in the graph'))
