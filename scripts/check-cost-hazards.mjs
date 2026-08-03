#!/usr/bin/env node
/**
 * check-cost-hazards.mjs — CI regression check for concrete cost hazards.
 *
 * Plain Node, zero dependencies (runs in CI without npm install, like
 * launch-smoke.mjs). Deliberately narrow: it flags PATTERNS WITH A HIGH
 * LIKELIHOOD OF CREATING COST, not all Prisma usage.
 *
 * HARD FAILURES (exit 1) — request paths only (app/, lib/series/, lib/search/):
 *   H1: prisma.<retailerListing|canonicalProduct>.findMany( … ) whose call
 *       block has neither `select:` nor `take:` — unbounded wide rows on a
 *       render path (the exact shape behind the July Neon egress incident).
 *   H2: `include:` block that pulls `listings` without a nested `select`.
 *
 * WARNINGS (exit 0) — scripts/:
 *   W1: a script that performs bulk Prisma writes (updateMany/deleteMany/
 *       createMany) and never references the costguard gate.
 *
 * Suppress a specific line with:  // costguard-allow: <reason>
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const ROOT = process.cwd()
const REQUEST_PATH_DIRS = ['app', join('lib', 'series'), join('lib', 'search')]
const SCRIPT_DIR = 'scripts'
const HOT_MODELS = /prisma\.(retailerListing|canonicalProduct)\.findMany\s*\(/g

const hardFailures = []
const warnings = []

function* walk(dir) {
  let entries = []
  try { entries = readdirSync(dir) } catch { return }
  for (const name of entries) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) yield* walk(p)
    else if (/\.(ts|tsx|mjs)$/.test(name)) yield p
  }
}

/** Extract the balanced-brace argument block starting at an index. */
function callBlock(src, fromIdx, maxLen = 4000) {
  const open = src.indexOf('(', fromIdx)
  if (open === -1) return ''
  let depth = 0
  for (let i = open; i < Math.min(src.length, open + maxLen); i++) {
    if (src[i] === '(') depth++
    else if (src[i] === ')') { depth--; if (depth === 0) return src.slice(open, i + 1) }
  }
  return src.slice(open, open + maxLen)
}

function lineOf(src, idx) { return src.slice(0, idx).split('\n').length }
function suppressed(src, idx) {
  const lineStart = src.lastIndexOf('\n', idx)
  const prevLineStart = src.lastIndexOf('\n', lineStart - 1)
  const context = src.slice(Math.max(prevLineStart, 0), idx)
  return context.includes('costguard-allow:')
}

// ── H1 + H2: request paths ───────────────────────────────────────────────────
for (const dir of REQUEST_PATH_DIRS) {
  for (const file of walk(join(ROOT, dir))) {
    const src = readFileSync(file, 'utf8')
    const rel = relative(ROOT, file).split(sep).join('/')

    for (const m of src.matchAll(HOT_MODELS)) {
      if (suppressed(src, m.index)) continue
      const block = callBlock(src, m.index)
      if (!/\bselect\s*:/.test(block) && !/\btake\s*:/.test(block)) {
        hardFailures.push(
          `${rel}:${lineOf(src, m.index)} — H1 unbounded ${m[1]}.findMany without select/take on a request path`,
        )
      }
    }

    for (const m of src.matchAll(/\binclude\s*:\s*\{/g)) {
      if (suppressed(src, m.index)) continue
      const win = src.slice(m.index, m.index + 1500)
      const lm = win.match(/\blistings\s*:\s*(\{|true)/)
      if (!lm || lm.index === undefined) continue
      // `_count: { select: { listings: true } }` is a cheap COUNT — fine.
      const before = win.slice(Math.max(lm.index - 80, 0), lm.index)
      if (before.includes('_count')) continue
      if (lm[1] === 'true') {
        hardFailures.push(
          `${rel}:${lineOf(src, m.index + lm.index)} — H2 include: { listings: true } pulls full listing rows (raw_data) on a request path`,
        )
      } else {
        const after = win.slice(lm.index, lm.index + 900)
        if (!/\bselect\s*:/.test(after)) {
          hardFailures.push(
            `${rel}:${lineOf(src, m.index + lm.index)} — H2 include pulls listings without a nested select (raw_data leaks)`,
          )
        }
      }
    }
  }
}

// ── W1: ungated bulk-writing scripts ─────────────────────────────────────────
for (const file of walk(join(ROOT, SCRIPT_DIR))) {
  const src = readFileSync(file, 'utf8')
  const rel = relative(ROOT, file).split(sep).join('/')
  if (/\bprisma\.\w+\.(updateMany|deleteMany|createMany)\s*\(/.test(src) &&
      !src.includes('costguard') && !src.includes('costguard-allow:')) {
    warnings.push(`${rel} — W1 bulk Prisma writes with no Cost Guard gate`)
  }
}

// ── Report ───────────────────────────────────────────────────────────────────
console.log('\ncheck-cost-hazards — concrete cost-hazard scan')
if (warnings.length) {
  console.log(`\n${warnings.length} warning(s) (not blocking):`)
  for (const w of warnings) console.log(`  ⚠ ${w}`)
}
if (hardFailures.length) {
  console.error(`\n${hardFailures.length} HARD failure(s):`)
  for (const f of hardFailures) console.error(`  ✗ ${f}`)
  console.error('\nFix the query (explicit select / bounded take) or annotate the line above with `// costguard-allow: <reason>` if genuinely intended.')
  process.exit(1)
}
console.log(`\n✓ no hard cost hazards found (${warnings.length} warnings)`)
