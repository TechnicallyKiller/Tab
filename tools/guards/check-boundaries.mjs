#!/usr/bin/env node
/**
 * boundaries.json IS the architecture. This makes it enforceable.
 *
 * For every workspace package: assert each @tab/* dependency appears in that
 * package's `allow` list, nothing in `denyExplicit` appears, and third-party
 * deps honour externalAllowList / externalDenyList.
 *
 * The error quotes the offending package's `why`, because a boundary violation
 * is usually someone taking a reasonable shortcut past a constraint that is not
 * obvious from the import.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readWorkspace, report, ROOT } from './lib.mjs'

/**
 * Toolchain packages every workspace member needs to compile and test itself.
 * These are devDependencies only — they never enter the runtime graph, so a
 * "zero dependencies" rule is about what the package PULLS IN when imported,
 * not about whether it can be typechecked.
 */
const TOOLCHAIN = new Set([
  'typescript', '@types/node', 'vitest', 'tsup', 'tsx', '@biomejs/biome',
])

const spec = JSON.parse(readFileSync(join(ROOT, 'boundaries.json'), 'utf8'))
const SCOPE = `${spec.scope}/`
const failures = []

/** Tier index by short name, so we can name a violation as a tier inversion. */
const tierOf = new Map()
for (const [tier, members] of Object.entries(spec.tiers)) {
  const rank = Number(tier.split('-')[0])
  for (const m of members) tierOf.set(m, { rank, tier })
}

const declared = new Set(Object.keys(spec.packages))
const present = readWorkspace()

for (const { name, group, shortName, pkg } of present) {
  const rule = spec.packages[shortName]
  if (!rule) {
    failures.push({
      where: `${group}/${shortName}/package.json`,
      what: `${name} is not declared in boundaries.json`,
      why: 'Every workspace package needs an entry stating what it may depend on and why. ' +
        'Add one, or the package sits outside the architecture with nothing checking it.',
    })
    continue
  }

  const allow = new Set(rule.allow ?? [])
  const denyExplicit = new Set(rule.denyExplicit ?? [])
  const extAllow = rule.externalAllowList ? new Set(rule.externalAllowList) : null
  const extDeny = new Set(rule.externalDenyList ?? [])
  const denyAllExternal = extDeny.has('*')
  const where = `${group}/${shortName}/package.json`

  const runtimeDeps = Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies })
  const devDeps = Object.keys(pkg.devDependencies ?? {})
  const checked = [
    ...runtimeDeps.map((d) => ({ dep: d, runtime: true })),
    ...devDeps.map((d) => ({ dep: d, runtime: false })),
  ]

  for (const { dep, runtime } of checked) {
    if (!runtime && TOOLCHAIN.has(dep)) continue
    // Workspace dependency.
    if (dep.startsWith(SCOPE)) {
      const short = dep.slice(SCOPE.length)
      if (denyExplicit.has(short)) {
        failures.push({
          where,
          what: `${name} depends on ${dep} — explicitly denied`,
          why: rule.why,
        })
      } else if (!allow.has(short)) {
        const from = tierOf.get(shortName)
        const to = tierOf.get(short)
        const inversion =
          from && to && to.rank >= from.rank
            ? ` This is a tier inversion: ${shortName} is tier ${from.tier}, ${short} is tier ${to.tier}.`
            : ''
        failures.push({
          where,
          what: `${name} depends on ${dep}, which is not in its allow list`,
          why: `${rule.why}${inversion} Allowed: ${[...allow].join(', ') || '(nothing)'}.`,
        })
      }
      continue
    }

    // Third-party dependency. Types packages track their runtime peer.
    const base = dep.startsWith('@types/') ? dep.slice('@types/'.length).replace('__', '/') : dep
    if (extDeny.has(dep) || extDeny.has(base)) {
      failures.push({ where, what: `${name} depends on ${dep} — on its deny list`, why: rule.why })
    } else if (denyAllExternal && runtime) {
      failures.push({
        where,
        what: `${name} declares a runtime dependency on ${dep}, but this package must have none`,
        why: rule.why,
      })
    } else if (extAllow && runtime && !extAllow.has(dep) && !extAllow.has(base)) {
      failures.push({
        where,
        what: `${name} depends on ${dep}, which is not on its external allow list`,
        why: `${rule.why} Allowed: ${[...extAllow].join(', ')}.`,
      })
    }
  }
}

// A rule for a folder that exists but has no package.json yet is fine — that is
// the roster of work still to do. A rule with no folder at all is stale.
const scaffolded = new Set()
for (const group of ['apps', 'packages', 'agents', 'tools']) {
  try {
    for (const entry of readdirSync(join(ROOT, group))) scaffolded.add(entry)
  } catch {
    // Group not created yet.
  }
}
for (const short of declared) {
  if (!scaffolded.has(short)) {
    failures.push({
      where: 'boundaries.json',
      what: `${SCOPE}${short} is declared but no such folder exists`,
      why: 'A rule with nothing to constrain is stale. Remove it, or create the package.',
    })
  }
}

const written = present.length
const total = declared.size
const code = report(
  'boundaries',
  failures,
  `${written} of ${total} declared packages written, all within their allow lists`,
)
process.exit(code)
