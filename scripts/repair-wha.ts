/**
 * repair-wha — Witch Hat Atelier full repair + missing volume inserts.
 *
 * Evidence:
 *  - Vol 2 ISBN: 9781642129397 (Google Books: Kodansha, 2019-06-25)
 *  - Vol 5 ISBN: 9781646594542 (Google Books: Kodansha, 2020-03-17)
 *  - Vol 6 ISBN: 9781646595754 (Google Books: Kodansha, 2020-06-16)
 *  - Vol 7 ISBN: 9781646599875 (Google Books: Kodansha, 2020-12-29)
 *  - Vol 8 ISBN: 9781636994864 (Google Books: Kodansha, 2021-09-28)
 *
 * Repairs:
 *  A. Fix volume_number for vols 13 and 14 (NULL → correct value)
 *  B. Fix format TPB → MANGA_VOLUME for all main-series vols (1,3,4,9,10,11,12,13,14)
 *  C. Fix Grimoire Editions: TPB/OTHER → DELUXE
 *  D. INSERT vols 2, 5, 6, 7, 8 with confirmed ISBNs + download covers
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/repair-wha.ts --dry-run
 *   npx tsx --env-file=.env.local scripts/repair-wha.ts
 */
import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'crypto'

const prisma   = new PrismaClient()
const DRY_RUN  = process.argv.includes('--dry-run')
const WHA_CV   = '118208'
const WHA_NAME = 'Witch Hat Atelier'

// ── Missing volumes to insert ──────────────────────────────────────────────────
const MISSING_VOLS = [
  { vol: 2,  isbn: '9781642129397', slug: 'witch-hat-atelier-volume-2',  published: '2019-06-25' },
  { vol: 5,  isbn: '9781646594542', slug: 'witch-hat-atelier-volume-5',  published: '2020-03-17' },
  { vol: 6,  isbn: '9781646595754', slug: 'witch-hat-atelier-volume-6',  published: '2020-06-16' },
  { vol: 7,  isbn: '9781646599875', slug: 'witch-hat-atelier-volume-7',  published: '2020-12-29' },
  { vol: 8,  isbn: '9781636994864', slug: 'witch-hat-atelier-volume-8',  published: '2021-09-28' },
]

interface ProductRow {
  id:            string
  title:         string
  isbn_13:       string | null
  format:        string
  volume_number: number | null
  comicvine_id:  string | null
  series_name:   string | null
}

