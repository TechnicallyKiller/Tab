#!/usr/bin/env node
/**
 * No key material in tracked files.
 *
 * Cheap to write, and it prevents the single worst outcome of a public
 * hackathon repo. A Hedera private key is a DER string beginning 302e/302a;
 * an ECDSA one is 64 hex characters.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { readWorkspace, rel, report, ROOT, walk } from './lib.mjs'

const DER = /302[ae]020100300506032b6570/i          // Ed25519 DER private key prefix
const HEX64 = /(?<![0-9a-fA-F])[0-9a-fA-F]{64}(?![0-9a-fA-F])/
const OPERATOR_ASSIGN = /(OPERATOR_KEY|PRIVATE_KEY|HOT_FLOAT_KEY|TREASURY_KEY[A-Z_]*)\s*[=:]\s*['"]?([^\s'"#]+)/

const PLACEHOLDERS = new Set(['', '302e...', '0x', 'your-key-here'])
const failures = []

const files = [
  ...walk(ROOT, ['.ts', '.tsx', '.mjs', '.js', '.json', '.yaml', '.yml', '.md', '.example']),
]

for (const file of files) {
  const path = rel(file)
  if (path.includes('pnpm-lock.yaml')) continue // integrity hashes, not secrets
  let src
  try {
    src = readFileSync(file, 'utf8')
  } catch {
    continue
  }
  const lines = src.split('\n')
  lines.forEach((line, i) => {
    if (/allow-secret/.test(line)) return
    if (DER.test(line)) {
      failures.push({
        where: `${path}:${i + 1}`,
        what: 'looks like a Hedera Ed25519 private key (DER prefix)',
        why: 'Never commit key material. Rotate this key immediately — it is in git history now.',
      })
      return
    }
    const m = OPERATOR_ASSIGN.exec(line)
    if (m && m[2] && !PLACEHOLDERS.has(m[2]) && (HEX64.test(m[2]) || m[2].length > 40)) {
      failures.push({
        where: `${path}:${i + 1}`,
        what: `${m[1]} is assigned what looks like a real value`,
        why: 'Keys belong in .env, which is gitignored. .env.example carries empty placeholders only.',
      })
    }
  })
}

/**
 * A .env in the working tree is normal and expected — that is where keys belong.
 * The failure is a .env that git is TRACKING, so ask git rather than the
 * filesystem. Without git (a tarball, a bare CI image) there is nothing to
 * assert, so skip rather than guess.
 */
for (const file of walk(ROOT, ['.env'])) {
  const path = rel(file)
  if (path.endsWith('.env.example')) continue
  let tracked = false
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', path], {
      cwd: ROOT,
      stdio: 'ignore',
    })
    tracked = true
  } catch {
    tracked = false // Untracked, or git unavailable. Either way, nothing to report.
  }
  if (tracked) {
    failures.push({
      where: path,
      what: 'this .env is tracked by git',
      why: 'Only .env.example is tracked. Run `git rm --cached ' + path +
        '` and confirm .gitignore covers it. If a key was already committed, rotate it — ' +
        'it is in the history now.',
    })
  }
}

void readWorkspace
process.exit(report('no-secrets', failures, 'no key material in tracked files'))
