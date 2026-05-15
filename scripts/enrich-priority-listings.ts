/**
 * Targeted enrichment retry for live (active-listing) canonical products
 * that are still missing publisher OR cover_image_url despite prior enrichment runs.
 *
 * WHY THIS SCRIPT EXISTS
 * ----------------------
 * enrichPendingProducts() selects products missing description OR cover — a
 * reasonable signal, but it does NOT guarantee publisher gets filled.
 * More critically: ~99% of priority products already have a valid (non-expired)
 * metadata_cache entry. When the API returned nothing the first time the result
 * was cached as { result: null }, so subsequent runs hit the cache and still
 * find nothing. This script forces a fresh API call (bypassing the cache) for
 * every product so genuinely retrievable data is not permanently blocked by a
 * stale "no data" cache entry.
 *
 * Usage:
 *   # Dry-run (default): shows what would be updated, writes nothing
 *   npx tsx --env-file=.env.local scripts/enrich-priority-listings.ts
 *
 *   # Actually write enrichment to DB
 *   npx tsx --env-file=.env.local scripts/enrich-priority-listings.ts --write
 *
 *   # Limit run (max 50 per run to respect API rate limits)
 *   npx tsx --env-file=.env.local scripts/enrich-priority-listings.ts --write --limit 25
 *
 *   # Skip the cache bypass (use cached API responses — faster, but may miss stale nulls)
 *   npx tsx --env-file=.env.local scripts/enrich-priority-listings.ts --write --use-cache
 *
 * Options:
 *   --write        Apply enrichment to DB (default: dry-run)
 *   --limit N      Process at most N products (default: 50, hard max: 50)
 *   --use-cache    Do NOT bypass metadata_cache (use cached results as-is)
 *   --offset N     Skip the first N priority products (for resuming / pagination)
 *
 * Rate limits:
 *   Google Books: 20 req/s with key, 1 req/s without
 *   Open Library: 1 req/s
 *   This script adds a 1-second inter-product delay as an outer guard regardless.
 */

import { PrismaClient }     from '@prisma/client'
import { applyEnrichment }  from '../lib/enrichment/isbn'

// ── Types ─────────────────────────────────────────────────────────────────────

interface PriorityProduct {
  id            : string
  title         : string
  isbn13        : string
  publisher     : string | null
  coverImageUrl : string | null
  listingCount  : number
}

// ── Arg parsing ───────────────────────────────────────────────────────────────

const args       = process.argv.slice(2)
const writeMode  = args.includes('--write')
const useCache   = args.includes('--use-cache')

const limitIdx   = args.indexOf('--limit')
const rawLimit   = limitIdx !== -1 ? parseInt(args[limitIdx + 1] ?? '', 10) : 50
const LIMIT      = Math.min(isNaN(rawLimit) ? 50 : rawLimit, 50)  // hard cap at 50

const offsetIdx  = args.indexOf('--offset')
const OFFSET     = offsetIdx !== -1 ? (parseInt(args[offsetIdx + 1] ?? '0', 10) || 0) : 0

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

function fmt(value: unknown): string {
  if (value == null) return '(none)'
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'string' && value.length > 80) return value.slice(0, 80) + '…'
  return String(value)
}

// ── Cache bypass ──────────────────────────────────────────────────────────────

/**
 * Delete (or expire) cache entries for a given isbn13 so that enrichByIsbn()
 * is forced to call the live API on the next invocation.
 */
async function bustCache(prisma: PrismaClient, isbn13: string): Promise<void> {
  // Set expires_at to the past — readCache() treats expired entries as cache misses.
  // This is safer than DELETE: the row persists for debugging but is no longer served.
  await prisma.$executeRaw`
    UPDATE metadata_cache
    SET expires_at = NOW() - INTERVAL '1 second'
    WHERE isbn_13 = ${isbn13}
  `
}

// ── Priority product selection ────────────────────────────────────────────────

