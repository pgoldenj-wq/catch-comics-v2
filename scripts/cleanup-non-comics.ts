/**
 * cleanup-non-comics — DRY RUN classifier for canonical_products pollution.
 *
 * Background: 40,997 canonical_products have format='OTHER' AND comicvine_id
 * IS NULL. A sample showed a mix of:
 *   - Non-comic books from WoB feeds: Cicero, German poetry, Bach scores,
 *     cookbooks, textbooks. These should be deleted.
 *   - Real comics wrongly typed as OTHER: Superman titles, manga, Halo tie-ins.
 *     These should be reclassified, not deleted.
 *   - Ambiguous titles where neither classification is confident.
 *
 * This script REPORTS ONLY — no deletions, no modifications. Output:
 *   - scripts/delete-candidates.json     — Bucket A (confident non-comic)
 *   - scripts/reclassify-candidates.json — Bucket B (confident comic)
 *
 * After review, the user can authorise:
 *   1. Bulk delete of Bucket A (soft-delete via deleted_at column)
 *   2. Bulk format reclassification of Bucket B
 *
 * Safety override: any product with at least ONE active priced listing
 * (price > 0, retailer active, not soft-deleted) is demoted from Bucket A
 * to Bucket C, even if its title looks non-comic. Live sales = real product,
 * deserves human review before deletion.
 *
 * Usage:
 *   npm run cleanup:noncomics:dry
 */

import { PrismaClient } from '@prisma/client'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { classifyText, type ComicClassification } from '../lib/search/isLikelyComic'

const prisma = new PrismaClient()

// ── Types ─────────────────────────────────────────────────────────────────────

interface Candidate {
  id:                 string
  title:              string
  publisher:          string | null
  canonical_slug:     string
  active_listing_cnt: number
  max_price:          string | null   // Decimal as string
}

interface BucketEntry {
  id:            string
  title:         string
  publisher:     string | null
  canonicalSlug: string
  activeOffers:  number
  maxPrice:      number | null
  /** Why it landed in this bucket — useful for reviewing edge cases. */
  reason:        string
}

