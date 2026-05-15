#!/usr/bin/env tsx
/**
 * scripts/reclassify-formats.ts
 *
 * Safely reclassifies canonical_products rows where format = 'OTHER' into
 * more specific formats using conservative title + publisher signals.
 *
 * RULES:
 *   - Never touches rows that are already != OTHER
 *   - Never reclassifies when the signal is ambiguous
 *   - Defaults to --dry-run; requires explicit --write to commit changes
 *   - Only MANGA_VOLUME is applied (the only statistically significant bucket)
 *   - Other signals (omnibus/absolute/deluxe/hardcover) currently produce
 *     zero matches in OTHER — inferFormat() already caught them at seed time.
 *     The conditions are included here for future-proofing.
 *
 * Usage:
 *   npm run reclassify:formats              # dry-run (safe, no DB writes)
 *   npm run reclassify:formats -- --write   # apply changes to DB
 *
 * Findings from Day 5C audit (2026-05-15):
 *   Total canonical_products : 8,528
 *   format = OTHER           : 5,340 (62.6%)
 *
 *   Root causes of OTHER:
 *     1. Manga volumes stored with no vol. suffix — just a trailing number
 *        (e.g. "Blue Lock 3", "Wind Breaker 6"). inferFormat() requires
 *        "vol." or "volume N" patterns, so these slip through as OTHER.
 *     2. Genuinely unclassifiable: academic books, public-domain reprints,
 *        out-of-print titles with no publisher metadata, and non-comic ISBNs
 *        that sneaked past the genre filter.
 *     3. Ambiguous manga titles with no trailing number and no vol keyword
 *        (e.g. "Sword art online", "Naruto 3-in-1") — these are NOT touched.
 *
 *   Reclassification plan:
 *     MANGA_VOLUME  : manga publisher + title ends in " N" (688 rows, high confidence)
 *     OMNIBUS       : "omnibus" in title — 0 rows (already classified)
 *     ABSOLUTE      : "absolute" in title — 0 rows (already classified)
 *     DELUXE        : "deluxe" in title — 0 rows (already classified)
 *     HARDCOVER     : "hardcover"/" hc" in title — 0 rows (already classified)
 *     Genuinely OTHER: ~4,652 rows — leave as-is (academic/reprint/ambiguous)
 */

import { prisma } from '../lib/prisma'

// ── CLI flags ─────────────────────────────────────────────────────────────────

const args    = process.argv.slice(2)
const WRITE   = args.includes('--write')
const DRY_RUN = !WRITE

// ── Manga publisher list (lowercase for matching) ─────────────────────────────
// Extend this list as new manga-focused publishers are confirmed in the data.

const MANGA_PUBLISHERS = [
  'viz media',
  'viz',
  'kodansha comics',
  'kodansha',
  'yen press',
  'yen on',
  'seven seas entertainment',
  'seven seas',
  'tokyopop',
  'square enix manga',
  'square enix',
  'shueisha',
  'vertical comics',
  'vertical',
  'j-novel club',
  'dark horse manga',
  'airship',
]

// SQL list literal for use in IN clauses
const MANGA_PUB_LIST = MANGA_PUBLISHERS.map(p => `'${p}'`).join(',')

// ── Reclassification rules ─────────────────────────────────────────────────────
//
// Each rule defines:
//   label      : human-readable name for logging
//   targetFormat : the ProductFormat enum value to assign
//   whereSQL   : additional WHERE conditions (format = 'OTHER' always applied)
//   confidence : "high" | "medium" — only high-confidence rules are ever run
//   notes      : why this is safe

type Rule = {
  label        : string
  targetFormat : 'MANGA_VOLUME' | 'OMNIBUS' | 'ABSOLUTE' | 'DELUXE' | 'HARDCOVER' | 'TPB'
  whereSQL     : string
  confidence   : 'high' | 'medium'
  notes        : string
}

const RULES: Rule[] = [
  {
    label:        'MANGA_VOLUME — manga publisher + trailing volume number',
    targetFormat: 'MANGA_VOLUME',
    confidence:   'high',
    notes:
      'Publisher is a known manga-only publisher. Title ends with " N" (1–3 digits), ' +
      'the dominant pattern for manga tankōbon volumes (e.g. "Blue Lock 3"). ' +
      'Light novels are excluded via the NOT lower(title) ~ \'light novel\' guard. ' +
      'Omnibus/3-in-1 multi-volume compiles are excluded via NOT ~ \'3-in-1|omnibus\'.',
    whereSQL: `
      lower(publisher) IN (${MANGA_PUB_LIST})
      AND title ~ ' [0-9]{1,3}$'
      AND NOT lower(title) ~ 'light novel'
      AND NOT lower(title) ~ '(3-in-1|4-in-1|5-in-1|omnibus|box set)'
    `,
  },
  // The rules below currently match 0 rows because inferFormat() already handles
  // them at seed/stub-creation time. Kept here as future-proofing if new rows
  // bypass that path.
  {
    label:        'OMNIBUS — "omnibus" in title',
    targetFormat: 'OMNIBUS',
    confidence:   'high',
    notes:        '"omnibus" is unambiguous. Expected 0 matches currently.',
    whereSQL:     `lower(title) ~ '\\yomnibus\\y'`,
  },
  {
    label:        'ABSOLUTE — "absolute" in title',
    targetFormat: 'ABSOLUTE',
    confidence:   'high',
    notes:        '"absolute" is context-specific for DC prestige format. Expected 0 matches.',
    whereSQL:     `lower(title) ~ '\\yabsolute\\y'`,
  },
  {
    label:        'DELUXE — "deluxe edition" in title',
    targetFormat: 'DELUXE',
    confidence:   'high',
    notes:        '"deluxe edition" is specific enough. Expected 0 matches.',
    whereSQL:     `lower(title) ~ 'deluxe edition'`,
  },
  {
    label:        'HARDCOVER — "hardcover" or " hc" suffix in title',
    targetFormat: 'HARDCOVER',
    confidence:   'high',
    notes:        'Requires full word "hardcover" or trailing " hc". Expected 0 matches.',
    whereSQL:     `(lower(title) ~ 'hardcover' OR lower(title) ~ ' hc$' OR lower(title) ~ ' hc ')`,
  },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

async function countMatches(whereSQL: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
    `SELECT COUNT(*) AS n FROM canonical_products WHERE format = 'OTHER' AND (${whereSQL})`
  )
  return Number(rows[0].n)
}

