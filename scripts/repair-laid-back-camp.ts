/**
 * repair-laid-back-camp — Fix Laid-Back Camp series data.
 *
 * Audit findings (2026-06-07):
 *  - 17 products total, vols 1-17 all present in DB
 *  - Only vols 1 and 2 have volume_number set
 *  - All 15 others have extractable volume numbers from their title
 *  - All 17 need format = MANGA_VOLUME (currently TPB or OTHER)
 *  - 5 products (vols 7, 10, 13, 14, 16) have NULL comicvine_id and series_name
 *
 * Repairs:
 *  1. Extract volume_number from title for unnumbered products
 *  2. Set format = MANGA_VOLUME for all
 *  3. Set comicvine_id = '109427', series_name = 'Laid-Back Camp' for orphans
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/repair-laid-back-camp.ts --dry-run
 *   npx tsx --env-file=.env.local scripts/repair-laid-back-camp.ts
 */
import { PrismaClient } from '@prisma/client'

const prisma   = new PrismaClient()
const DRY_RUN  = process.argv.includes('--dry-run')
const LBC_CV   = '109427'
const LBC_NAME = 'Laid-Back Camp'

// ── Volume number extraction ───────────────────────────────────────────────────

/** Extract integer volume number from a Laid-Back Camp product title.
 *  Handles:
 *    "Laid-Back Camp, Vol. 3"    → 3
 *    "Laid Back Camp Volume 17"  → 17
 *    "Laid-Back Camp, Vol. 11"   → 11
 *  Returns null if not parseable.
 */
function extractVolume(title: string): number | null {
  // "Vol. N" pattern (with or without comma, with or without hyphen)
  let m = title.match(/[Vv]ol\.?\s*(\d+)/)
  if (m) return parseInt(m[1], 10)
  // "Volume N" pattern
  m = title.match(/[Vv]olume\s+(\d+)/)
  if (m) return parseInt(m[1], 10)
  return null
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`  repair-laid-back-camp${DRY_RUN ? ' [DRY-RUN]' : ''}`)
  console.log('='.repeat(60))

  // Fetch all LBC products
  const products = await prisma.$queryRaw<Array<{
    id: string; title: string; isbn_13: string | null; format: string;
    series_name: string | null; volume_number: number | null;
    comicvine_id: string | null;
  }>>`
    SELECT id, title, isbn_13, format::text, series_name, volume_number, comicvine_id
    FROM canonical_products
    WHERE deleted_at IS NULL
      AND (series_name ILIKE '%Laid%Camp%'
           OR series_name ILIKE '%Yuru Camp%'
           OR title ILIKE 'Laid%Camp%'
           OR title ILIKE 'Yuru Camp%')
    ORDER BY volume_number ASC NULLS LAST, title
  `

  console.log(`\nFound ${products.length} Laid-Back Camp products.\n`)

  let volFixed    = 0
  let fmtFixed    = 0
  let cvFixed     = 0
  let skipped     = 0
  let errored     = 0
  let alreadyOk   = 0

  for (const p of products) {
    const extracted = extractVolume(p.title)
    const needsVol  = p.volume_number === null && extracted !== null
    const needsFmt  = p.format !== 'MANGA_VOLUME'
    const needsCv   = !p.comicvine_id
    const needsName = p.series_name !== LBC_NAME

    const changes: string[] = []
    if (needsVol  && extracted) changes.push(`volume_number → ${extracted}`)
    if (needsFmt)               changes.push(`format → MANGA_VOLUME`)
    if (needsCv)                changes.push(`comicvine_id → ${LBC_CV}`)
    if (needsName)              changes.push(`series_name → "${LBC_NAME}"`)

    if (changes.length === 0) {
      console.log(`  ✓ Vol.${p.volume_number} "${p.title}" — already correct`)
      alreadyOk++
      continue
    }

    if (p.volume_number === null && extracted === null) {
      console.log(`  ⚠ SKIP "${p.title}" — cannot extract volume number`)
      skipped++
      continue
    }

    const volNum = extracted ?? p.volume_number

    console.log(`  ${DRY_RUN ? '[DRY] ' : ''}Vol.${volNum ?? '?'} "${p.title}"`)
    changes.forEach(c => console.log(`       ${c}`))

    if (DRY_RUN) continue

    try {
      // Build update dynamically based on what's needed
      await prisma.$executeRaw`
        UPDATE canonical_products SET
          volume_number = COALESCE(${volNum ?? null}, volume_number),
          format        = 'MANGA_VOLUME'::"ProductFormat",
          comicvine_id  = COALESCE(comicvine_id, ${LBC_CV}),
          series_name   = ${LBC_NAME},
          updated_at    = NOW()
        WHERE id = ${p.id}::uuid
      `
      if (needsVol)  volFixed++
      if (needsFmt)  fmtFixed++
      if (needsCv)   cvFixed++
    } catch (e) {
      console.error(`    ✗ ERROR: ${e}`)
      errored++
    }
  }

  console.log('\n' + '='.repeat(60))
  console.log('  Summary')
  console.log('='.repeat(60))
  console.log(`  Already correct:     ${alreadyOk}`)
  if (DRY_RUN) {
    const toFix = products.filter(p => {
      const ex = extractVolume(p.title)
      return p.volume_number === null && ex !== null || p.format !== 'MANGA_VOLUME' || !p.comicvine_id || p.series_name !== LBC_NAME
    })
    console.log(`  Would fix:           ${toFix.length}`)
    console.log(`  Would skip:          ${skipped}`)
  } else {
    console.log(`  volume_number fixed: ${volFixed}`)
    console.log(`  format fixed:        ${fmtFixed}`)
    console.log(`  comicvine_id fixed:  ${cvFixed}`)
    console.log(`  skipped:             ${skipped}`)
    console.log(`  errored:             ${errored}`)
  }
}

main()
  .catch(e => { console.error('\nScript failed:', e); process.exit(1) })
  .finally(() => prisma.$disconnect())
