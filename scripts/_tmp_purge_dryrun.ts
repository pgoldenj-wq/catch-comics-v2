/**
 * LANE 3: Non-comic canonical purge — DRY RUN ONLY.
 * Identifies candidates, returns count + sample. Zero writes.
 *
 * Purge criteria (ALL must be true):
 *   1. format = 'OTHER'
 *   2. No Travelling Man listing (any price)
 *   3. All retailer listings come from WoB and/or Wordery only
 *   4. deleted_at IS NULL (not already purged)
 */
import { prisma } from '../lib/prisma'

async function main() {
  console.log('\n══════════════════════════════════════════════════════════')
  console.log(' LANE 3: Non-Comic Purge — DRY RUN')
  console.log('══════════════════════════════════════════════════════════\n')

  // Count candidates
  const candidates = await prisma.$queryRaw<Array<{
    id: string; title: string; isbn13: string | null; format: string;
    retailers: string; listing_count: number;
  }>>`
    SELECT
      cp.id, cp.title, cp.isbn_13 AS isbn13, cp.format::text,
      STRING_AGG(DISTINCT r.domain, ', ') AS retailers,
      COUNT(rl.id)::int AS listing_count
    FROM canonical_products cp
    JOIN retailer_listings rl ON rl.canonical_product_id = cp.id
    JOIN retailers r ON r.id = rl.retailer_id
    WHERE cp.deleted_at IS NULL
      AND cp.format = 'OTHER'
      AND NOT EXISTS (
        SELECT 1 FROM retailer_listings t
        JOIN retailers tr ON tr.id = t.retailer_id
        WHERE tr.domain = 'travellingman.com'
          AND t.canonical_product_id = cp.id
          AND t.deleted_at IS NULL
      )
    GROUP BY cp.id, cp.title, cp.isbn_13, cp.format
    HAVING bool_and(r.domain IN ('worldofbooks.com', 'wordery.com'))
    ORDER BY cp.title ASC
  `

  console.log(`Total purge candidates: ${candidates.length.toLocaleString()}\n`)

  // Confidence assessment
  const comicKeywords = /volume|vol\b|manga|graphic novel|omnibus|collection|tpb|trade paper|issue|comic|superhero|batman|spider|marvel|dc comics/i
  const definitelyNot = candidates.filter(c => !comicKeywords.test(c.title))
  const maybeComic    = candidates.filter(c => comicKeywords.test(c.title))

  console.log(`Confidence assessment:`)
  console.log(`  Definitely non-comic (no comic keywords): ${definitelyNot.length.toLocaleString()}  [HIGH confidence purge]`)
  console.log(`  Has comic keywords (needs review)        : ${maybeComic.length.toLocaleString()}  [REVIEW before purge]`)

  console.log(`\n── Sample: definite non-comics (first 30) ───────────────`)
  for (const c of definitelyNot.slice(0, 30)) {
    console.log(`  "${c.title.slice(0, 65)}"`)
  }

  if (maybeComic.length > 0) {
    console.log(`\n── Sample: possible comics (first 10) ───────────────────`)
    for (const c of maybeComic.slice(0, 10)) {
      console.log(`  "${c.title.slice(0, 65)}"  [retailers: ${c.retailers}]`)
    }
  }

  // Safe purge = definitely non-comic only
  console.log(`\n── Recommendation ───────────────────────────────────────`)
  console.log(`  Safe to purge (definite non-comic): ${definitelyNot.length.toLocaleString()}`)
  console.log(`  Hold for review:                    ${maybeComic.length.toLocaleString()}`)
  console.log(`\n  Effect: removes ~${definitelyNot.length} junk canonicals from the platform.`)
  console.log(`  These products will disappear from search and any non-TM comparison pages.`)
  console.log(`  TM-linked pages are SAFE — TM listing presence excludes from this query.`)
  console.log(`\n  To execute: add --write flag to this script.`)
  console.log('══════════════════════════════════════════════════════════\n')
}
main().catch(console.error).finally(() => prisma.$disconnect())
