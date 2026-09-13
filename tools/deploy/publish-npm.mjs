#!/usr/bin/env node
/**
 * Publish the public packages to npm under a scope we actually own.
 *
 *   node tools/deploy/publish-npm.mjs            stage only, then stop
 *   node tools/deploy/publish-npm.mjs --publish  stage and publish
 *
 * ## Why the names are rewritten instead of changed at source
 *
 * The workspace is `@tab/*` and the `tab` org on npm belongs to someone else —
 * `npm org ls tab` reports a user named `tab` as its owner, and a publish gets
 * E404 "you do not have permission". Renaming at source would touch 169 files
 * for a packaging problem.
 *
 * It is not enough to rename the package.json either. tsc emits the import
 * specifiers verbatim, so `packages/sdk/dist/index.js` really contains
 *
 *     export { ... } from "@tab/money"
 *
 * which would 404 for anyone installing it. So every emitted .js, .d.ts and
 * .map is rewritten alongside the manifest, and the staged copy is what gets
 * packed. The source tree is never modified.
 *
 * ## Why it stages into a temp directory
 *
 * Publishing from a rewritten working tree would leave the repo in a state
 * where `@tab/*` imports resolve to names that only exist on npm — fine until
 * someone runs the tests and gets a resolution error they did not cause.
 */

import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const SCOPE = process.env.NPM_SCOPE ?? '@0xdivyanshh'
const PACKAGES = ['money', 'params', 'protocol', 'sdk', 'mcp']
const PUBLISH = process.argv.includes('--publish')

/** `@tab/money` -> `@0xdivyanshh/tab-money`. One rule, applied everywhere. */
const rename = (name) => name.replace(/^@tab\/(.+)$/, `${SCOPE}/tab-$1`)

const root = resolve(import.meta.dirname, '../..')

/**
 * pnpm-only protocols, resolved to something npm understands.
 *
 * `workspace:*` and `catalog:` are pnpm features. npm rejects the second
 * outright —
 *
 *     npm error Unsupported URL Type "catalog:": catalog:
 *
 * — and the first would silently resolve to nothing. The first publish shipped
 * `zod: "catalog:"` verbatim: npm ACCEPTED the package, the registry served it,
 * and every `npm install` of it failed. Publishing succeeded and the package
 * was unusable, which is the worst shape a release can take.
 *
 * The catalog is the workspace's single source of version truth, so it is read
 * rather than duplicated here.
 */
const catalog = (() => {
  const text = readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8')
  const block = text.split(/^catalog:\s*$/m)[1] ?? ''
  const entries = {}
  for (const line of block.split('\n')) {
    if (line.trim() === '') continue // the split leaves a blank first line
    // The block ends at the first line that is not indented — the next
    // top-level YAML key. Breaking on "not an entry" instead stopped on that
    // blank line and read an empty catalog, so every `catalog:` range came
    // back unresolved.
    if (!/^\s/.test(line)) break
    const m = /^\s+"?([^":\s]+)"?:\s*(\S+)\s*$/.exec(line)
    if (m) entries[m[1]] = m[2]
  }
  return entries
})()

function resolveRange(name, range, manifest) {
  // Our own packages pin to the version being published in this same run.
  if (name.startsWith('@tab/')) return manifest.version
  if (range === 'catalog:' || String(range).startsWith('catalog:')) {
    const resolved = catalog[name]
    if (!resolved) throw new Error(`${name} is "catalog:" but absent from pnpm-workspace.yaml`)
    return resolved
  }
  if (String(range).startsWith('workspace:')) {
    throw new Error(`${name} uses workspace: but is not a @tab package — cannot resolve`)
  }
  return range
}

const staging = mkdtempSync(join(tmpdir(), 'tab-npm-'))
console.log(`\npublishing as ${SCOPE}/tab-*\n  staging ${staging}\n`)

/** Rewrite every `@tab/x` specifier in a text file, in place. */
function rewriteFile(path) {
  const before = readFileSync(path, 'utf8')
  const after = before.replace(/@tab\/([a-z-]+)/g, (m) => rename(m))
  if (after !== before) writeFileSync(path, after, 'utf8')
}

