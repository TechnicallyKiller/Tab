#!/usr/bin/env node
/**
 * No floating-point arithmetic in a money path.
 *
 * verify-tab claims the ledger reconciles to the cent. Tab also multiplies
 * amounts by fractions repeatedly — a 0.6 unattested weight, tier multiples, a
 * ramp stepping ±15/30%, interest per window. Many small numbers, repeated
 * fractional multiplication, exact reconciliation required: precisely where
 * IEEE-754 doubles produce a ledger that is a few micro-USDC out and cannot be
 * explained. See ADR-0006.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readWorkspace, rel, report, walk } from './lib.mjs'

const MONEY_PACKAGES = new Set([
  'money',
  'ledger',
  'scoring',
  'fastpath',
  'gateway',
  'settlement',
  'engine',
  'web',
])

const PATTERNS = [
  [/\bparseFloat\s*\(/, 'parseFloat'],
  [/\bNumber\.parseFloat\s*\(/, 'Number.parseFloat'],
  [/\.toFixed\s*\(/, 'toFixed'],
  [/\/\s*1e6\b/, 'division by 1e6'],
  [/\*\s*1e6\b/, 'multiplication by 1e6'],
  [/\/\s*1_?000_?000\b/, 'division by 1000000'],
]

const WHY =
  'Amounts are bigint micro-USDC behind the MicroUsdc branded type in @tab/money. Rates are ' +
  'integer basis points and multiplication states its rounding direction at the call site. If a ' +
  'display path genuinely needs this, put it in @tab/money (files matching format/display/present ' +
  'are exempt) or annotate the line `// allow-float — <reason>`.'

const failures = []

for (const { shortName, dir } of readWorkspace()) {
  if (!MONEY_PACKAGES.has(shortName)) continue
  for (const file of walk(join(dir, 'src'), ['.ts', '.tsx'])) {
    // Presentation formatting is the one place decimals are legitimate.
    if (/(format|display|present)/i.test(rel(file))) continue
    const lines = readFileSync(file, 'utf8').split('\n')
    lines.forEach((line, i) => {
      // Accept the annotation on the line itself or immediately above it.
      const previous = i > 0 ? lines[i - 1] : ''
      if (/\/\/\s*allow-float/.test(line) || /\/\/\s*allow-float/.test(previous ?? '')) return
      for (const [re, label] of PATTERNS) {
        if (re.test(line)) {
          failures.push({
            where: `${rel(file)}:${i + 1}`,
            what: `floating-point money (${label}) — ${line.trim().slice(0, 80)}`,
            why: WHY,
          })
          return
        }
      }
    })
  }
}

process.exit(report('no-float-money', failures, 'no floating-point arithmetic in money paths'))
