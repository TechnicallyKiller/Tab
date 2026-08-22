/**
 * Shared helpers for the guards. Zero dependencies on purpose: these must run
 * on a bare clone with no `pnpm install`, because guard:solidity is a track
 * requirement and CI runs the guards before it installs anything.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

export const ROOT = resolve(import.meta.dirname, '../..')
const WORKSPACE_DIRS = ['apps', 'packages', 'agents', 'tools']
const SKIP_DIRS = new Set([
  'node_modules', 'dist', '.next', '.turbo', 'coverage', '.git',
  'drizzle', '.pnpm-store', 'surface-selection-decision',
])

/** Every workspace package: { name, shortName, group, dir, pkg }. */
export function readWorkspace() {
  const out = []
  for (const group of WORKSPACE_DIRS) {
    let entries
    try {
      entries = readdirSync(join(ROOT, group))
    } catch {
      continue
    }
    for (const entry of entries) {
      const dir = join(ROOT, group, entry)
      if (!statSync(dir).isDirectory()) continue
      let pkg
      try {
        pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
      } catch {
        continue // A folder with only a README is a package not written yet.
      }
      out.push({ name: pkg.name ?? entry, shortName: entry, group, dir, pkg })
    }
  }
  return out
}

/** Every dependency a package declares, across all three fields. */
export function allDeps(pkg) {
  return { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies }
}

/** Recursively walk source files, skipping build output and vendored code. */
export function* walk(dir, exts) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full, exts)
    else if (!exts || exts.some((e) => entry.name.endsWith(e))) yield full
  }
}

export function rel(path) {
  return relative(ROOT, path)
}

/**
 * Prints a result and returns an exit code. Failures carry a `why` so the
 * message explains the rule rather than just naming it — most violations are
 * someone taking a reasonable shortcut past a non-obvious constraint.
 */
export function report(name, failures, passMessage) {
  if (failures.length === 0) {
    console.log(`  PASS  ${name} — ${passMessage}`)
    return 0
  }
  console.error(`  FAIL  ${name} — ${failures.length} violation${failures.length === 1 ? '' : 's'}`)
  for (const f of failures) {
    console.error(`\n    ${f.where}`)
    console.error(`      ${f.what}`)
    if (f.why) {
      for (const line of wrap(f.why, 92)) console.error(`      ${line}`)
    }
  }
  console.error('')
  return 1
}

function wrap(text, width) {
  const words = String(text).replace(/\s+/g, ' ').trim().split(' ')
  const lines = []
  let line = ''
  for (const w of words) {
    if (line.length + w.length + 1 > width) {
      lines.push(line)
      line = w
    } else {
      line = line ? `${line} ${w}` : w
    }
  }
  if (line) lines.push(line)
  return lines
}
