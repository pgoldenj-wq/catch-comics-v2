/**
 * repair-tier3 — Fix Tier 3 series data quality issues
 *
 * Audit findings (2026-06-08):
 *
 * INNOCENT OMNIBUS (cv:157999, Dark Horse Comics) — GREEN, no repairs needed.
 *
 * WOLF'S DAUGHTER (cv:169717, Seven Seas Entertainment)
 *   Vol 2 (isbn 9798893737738): volume_number NULL → 2
 *     Evidence: title "Wolf's Daughter: A Werewolf's Tale Volume 2", confirmed Vol 2
 *               by Google Books (Seven Seas, pub 2025-10-07)
 *   All 4 vols: format TPB → MANGA_VOLUME (Seven Seas manga imprint)
 *
 * EDEN OF WITCHES (cv:161324, Abrams)
 *   Vol 7 (isbn 9781419788710): volume_number NULL → 7, format OTHER → TPB
 *     Evidence: title "Eden of Witches Volume 7", confirmed by Google Books (Abrams, 2026-05-05)
 *   Vols 5, 6, 7: comicvine_id NULL → 161324
 *     Evidence: same series as Vols 1-4 which all carry cv:161324; sequential numbering
 *     CRITICAL: without CV ID, these volumes are excluded from the series page query
 *
 * MULTI-MIND MAYHEM (cv:138705, One Peace Books)
 *   All 3 vols: format TPB → MANGA_VOLUME (One Peace Books manga imprint)
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/repair-tier3.ts --dry-run
 *   npx tsx --env-file=.env.local scripts/repair-tier3.ts
 */
import { PrismaClient } from '@prisma/client'

const prisma  = new PrismaClient()
const DRY_RUN = process.argv.includes('--dry-run')

// ── Repair catalogue ────────────────────────────────────────────────────────────

interface Repair {
  isbn:        string
  series:      string
  vol:         number | null      // null = keep existing
  format:      string
  cvId:        string | null      // null = keep existing
  description: string
}

const REPAIRS: Repair[] = [
  // Wolf's Daughter — vol_number fix
  {
    isbn: '9798893737738', series: "Wolf's Daughter", vol: 2,
    format: 'MANGA_VOLUME', cvId: null,
    description: "Wolf's Daughter Vol 2 — set volume_number=2 (was NULL), format→MANGA_VOLUME",
  },
  // Wolf's Daughter — format-only fixes (vol_number already set)
  {
    isbn: '9798893734409', series: "Wolf's Daughter", vol: null,
    format: 'MANGA_VOLUME', cvId: null,
    description: "Wolf's Daughter Vol 1 — format TPB→MANGA_VOLUME",
  },
  {
    isbn: '9798893737745', series: "Wolf's Daughter", vol: null,
    format: 'MANGA_VOLUME', cvId: null,
    description: "Wolf's Daughter Vol 3 — format TPB→MANGA_VOLUME",
  },
  {
    isbn: '9798895615478', series: "Wolf's Daughter", vol: null,
    format: 'MANGA_VOLUME', cvId: null,
    description: "Wolf's Daughter Vol 4 — format TPB→MANGA_VOLUME",
  },

  // Eden of Witches — vol_number + format + CV ID fix for Vol 7
  {
    isbn: '9781419788710', series: 'Eden of Witches', vol: 7,
    format: 'TPB', cvId: '161324',
    description: "Eden of Witches Vol 7 — set volume_number=7 (was NULL), format OTHER→TPB, cvId→161324",
  },
  // Eden of Witches — CV ID fix for Vols 5 and 6 (already numbered, no page without CV ID)
  {
    isbn: '9781419778483', series: 'Eden of Witches', vol: null,
    format: 'TPB', cvId: '161324',
    description: "Eden of Witches Vol 5 — set comicvine_id=161324 (was NULL)",
  },
  {
    isbn: '9781419778490', series: 'Eden of Witches', vol: null,
    format: 'TPB', cvId: '161324',
    description: "Eden of Witches Vol 6 — set comicvine_id=161324 (was NULL)",
  },

  // Multi-Mind Mayhem — format-only fixes
  {
    isbn: '9781642731408', series: 'Multi-Mind Mayhem', vol: null,
    format: 'MANGA_VOLUME', cvId: null,
    description: "Multi-Mind Mayhem Vol 1 — format TPB→MANGA_VOLUME",
  },
  {
    isbn: '9781642731392', series: 'Multi-Mind Mayhem', vol: null,
    format: 'MANGA_VOLUME', cvId: null,
    description: "Multi-Mind Mayhem Vol 2 — format TPB→MANGA_VOLUME",
  },
  {
    isbn: '9781642732160', series: 'Multi-Mind Mayhem', vol: null,
    format: 'MANGA_VOLUME', cvId: null,
    description: "Multi-Mind Mayhem Vol 3 — format TPB→MANGA_VOLUME",
  },
]