async function sampleMatches(
  whereSQL : string,
  limit    : number = 5,
): Promise<Array<{ title: string; publisher: string | null }>> {
  return prisma.$queryRawUnsafe<Array<{ title: string; publisher: string | null }>>(
    `SELECT title, publisher FROM canonical_products WHERE format = 'OTHER' AND (${whereSQL}) ORDER BY RANDOM() LIMIT ${limit}`
  )
}

async function applyRule(rule: Rule): Promise<number> {
  const result = await prisma.$executeRawUnsafe(
    `UPDATE canonical_products SET format = '${rule.targetFormat}' WHERE format = 'OTHER' AND (${rule.whereSQL})`
  )
  return result
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n══════════════════════════════════════════════════════════')
  console.log(' Catch Comics — Format Reclassification')
  console.log(` Mode : ${DRY_RUN ? 'DRY RUN (no DB writes) — pass --write to apply' : '⚠  WRITE MODE — changes will be committed'}`)
  console.log('══════════════════════════════════════════════════════════\n')

  // ── Before snapshot ───────────────────────────────────────────────────────
  const before = await prisma.$queryRaw<Array<{ format: string; n: bigint }>>`
    SELECT format, COUNT(*) AS n FROM canonical_products GROUP BY format ORDER BY n DESC
  `
  const totalBefore = before.reduce((s, r) => s + Number(r.n), 0)
  console.log('── Before: format distribution ──────────────────────────────')
  for (const r of before) {
    const pct = ((Number(r.n) / totalBefore) * 100).toFixed(1)
    console.log(`  ${r.format.padEnd(16)} ${String(Number(r.n)).padStart(6)}  (${pct}%)`)
  }
  console.log()

  // ── Evaluate each rule ────────────────────────────────────────────────────
  let totalReclassified = 0

  for (const rule of RULES) {
    if (rule.confidence !== 'high') {
      console.log(`  [SKIP — medium confidence] ${rule.label}`)
      continue
    }

    const matchCount = await countMatches(rule.whereSQL)
    console.log(`── ${rule.label}`)
    console.log(`   Matches : ${matchCount}`)
    console.log(`   Notes   : ${rule.notes}`)

    if (matchCount === 0) {
      console.log(`   Result  : nothing to do\n`)
      continue
    }

    // Show sample
    const sample = await sampleMatches(rule.whereSQL, Math.min(5, matchCount))
    console.log(`   Sample  :`)
    for (const s of sample) {
      console.log(`     [${(s.publisher ?? 'no publisher').substring(0, 22).padEnd(22)}] ${s.title}`)
    }

    if (DRY_RUN) {
      console.log(`   Result  : would reclassify ${matchCount} row(s) → ${rule.targetFormat} [dry-run]\n`)
    } else {
      const updated = await applyRule(rule)
      console.log(`   Result  : reclassified ${updated} row(s) → ${rule.targetFormat} ✓\n`)
      totalReclassified += updated
    }
  }

  // ── After snapshot ────────────────────────────────────────────────────────
  if (!DRY_RUN) {
    const after = await prisma.$queryRaw<Array<{ format: string; n: bigint }>>`
      SELECT format, COUNT(*) AS n FROM canonical_products GROUP BY format ORDER BY n DESC
    `
    const totalAfter = after.reduce((s, r) => s + Number(r.n), 0)
    console.log('── After: format distribution ───────────────────────────────')
    for (const r of after) {
      const pct = ((Number(r.n) / totalAfter) * 100).toFixed(1)
      console.log(`  ${r.format.padEnd(16)} ${String(Number(r.n)).padStart(6)}  (${pct}%)`)
    }
    console.log()
    console.log(`  Total reclassified : ${totalReclassified}`)
  } else {
    // Summarise what would change
    let totalWouldChange = 0
    for (const rule of RULES) {
      if (rule.confidence === 'high') {
        totalWouldChange += await countMatches(rule.whereSQL)
      }
    }
    const otherBefore  = before.find(r => r.format === 'OTHER')
    const otherCount   = Number(otherBefore?.n ?? 0)
    const otherAfter   = otherCount - totalWouldChange
    console.log('── Projected after (dry-run) ────────────────────────────────')
    console.log(`  OTHER (before)   : ${otherCount}`)
    console.log(`  Would reclassify : ${totalWouldChange}`)
    console.log(`  OTHER (after)    : ${otherAfter}  (${((otherAfter / totalBefore) * 100).toFixed(1)}%)`)
    console.log()
    console.log('  Re-run with --write to apply these changes.')
  }

  console.log('══════════════════════════════════════════════════════════\n')
}

main()
  .catch(err => { console.error('Fatal error:', err); process.exit(1) })
  .finally(() => prisma.$disconnect())