interface Buckets {
  A: BucketEntry[]   // Confident non-comic → DELETE candidates
  B: BucketEntry[]   // Confident comic     → KEEP + RECLASSIFY
  C: BucketEntry[]   // Uncertain or safety-overridden → KEEP, manual review
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Scanning canonical_products WHERE format=\'OTHER\' AND comicvine_id IS NULL …\n')

  // Single query: get all candidates + their active priced listing count + max price.
  // LEFT JOIN so products with zero listings are still returned.
  const rows = await prisma.$queryRaw<Candidate[]>`
    SELECT
      cp.id,
      cp.title,
      cp.publisher,
      cp.canonical_slug,
      COUNT(rl.id) FILTER (
        WHERE rl.price_amount > 0
          AND rl.deleted_at IS NULL
          AND ret.is_active = true
      )::int AS active_listing_cnt,
      MAX(rl.price_amount) FILTER (
        WHERE rl.price_amount > 0
          AND rl.deleted_at IS NULL
          AND ret.is_active = true
      )::text AS max_price
    FROM canonical_products cp
    LEFT JOIN retailer_listings rl ON rl.canonical_product_id = cp.id
    LEFT JOIN retailers ret         ON ret.id = rl.retailer_id
    WHERE cp.format::text = 'OTHER'
      AND cp.comicvine_id IS NULL
      AND cp.deleted_at IS NULL
    GROUP BY cp.id, cp.title, cp.publisher, cp.canonical_slug
  `

  console.log(`Total candidates: ${rows.length}\n`)

  const buckets: Buckets = { A: [], B: [], C: [] }
  let safetyOverrideCount = 0

  for (const r of rows) {
    // Classify on title + publisher concatenated, so publisher signals
    // (Marvel, DC, Viz) help disambiguate generic titles.
    const text       = `${r.title} ${r.publisher ?? ''}`.trim()
    const cls        = classifyText(text) as ComicClassification
    const hasListing = r.active_listing_cnt > 0
    const maxPrice   = r.max_price !== null ? parseFloat(r.max_price) : null

    const entry: BucketEntry = {
      id:            r.id,
      title:         r.title,
      publisher:     r.publisher,
      canonicalSlug: r.canonical_slug,
      activeOffers:  r.active_listing_cnt,
      maxPrice,
      reason:        '',
    }

    if (cls === 'non-comic') {
      // Safety override: a live priced listing means someone is selling it —
      // could be a mislabelled comic. Demote to C for human review.
      if (hasListing) {
        entry.reason = `non-comic title BUT ${r.active_listing_cnt} active priced listing(s) (max £${maxPrice?.toFixed(2) ?? '?'}) — safety hold`
        buckets.C.push(entry)
        safetyOverrideCount++
      } else {
        entry.reason = 'matched NON_COMIC_FLAGS + zero active priced listings'
        buckets.A.push(entry)
      }
    } else if (cls === 'comic') {
      entry.reason = 'matched COMIC_SIGNALS — wrongly typed as OTHER'
      buckets.B.push(entry)
    } else {
      entry.reason = hasListing
        ? `uncertain title, ${r.active_listing_cnt} active listing(s)`
        : 'uncertain title, no active listings'
      buckets.C.push(entry)
    }
  }

  // ── Report ────────────────────────────────────────────────────────────────
  const total = rows.length
  const pct = (n: number) => ((n / total) * 100).toFixed(1)

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('BUCKET A — Confident non-comic (DELETE candidates after review)')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log(`Count: ${buckets.A.length} (${pct(buckets.A.length)}%)`)
  console.log('Sample (50):')
  for (const e of buckets.A.slice(0, 50)) {
    const pubStr = e.publisher ? ` [${e.publisher}]` : ''
    console.log(`  ${e.title.slice(0, 75)}${pubStr}`.slice(0, 100))
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('BUCKET B — Confident comic (KEEP, reclassify format)')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log(`Count: ${buckets.B.length} (${pct(buckets.B.length)}%)`)
  console.log('Sample (50):')
  for (const e of buckets.B.slice(0, 50)) {
    const pubStr = e.publisher ? ` [${e.publisher}]` : ''
    const offers = e.activeOffers > 0 ? ` (${e.activeOffers} offers)` : ''
    console.log(`  ${e.title.slice(0, 70)}${pubStr}${offers}`.slice(0, 110))
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('BUCKET C — Uncertain or safety-held (KEEP, manual review)')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log(`Count: ${buckets.C.length} (${pct(buckets.C.length)}%)`)
  console.log(`  ↳ of which safety-overridden from A: ${safetyOverrideCount}`)
  console.log('Sample (30):')
  for (const e of buckets.C.slice(0, 30)) {
    const pubStr = e.publisher ? ` [${e.publisher}]` : ''
    const offers = e.activeOffers > 0 ? ` (${e.activeOffers} offers, max £${e.maxPrice?.toFixed(2) ?? '?'})` : ''
    console.log(`  ${e.title.slice(0, 70)}${pubStr}${offers}`.slice(0, 120))
  }

  // ── Write JSON files ──────────────────────────────────────────────────────
  const aPath = join(__dirname, 'delete-candidates.json')
  const bPath = join(__dirname, 'reclassify-candidates.json')

  writeFileSync(aPath, JSON.stringify(buckets.A, null, 2))
  writeFileSync(bPath, JSON.stringify(buckets.B, null, 2))

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('SUMMARY')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log(`  Total scanned:            ${total}`)
  console.log(`  Bucket A (delete):        ${buckets.A.length} (${pct(buckets.A.length)}%)`)
  console.log(`  Bucket B (reclassify):    ${buckets.B.length} (${pct(buckets.B.length)}%)`)
  console.log(`  Bucket C (manual review): ${buckets.C.length} (${pct(buckets.C.length)}%)`)
  console.log(`    ↳ safety-held from A:   ${safetyOverrideCount}`)
  console.log(`\n  Written to:`)
  console.log(`    ${aPath}`)
  console.log(`    ${bPath}`)
  console.log('\nNO DATA MODIFIED. Review the JSON files, then authorise actions.')

  await prisma.$disconnect()
}

main().catch(async e => {
  console.error('Cleanup scan failed:', e)
  await prisma.$disconnect()
  process.exit(1)
})
