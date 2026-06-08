/**
 * repair-ouran-complete — Full Ouran OHSHC repair using retailer listing evidence.
 *
 * Evidence sources:
 *  - Retailer bb626f10-abd7-47a7-8848-bf69833cc902 has full volume titles:
 *      "Ouran High School Host Club Volume 6/8/9/10/11/12/13/16/17/18"
 *  - Google Books: isbn 9781421508641 = Ouran (Viz, 2006-09-05)
 *      → numerically between confirmed Vol 6 (505848) and Vol 8 (511610)
 *      → this is Vol 7 (absent from DB, needs INSERT)
 *
 * Repairs:
 *  A. UPDATE 10 bare-titled products → set volume_number from retailer listing
 *  B. INSERT Vol 7 (isbn 9781421508641) with CV metadata
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/repair-ouran-complete.ts --dry-run
 *   npx tsx --env-file=.env.local scripts/repair-ouran-complete.ts
 */
import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'crypto'

const prisma   = new PrismaClient()
const DRY_RUN  = process.argv.includes('--dry-run')
const OURAN_CV = '26278'

// The retailer whose listing titles include volume numbers
const EVIDENCE_RETAILER = 'bb626f10-abd7-47a7-8848-bf69833cc902'

// ISBN → volume number mapping (confirmed from retailer listing titles)
const RETAILER_ISBN_VOL: Record<string, number> = {
  '9781421505848': 6,
  '9781421511610': 8,
  '9781421514048': 9,
  '9781421519296': 10,
  '9781421522555': 11,
  '9781421526720': 12,
  '9781421526737': 13,
  '9781421538709': 16,
  '9781421539799': 17,
  '9781421541358': 18,
}