async function fetchPriorityProducts(
  prisma: PrismaClient,
  limit : number,
  offset: number,
): Promise<PriorityProduct[]> {
  // Select canonical products that:
  //   1. Have an isbn_13 (enrichable)
  //   2. Have at least one active (non-deleted) retailer listing
  //   3. Are still missing publisher OR cover_image_url
  // Sorted by listing count DESC so the most-seen products are retried first.
  const rows = await prisma.$queryRaw<Array<{
    id            : string
    title         : string
    isbn_13       : string
    publisher     : string | null
    cover_image_url: string | null
    listing_count : bigint
  }>>`
    SELECT
      cp.id,
      cp.title,
      cp.isbn_13,
      cp.publisher,
      cp.cover_image_url,
      COUNT(rl.id) AS listing_count
    FROM canonical_products cp
    INNER JOIN retailer_listings rl
      ON rl.canonical_product_id = cp.id
      AND rl.deleted_at IS NULL
    WHERE cp.isbn_13 IS NOT NULL
      AND (cp.publisher IS NULL OR cp.cover_image_url IS NULL)
    GROUP BY cp.id, cp.title, cp.isbn_13, cp.publisher, cp.cover_image_url
    ORDER BY listing_count DESC, cp.title ASC
    LIMIT ${limit}
    OFFSET ${offset}
  `

  return rows.map(r => ({
    id           : r.id,
    title        : r.title,
    isbn13       : r.isbn_13,
    publisher    : r.publisher,
    coverImageUrl: r.cover_image_url,
    listingCount : Number(r.listing_count),
  }))
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // Lazy import enrichByIsbn here so we can control the environment before loading
  const { enrichByIsbn } = await import('../lib/enrichment/isbn')

  const prisma = new PrismaClient()

  try {
    // 1. Count total priority backlog for context
    const [totalRow] = await prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(DISTINCT cp.id) AS count
      FROM canonical_products cp
      INNER JOIN retailer_listings rl
        ON rl.canonical_product_id = cp.id
        AND rl.deleted_at IS NULL
      WHERE cp.isbn_13 IS NOT NULL
        AND (cp.publisher IS NULL OR cp.cover_image_url IS NULL)
    `
    const totalBacklog = Number(totalRow.count)

    console.log('\n=== enrich-priority-listings ===')
    console.log(`Mode       : ${writeMode ? 'WRITE' : 'DRY-RUN (pass --write to apply changes)'}`)
    console.log(`Cache      : ${useCache  ? 'USE CACHED RESULTS' : 'BYPASS (force fresh API calls)'}`)
    console.log(`Limit      : ${LIMIT} products per run (hard cap: 50)`)
    console.log(`Offset     : ${OFFSET}`)
    console.log(`Total backlog: ${totalBacklog} products with active listings still missing publisher or cover`)
    console.log()

    // 2. Fetch this run's batch
    const products = await fetchPriorityProducts(prisma, LIMIT, OFFSET)

    if (products.length === 0) {
      console.log('Nothing to process — all priority products are already enriched.')
      return
    }

    console.log(`Processing ${products.length} products (offset ${OFFSET}):\n`)

    // 3. Counters
    let enriched  = 0
    let notFound  = 0
    let skipped   = 0
    let errors    = 0

    for (let i = 0; i < products.length; i++) {
      const p = products[i]
      const label = `[${i + 1}/${products.length}]`
      const missing: string[] = []
      if (!p.publisher)     missing.push('publisher')
      if (!p.coverImageUrl) missing.push('cover')
      const missingStr = missing.join(', ')

      process.stdout.write(
        `${label} "${p.title.slice(0, 55)}" (${p.isbn13}) — missing: ${missingStr} … `
      )

      try {
        // Optionally bust the cache so the live API is called
        if (!useCache) {
          await bustCache(prisma, p.isbn13)
        }

        const result = await enrichByIsbn(p.isbn13)

        if (result.source === 'none') {
          console.log('NOT FOUND (API has no data)')
          notFound++
          continue
        }

        // Show what we got
        const gained: string[] = []
        if (!p.publisher     && result.publisher)     gained.push(`publisher="${result.publisher}"`)
        if (!p.coverImageUrl && result.coverImageUrl) gained.push('cover=YES')

        if (gained.length === 0) {
          console.log(`source=${result.source} — nothing new to fill`)
          skipped++
          continue
        }

        console.log(`source=${result.source} — gained: ${gained.join(', ')}`)

        if (writeMode) {
          const updated = await applyEnrichment(p.id, result)
          if (updated) enriched++
          else         skipped++
        } else {
          enriched++  // count as "would enrich" in dry-run
        }
      } catch (err) {
        console.log(`ERROR — ${(err as Error).message ?? err}`)
        errors++
      }

      // 1-second inter-product delay (outer guard for both APIs)
      if (i < products.length - 1) {
        await sleep(1000)
      }
    }

    // 4. Summary
    console.log('\n=== Summary ===')
    if (writeMode) {
      console.log(`  Enriched  : ${enriched}  (fields written to DB)`)
    } else {
      console.log(`  Would enrich: ${enriched}  (dry-run — pass --write to apply)`)
    }
    console.log(`  Skipped   : ${skipped}  (API found data but no new fields to add)`)
    console.log(`  Not found : ${notFound}  (both APIs returned no data)`)
    console.log(`  Errors    : ${errors}`)
    console.log()

    if (!writeMode && enriched > 0) {
      console.log('Re-run with --write to apply enrichment to the DB.')
    }

    const remaining = totalBacklog - (OFFSET + products.length)
    if (remaining > 0) {
      console.log(
        `Remaining backlog: ~${remaining} products. ` +
        `Next run: --offset ${OFFSET + products.length}`
      )
    } else {
      console.log('All priority products in backlog processed.')
    }
    console.log()
  } finally {
    await prisma.$disconnect()
  }
}

main().catch(err => {
  console.error('\nFatal:', err.message ?? err)
  process.exitCode = 1
})