function walk(dir, fn) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) walk(path, fn)
    else fn(path)
  }
}

for (const pkg of PACKAGES) {
  const src = join(root, 'packages', pkg)
  const out = join(staging, pkg)

  cpSync(join(src, 'dist'), join(out, 'dist'), { recursive: true })
  cpSync(join(src, 'README.md'), join(out, 'README.md'))

  // The emitted code, not just the manifest — see the note at the top.
  walk(join(out, 'dist'), (p) => {
    if (/\.(js|d\.ts|map)$/.test(p)) rewriteFile(p)
  })

  /*
   * The README too, because npm renders it as the package page.
   *
   * Left alone it tells a reader to `import { createTab } from '@tab/sdk'` —
   * a specifier that resolves for us and 404s for them. A package page that
   * documents a name nobody can install is the same class of mistake as the
   * mock docs that described an API nobody had written.
   */
  rewriteFile(join(out, 'README.md'))

  const manifest = JSON.parse(readFileSync(join(src, 'package.json'), 'utf8'))
  manifest.name = rename(manifest.name)

  /*
   * `workspace:*` is a pnpm protocol and means nothing to npm. Each dependency
   * is renamed and pinned to the version being published in this same run, so
   * an install resolves to the set that was built together rather than to
   * whatever floats to the top later.
   */
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
    const deps = manifest[field]
    if (!deps) continue
    manifest[field] = Object.fromEntries(
      Object.entries(deps).map(([name, range]) => [
        rename(name),
        resolveRange(name, range, manifest),
      ]),
    )
  }

  // devDependencies are build-time only and just add noise to an install.
  delete manifest.devDependencies
  delete manifest.scripts

  /*
   * `bin` paths must not start with `./`.
   *
   * npm silently STRIPPED the entry — "bin[tab-mcp] script name ./dist/stdio.js
   * was invalid and removed" — which would have published an MCP server that
   * `npx` could not launch, with nothing but a warning to say so.
   */
  if (manifest.bin) {
    manifest.bin = Object.fromEntries(
      Object.entries(manifest.bin).map(([k, v]) => [k, String(v).replace(/^\.\//, '')]),
    )
  }

  writeFileSync(join(out, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(
    `  ${manifest.name.padEnd(28)} ${Object.keys(manifest.dependencies ?? {}).length} dep(s)`,
  )
}

if (!PUBLISH) {
  console.log(`\n  staged only. inspect ${staging}, then re-run with --publish\n`)
  process.exit(0)
}

console.log()
for (const pkg of PACKAGES) {
  const out = join(staging, pkg)
  const name = JSON.parse(readFileSync(join(out, 'package.json'), 'utf8')).name
  /*
   * Skip what is already on the registry at this version.
   *
   * Publishing five packages in a row means any failure leaves a partial set,
   * and the obvious response — run it again — used to die immediately on the
   * first package with EPUBLISHCONFLICT. Re-running should finish the job, not
   * refuse to start it.
   */
  const version = JSON.parse(readFileSync(join(out, 'package.json'), 'utf8')).version
  try {
    execFileSync('npm', ['view', `${name}@${version}`, 'version'], { stdio: 'pipe' })
    console.log(`  ${name}@${version} already published — skipped`)
    continue
  } catch {
    // Not on the registry, which is the normal case. Fall through and publish.
  }

  console.log(`\n  ── publishing ${name} ──`)
  try {
    /*
     * `inherit`, not `pipe`.
     *
     * With 2FA on, npm prints a browser URL and waits on the TERMINAL for the
     * handshake. Piped, that prompt goes nowhere — the publish fails, and the
     * only captured output is the tarball listing, which says nothing about
     * why. Handing npm the terminal is the whole fix.
     */
    execFileSync('npm', ['publish', '--access', 'public'], { cwd: out, stdio: 'inherit' })
    console.log(`  ${name} ok`)
  } catch {
    console.log(`\n  ${name} FAILED — npm's own output is above.`)
    process.exit(1)
  }
}
console.log()