// Vol 7 — absent from DB, confirmed via Google Books (isbn 9781421508641, Viz, 2006-09-05)
// ISBN numerically between vol 6 (505848) and vol 8 (511610)
const VOL7_ISBN = '9781421508641'
const VOL7_SLUG = 'ouran-high-school-host-club-volume-7'

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
  console.log(`  repair-ouran-complete${DRY_RUN ? ' [DRY-RUN]' : ''}`)
  console.log('='.repeat(60))

  // ── Pre-flight checks ─────────────────────────────────────────────────────

  // Check Vol 7 ISBN doesn't already exist
  const existing7 = await prisma.$queryRaw<ProductRow[]>`
    SELECT id, title, isbn_13, format::text, volume_number
    FROM canonical_products
    WHERE isbn_13 = ${VOL7_ISBN} AND deleted_at IS NULL
  `
  if (existing7.length > 0) {
    console.log(`\n⚠ Vol 7 ISBN ${VOL7_ISBN} already exists in DB:`)
    console.log(`  id=${existing7[0].id} title="${existing7[0].title}" vol=${existing7[0].volume_number}`)
    console.log('  Skipping INSERT — will UPDATE instead if needed.')
  } else {
    console.log(`\n✓ Vol 7 ISBN ${VOL7_ISBN} not in DB — will INSERT`)
  }

  // Check for slug conflict
  const slugConflict = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM canonical_products WHERE canonical_slug = ${VOL7_SLUG} AND deleted_at IS NULL
  `
  if (slugConflict.length > 0) {
    console.log(`⚠ Slug '${VOL7_SLUG}' already exists (id=${slugConflict[0].id}) — INSERT will be skipped`)
  }

  // Fetch the 10 bare-titled products
  const unresolved = await prisma.$queryRaw<ProductRow[]>`
    SELECT id, title, isbn_13, format::text, volume_number, comicvine_id, series_name
    FROM canonical_products
    WHERE deleted_at IS NULL
      AND volume_number IS NULL
      AND isbn_13 != '9781421550787'
      AND (series_name ILIKE '%Ouran%' OR title ILIKE 'Ouran%')
    ORDER BY isbn_13
  `
  console.log(`\nFound ${unresolved.length} products to fix via retailer evidence.`)

  // ── Part A: UPDATE 10 bare-titled products ────────────────────────────────

  console.log('\n  Part A — UPDATE volume_number from retailer listing evidence:')
  let updated = 0; let skipped = 0; let errors = 0

  for (const p of unresolved) {
    const isbn = p.isbn_13
    if (!isbn) { skipped++; continue }

    const volNum = RETAILER_ISBN_VOL[isbn]
    if (volNum === undefined) {
      console.log(`  ⚠ No mapping for isbn=${isbn} "${p.title}" — skip`)
      skipped++
      continue
    }

    const changes: string[] = []
    if (p.volume_number !== volNum) changes.push(`vol → ${volNum}`)
    if (p.format !== 'MANGA_VOLUME')  changes.push(`fmt → MANGA_VOLUME`)
    if (p.comicvine_id !== OURAN_CV)  changes.push(`cvid → ${OURAN_CV}`)
    if (p.series_name !== 'Ouran High School Host Club') changes.push(`name fix`)

    console.log(`  Vol.${volNum} isbn=${isbn} — ${changes.join(', ')}`)

    if (DRY_RUN) continue

    try {
      await prisma.$executeRaw`
        UPDATE canonical_products SET
          volume_number = ${volNum},
          format        = 'MANGA_VOLUME'::"ProductFormat",
          comicvine_id  = COALESCE(comicvine_id, ${OURAN_CV}),
          series_name   = 'Ouran High School Host Club',
          updated_at    = NOW()
        WHERE id = ${p.id}::uuid
      `
      updated++
    } catch (e) {
      console.error(`  ✗ Error: ${e}`)
      errors++
    }
  }

  // ── Part B: INSERT Vol 7 ──────────────────────────────────────────────────

  console.log('\n  Part B — INSERT Vol. 7:')

  if (existing7.length > 0 || slugConflict.length > 0) {
    console.log(`  Skipped — already exists`)
    skipped++
  } else {
    const newId = randomUUID()
    console.log(`  Inserting Vol.7 isbn=${VOL7_ISBN} id=${newId}`)
    console.log(`  Evidence: Google Books (2006-09-05, Viz) + sequential ISBN between vol 6 & 8`)

    if (!DRY_RUN) {
      try {
        await prisma.$executeRaw`
          INSERT INTO canonical_products (
            id, title, isbn_13, format, volume_number,
            comicvine_id, series_name, canonical_slug,
            cv_metadata, created_at, updated_at
          ) VALUES (
            ${newId}::uuid,
            'Ouran High School Host Club, Vol. 7',
            ${VOL7_ISBN},
            'MANGA_VOLUME'::"ProductFormat",
            7,
            ${OURAN_CV},
            'Ouran High School Host Club',
            ${VOL7_SLUG},
            ${{ publisher: 'Viz Media', publishedDate: '2006-09-05', source: 'google-books-isbn-9781421508641' }}::jsonb,
            NOW(),
            NOW()
          )
          ON CONFLICT (canonical_slug) DO NOTHING
        `
        console.log(`  ✓ Inserted Vol.7`)
        updated++

        // Download cover for Vol 7
        console.log(`  → Fetching cover for Vol.7 (isbn ${VOL7_ISBN})…`)
        try {
          const { downloadAndStoreCoverWithFallback } = await import('../lib/images/download')
          const coverUrl = await downloadAndStoreCoverWithFallback(newId, { isbn13: VOL7_ISBN })
          console.log(`  ✓ Cover: ${coverUrl ? coverUrl.slice(0,60) : 'not found'}`)
        } catch (e) {
          console.log(`  ⚠ Cover download failed: ${e}`)
        }
      } catch (e) {
        console.error(`  ✗ INSERT failed: ${e}`)
        errors++
      }
    }
  }

  // ── Final state verification ───────────────────────────────────────────────

  console.log('\n' + '='.repeat(60))
  console.log('  Summary')
  console.log('='.repeat(60))
  console.log(`  Updated: ${updated}  Skipped: ${skipped}  Errors: ${errors}`)

  if (!DRY_RUN) {
    // Verify the final state
    const finalState = await prisma.$queryRaw<Array<{ volume_number: number | null; isbn_13: string | null }>>`
      SELECT volume_number, isbn_13
      FROM canonical_products
      WHERE deleted_at IS NULL
        AND comicvine_id = ${OURAN_CV}
        AND isbn_13 != '9781421550787'
      ORDER BY volume_number ASC NULLS LAST
    `
    const vols = finalState.map(r => r.volume_number).filter(v => v !== null) as number[]
    const nullCount = finalState.filter(r => r.volume_number === null).length
    const allVols = Array.from({ length: 18 }, (_, i) => i + 1)
    const missing = allVols.filter(v => !vols.includes(v))

    console.log(`\n  Volume numbers present: [${vols.join(', ')}]`)
    console.log(`  NULL volume_number: ${nullCount}`)
    console.log(`  Missing from 1-18: [${missing.join(', ')}]`)

    if (nullCount === 0 && missing.length === 0) {
      console.log('\n  ✅ All 18 volumes accounted for — page ready to build!')
    } else if (missing.length > 0) {
      console.log(`\n  ⚠ Gaps remain: vols [${missing.join(', ')}] not in DB`)
    }
  }
}

main()
  .catch(e => { console.error('\nScript failed:', e); process.exit(1) })
  .finally(() => prisma.$disconnect())