async function main() {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`  repair-wha${DRY_RUN ? ' [DRY-RUN]' : ''}`)
  console.log('='.repeat(60))

  // ── Pre-flight: check no ISBN conflicts ───────────────────────────────────
  console.log('\n  Pre-flight checks…')
  for (const mv of MISSING_VOLS) {
    const existing = await prisma.$queryRaw<ProductRow[]>`
      SELECT id, title, isbn_13, format::text, volume_number
      FROM canonical_products
      WHERE isbn_13 = ${mv.isbn} AND deleted_at IS NULL
    `
    if (existing.length > 0) {
      console.log(`  ⚠ isbn ${mv.isbn} (vol ${mv.vol}) already in DB: "${existing[0].title}" vol=${existing[0].volume_number}`)
    }
    const slugCheck = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM canonical_products WHERE canonical_slug = ${mv.slug} AND deleted_at IS NULL
    `
    if (slugCheck.length > 0) {
      console.log(`  ⚠ slug '${mv.slug}' already exists`)
    }
  }
  console.log('  Pre-flight done.')

  // Fetch all WHA main-series products
  const allWHA = await prisma.$queryRaw<ProductRow[]>`
    SELECT id, title, isbn_13, format::text, volume_number, comicvine_id, series_name
    FROM canonical_products
    WHERE deleted_at IS NULL
      AND comicvine_id = ${WHA_CV}
    ORDER BY volume_number ASC NULLS LAST, title
  `
  console.log(`\nFound ${allWHA.length} WHA main-series products (cv:${WHA_CV}).`)

  let updated = 0; let inserted = 0; let skipped = 0; let errors = 0

  // ── Part A+B: Fix volume_number + format for existing products ────────────
  console.log('\n  Part A+B — Fix volume_number + format for existing products:')

  const GRIMOIRE_KEYWORDS = ['Grimoire', 'Art of', 'Colouring', 'Color', 'Box Set']

  for (const p of allWHA) {
    // Determine correct volume_number from title
    const m = p.title.match(/[Vv]olume\s+(\d+)|[Vv]ol\.?\s*(\d+)/)
    const correctVol = m ? parseInt(m[1] ?? m[2], 10) : null

    // Determine correct format
    const isGrimoire = GRIMOIRE_KEYWORDS.some(k => p.title.includes(k))
    const isMainVol  = correctVol !== null && !isGrimoire
    const correctFmt = isGrimoire ? 'DELUXE' : (isMainVol ? 'MANGA_VOLUME' : null)

    // Supplementals/Grimoires should NOT get a volume_number — they'd conflict with main vols
    const mainSeriesVol = isMainVol ? correctVol : null

    const changes: string[] = []
    if (mainSeriesVol !== null && p.volume_number !== mainSeriesVol) changes.push(`vol → ${mainSeriesVol}`)
    if (correctFmt !== null && p.format !== correctFmt)              changes.push(`fmt → ${correctFmt}`)
    if (p.series_name !== WHA_NAME)                                  changes.push(`series_name fix`)

    if (changes.length === 0) {
      console.log(`  ✓ "${p.title.slice(0,50)}" — already ok`)
      skipped++
      continue
    }

    console.log(`  "${p.title.slice(0,50)}" — ${changes.join(', ')}`)
    if (DRY_RUN) continue

    try {
      if (correctFmt === 'DELUXE') {
        await prisma.$executeRaw`
          UPDATE canonical_products SET
            format     = 'DELUXE'::"ProductFormat",
            series_name = ${WHA_NAME},
            updated_at = NOW()
          WHERE id = ${p.id}::uuid
        `
      } else if (correctFmt === 'MANGA_VOLUME') {
        await prisma.$executeRaw`
          UPDATE canonical_products SET
            volume_number = ${mainSeriesVol},
            format        = 'MANGA_VOLUME'::"ProductFormat",
            series_name   = ${WHA_NAME},
            updated_at    = NOW()
          WHERE id = ${p.id}::uuid
        `
      } else {
        // Only series_name fix
        await prisma.$executeRaw`
          UPDATE canonical_products SET
            series_name = ${WHA_NAME},
            updated_at  = NOW()
          WHERE id = ${p.id}::uuid
        `
      }
      updated++
    } catch (e) {
      console.error(`  ✗ Error: ${e}`)
      errors++
    }
  }

  // ── Part C: INSERT missing volumes 2, 5, 6, 7, 8 ─────────────────────────
  console.log('\n  Part C — INSERT missing volumes (2, 5, 6, 7, 8):')

  for (const mv of MISSING_VOLS) {
    // Check for existing
    const existing = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM canonical_products
      WHERE (isbn_13 = ${mv.isbn} OR canonical_slug = ${mv.slug})
        AND deleted_at IS NULL
    `
    if (existing.length > 0) {
      console.log(`  ⚠ Vol.${mv.vol} already exists — skip`)
      skipped++
      continue
    }

    const newId = randomUUID()
    const title = `Witch Hat Atelier, Volume ${mv.vol}`
    console.log(`  Inserting Vol.${mv.vol} isbn=${mv.isbn} id=${newId}`)
    console.log(`  Evidence: Google Books (Kodansha, ${mv.published})`)

    if (DRY_RUN) continue

    try {
      await prisma.$executeRaw`
        INSERT INTO canonical_products (
          id, title, isbn_13, format, volume_number,
          comicvine_id, series_name, canonical_slug,
          cv_metadata, created_at, updated_at
        ) VALUES (
          ${newId}::uuid,
          ${title},
          ${mv.isbn},
          'MANGA_VOLUME'::"ProductFormat",
          ${mv.vol},
          ${WHA_CV},
          ${WHA_NAME},
          ${mv.slug},
          ${{ publisher: 'Kodansha Comics', publishedDate: mv.published, source: 'google-books' }}::jsonb,
          NOW(),
          NOW()
        )
        ON CONFLICT (canonical_slug) DO NOTHING
      `

      // Download cover
      console.log(`  → Fetching cover for Vol.${mv.vol}…`)
      try {
        const { downloadAndStoreCoverWithFallback } = await import('../lib/images/download')
        const coverUrl = await downloadAndStoreCoverWithFallback(newId, { isbn13: mv.isbn })
        console.log(`  ✓ Cover: ${coverUrl ? coverUrl.slice(0,60) : 'not found'}`)
      } catch (e) {
        console.log(`  ⚠ Cover download failed: ${e}`)
      }

      inserted++
    } catch (e) {
      console.error(`  ✗ INSERT failed: ${e}`)
      errors++
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(60))
  console.log('  Summary')
  console.log('='.repeat(60))
  console.log(`  Updated:  ${updated}  Inserted: ${inserted}  Skipped: ${skipped}  Errors: ${errors}`)

  if (!DRY_RUN) {
    // Final verification
    const finalState = await prisma.$queryRaw<Array<{ volume_number: number | null; format: string }>>`
      SELECT volume_number, format::text
      FROM canonical_products
      WHERE deleted_at IS NULL
        AND comicvine_id = ${WHA_CV}
      ORDER BY volume_number ASC NULLS LAST
    `
    const vols    = finalState.filter(r => r.volume_number !== null).map(r => r.volume_number!) as number[]
    const missing = Array.from({ length: 14 }, (_, i) => i + 1).filter(v => !vols.includes(v))
    const badFmt  = finalState.filter(r => r.volume_number !== null && r.format !== 'MANGA_VOLUME')

    console.log(`\n  Vols present: [${vols.join(', ')}]`)
    console.log(`  Missing from 1-14: [${missing.join(', ')}]`)
    if (badFmt.length > 0) {
      console.log(`  Wrong format: ${badFmt.map(r => `Vol.${r.volume_number}=${r.format}`).join(', ')}`)
    } else {
      console.log('  All formats correct')
    }
    if (missing.length === 0) {
      console.log('\n  ✅ All 14 volumes present — page ready to build!')
    }
  }
}

main()
  .catch(e => { console.error('\nScript failed:', e); process.exit(1) })
  .finally(() => prisma.$disconnect())