// ── Main ────────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${'='.repeat(65)}`)
  console.log(`  repair-tier3${DRY_RUN ? ' [DRY-RUN]' : ''}`)
  console.log('='.repeat(65))
  console.log(`  Repairs planned: ${REPAIRS.length}`)

  let updated = 0; let skipped = 0; let errors = 0

  for (const r of REPAIRS) {
    const rows = await prisma.$queryRaw<Array<{
      id: string; title: string; format: string;
      volume_number: number | null; comicvine_id: string | null
    }>>`
      SELECT id, title, format::text, volume_number, comicvine_id
      FROM canonical_products
      WHERE isbn_13 = ${r.isbn} AND deleted_at IS NULL
    `

    if (rows.length === 0) {
      console.log(`  ⚠ isbn=${r.isbn} not found — skip`)
      skipped++
      continue
    }

    const p = rows[0]
    const changes: string[] = []

    if (r.vol !== null && p.volume_number !== r.vol)      changes.push(`vol ${p.volume_number ?? 'NULL'}→${r.vol}`)
    if (p.format !== r.format)                             changes.push(`fmt ${p.format}→${r.format}`)
    if (r.cvId !== null && p.comicvine_id !== r.cvId)     changes.push(`cvId ${p.comicvine_id ?? 'NULL'}→${r.cvId}`)

    if (changes.length === 0) {
      console.log(`  ✓ "${p.title.slice(0, 55)}" — already ok`)
      skipped++
      continue
    }

    console.log(`  ${r.description}`)
    console.log(`    Changes: ${changes.join(', ')}`)

    if (DRY_RUN) continue

    try {
      // Build the update — only set fields that need changing
      if (r.vol !== null && r.cvId !== null) {
        // vol + format + cvId (Eden of Witches Vol 7)
        await prisma.$executeRaw`
          UPDATE canonical_products SET
            volume_number = ${r.vol},
            format        = ${r.format}::"ProductFormat",
            comicvine_id  = ${r.cvId},
            updated_at    = NOW()
          WHERE id = ${p.id}::uuid
        `
      } else if (r.vol !== null) {
        // vol + format (Wolf's Daughter Vol 2)
        await prisma.$executeRaw`
          UPDATE canonical_products SET
            volume_number = ${r.vol},
            format        = ${r.format}::"ProductFormat",
            updated_at    = NOW()
          WHERE id = ${p.id}::uuid
        `
      } else if (r.cvId !== null) {
        // cvId + format (Eden of Witches Vols 5, 6)
        await prisma.$executeRaw`
          UPDATE canonical_products SET
            format       = ${r.format}::"ProductFormat",
            comicvine_id = ${r.cvId},
            updated_at   = NOW()
          WHERE id = ${p.id}::uuid
        `
      } else {
        // format only (Vols with correct vol_number + cvId)
        await prisma.$executeRaw`
          UPDATE canonical_products SET
            format     = ${r.format}::"ProductFormat",
            updated_at = NOW()
          WHERE id = ${p.id}::uuid
        `
      }
      updated++
    } catch (e) {
      console.error(`  ✗ Error on ${r.isbn}: ${e}`)
      errors++
    }
  }

  // ── Post-repair verification ───────────────────────────────────────────────
  console.log('\n' + '='.repeat(65))
  console.log(`  Updated: ${updated}  Skipped: ${skipped}  Errors: ${errors}`)

  if (!DRY_RUN) {
    const checks = [
      { name: "Wolf's Daughter",   cvId: '169717', expectedVols: [1,2,3,4], format: 'MANGA_VOLUME' },
      { name: 'Eden of Witches',   cvId: '161324', expectedVols: [1,2,3,4,5,6,7], format: 'TPB' },
      { name: 'Multi-Mind Mayhem', cvId: '138705', expectedVols: [1,2,3], format: 'MANGA_VOLUME' },
      { name: 'Innocent Omnibus',  cvId: '157999', expectedVols: [1,2,3], format: 'OMNIBUS' },
    ]

    console.log('\n  Volume state after repair:')
    for (const c of checks) {
      const rows = await prisma.$queryRaw<Array<{
        volume_number: number | null; format: string; cover_image_url: string | null
      }>>`
        SELECT volume_number, format::text, cover_image_url
        FROM canonical_products
        WHERE deleted_at IS NULL
          AND comicvine_id = ${c.cvId}
          AND format::text != 'SINGLE_ISSUE'
        ORDER BY volume_number ASC NULLS LAST
      `
      const vols    = rows.map(r => r.volume_number).filter(v => v !== null) as number[]
      const missing = c.expectedVols.filter(v => !vols.includes(v))
      const badFmt  = rows.filter(r => r.volume_number !== null && r.format !== c.format)
      const covers  = rows.filter(r => r.cover_image_url).length

      const status  = missing.length === 0 && badFmt.length === 0
        ? '✅ READY'
        : [
            missing.length  ? `⚠ MISSING vols: [${missing.join(',')}]` : '',
            badFmt.length   ? `⚠ wrong fmt: ${badFmt.map(r => `Vol.${r.volume_number}=${r.format}`).join(', ')}` : '',
          ].filter(Boolean).join(' | ')

      console.log(`  ${c.name.padEnd(22)} vols=[${vols.join(',')}] covers=${covers}/${rows.length} ${status}`)
    }
  }
}

main()
  .catch(e => { console.error('\nScript failed:', e); process.exit(1) })
  .finally(() => prisma.$disconnect())
