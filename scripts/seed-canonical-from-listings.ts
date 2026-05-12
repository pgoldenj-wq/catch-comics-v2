#!/usr/bin/env tsx
/**
 * scripts/seed-canonical-from-listings.ts
 *
 * Backfills canonical_products for retailer_listings that have an isbn_13 but
 * no canonical_product_id.  Orders by listing count DESC so the highest-ROI
 * ISBNs are processed first.
 *
 * Usage:
 *   npm run seed:canonical
 *   npm run seed:canonical -- --batch-size 100
 *   npm run seed:canonical -- --resume          (skip ISBNs in checkpoint file)
 *   npm run seed:canonical -- --dry-run         (read-only, no DB writes)
 *
 * Env vars used:
 *   DATABASE_URL          — Prisma connection string (loaded by dotenv-cli)
 *   GOOGLE_BOOKS_API_KEY  — Optional; increases Google Books rate limit to 20/s
 */

import { prisma }               from '../lib/prisma'
import { enrichByIsbn }         from '../lib/enrichment/isbn'
import { inferFormat }          from '../lib/enrichment/isbn'
import type { EnrichmentResult } from '../lib/enrichment/isbn'
import { makeCanonicalSlug }    from '../lib/adapters/shared/matching'
import { MatchMethod }          from '@prisma/client'
import * as fs                  from 'fs'
import * as path                from 'path'

// ── Comics genre filter ───────────────────────────────────────────────────────
// World of Books sells all books. We only want to create canonical products for
// comics, graphic novels, manga, and similar sequential art formats.
// Reject anything that doesn't pass at least one of these signals.

const COMIC_PUBLISHERS = new Set([
  'marvel', 'marvel comics', 'dc comics', 'image comics', 'image', 'dark horse comics',
  'dark horse', 'idw publishing', 'idw', 'boom! studios', 'boom studios', 'oni press',
  'fantagraphics books', 'fantagraphics', 'drawn & quarterly', 'viz media', 'viz',
  'kodansha comics', 'kodansha', 'yen press', 'seven seas entertainment', 'seven seas',
  'tokyopop', 'square enix manga', 'square enix', 'shueisha', 'vertical comics', 'vertical',
  'titan comics', 'dynamite entertainment', 'dynamite', 'aftershock comics', 'aftershock',
  'vault comics', 'vault', 'scout comics', 'ahoy comics', 'top shelf productions',
  'humanoids', 'ablaze', 'valiant entertainment', 'valiant', 'archie comics', 'archie',
  'avatar press', 'zenescope', 'action lab', 'lion forge', 'oni-lion forge',
  'drawn and quarterly', 'fantagraphics books', 'pantheon books',
  'abrams comicarts', 'abrams', 'first second', 'graphix', 'scholastic graphix',
  'viz signature', 'dark horse manga', 'j-novel club', 'seven seas',
  'penguin comics', 'papercutz', 'eurocomics',
])

const COMIC_TITLE_KEYWORDS = [
  'graphic novel', 'comic book', 'manga', 'superhero', 'batman', 'spider-man',
  'avengers', 'x-men', 'justice league', 'collected edition', 'trade paperback',
  'comic strip', 'illustrated novel', 'anime', 'sequential art',
]

// Comic signals in Shopify product_type or tags (WoB and similar retailers)
const COMIC_SHOPIFY_TYPES = [
  'graphic novel', 'graphic novels', 'comic', 'comics', 'manga',
  'graphic', 'sequential art', 'anime', 'tpb', 'trade paperback',
]

/**
 * Quick pre-check using Shopify raw_data before calling enrichment API.
 * Returns true if product_type or tags clearly indicate comics.
 * Returns null if no signal found (needs enrichment to decide).
 */
function isLikelyComicFromShopifyData(
  productType: string | null,
  tagsJson: string | null,
): boolean | null {
  const type = (productType ?? '').toLowerCase()
  if (type && COMIC_SHOPIFY_TYPES.some(t => type.includes(t))) return true

  if (tagsJson) {
    try {
      const tags = JSON.parse(tagsJson) as string[]
      const tagStr = tags.join(' ').toLowerCase()
      if (COMIC_SHOPIFY_TYPES.some(t => tagStr.includes(t))) return true
      // World of Books uses "TYPE|<category>" format
      if (/type\|(comic|manga|graphic)/.test(tagStr)) return true
    } catch {
      // not valid JSON, ignore
    }
  }

  return null  // no signal — must rely on enrichment
}

function isLikelyComic(result: EnrichmentResult): boolean {
  // If enrichment detected a comic-specific format, it's a comic
  if (result.format !== null) return true

  // Check publisher name against known comics publishers
  const pub = (result.publisher ?? '').toLowerCase().trim()
  if (pub) {
    for (const known of COMIC_PUBLISHERS) {
      if (pub.includes(known)) return true
    }
  }

  // Check title and description for comic-specific keywords
  const text = `${result.title ?? ''} ${result.description ?? ''}`.toLowerCase()
  for (const kw of COMIC_TITLE_KEYWORDS) {
    if (text.includes(kw)) return true
  }

  return false
}

// ── CLI args ──────────────────────────────────────────────────────────────────

const args        = process.argv.slice(2)
const DRY_RUN     = args.includes('--dry-run')
const RESUME      = args.includes('--resume')
const BATCH_SIZE  = (() => {
  const idx = args.indexOf('--batch-size')
  return idx !== -1 ? parseInt(args[idx + 1] ?? '50', 10) : 50
})()
const RATE_MS     = 1_000   // 1 ISBN per second (Google Books polite limit)

const CHECKPOINT_PATH = path.join(__dirname, '.seed-checkpoint.json')

// ── Checkpoint helpers ────────────────────────────────────────────────────────

function loadCheckpoint(): Set<string> {
  if (!RESUME || !fs.existsSync(CHECKPOINT_PATH)) return new Set()
  try {
    const data = JSON.parse(fs.readFileSync(CHECKPOINT_PATH, 'utf-8')) as { completed: string[] }
    console.log(`[checkpoint] resuming — ${data.completed.length} ISBNs already processed`)
    return new Set(data.completed)
  } catch {
    return new Set()
  }
}

function saveCheckpoint(completed: Set<string>): void {
  if (DRY_RUN) return
  fs.writeFileSync(CHECKPOINT_PATH, JSON.stringify({ completed: [...completed] }, null, 2))
}

// ── Progress snapshot ─────────────────────────────────────────────────────────

async function snapshot(): Promise<{
  matched    : number
  seedable   : number
  unmatchable: number
  total      : number
}> {
  // Use raw SQL so this works before AND after the isbn13 column is added
  const rows = await prisma.$queryRaw<Array<{
    matched: bigint; seedable: bigint; unmatchable: bigint; total: bigint
  }>>`
    SELECT
      COUNT(*) FILTER (WHERE canonical_product_id IS NOT NULL)              AS matched,
      COUNT(*) FILTER (WHERE canonical_product_id IS NULL AND isbn_13 IS NOT NULL) AS seedable,
      COUNT(*) FILTER (WHERE canonical_product_id IS NULL AND isbn_13 IS NULL)     AS unmatchable,
      COUNT(*)                                                               AS total
    FROM retailer_listings
  `
  const r = rows[0]
  return {
    matched    : Number(r.matched),
    seedable   : Number(r.seedable),
    unmatchable: Number(r.unmatchable),
    total      : Number(r.total),
  }
}

function printSnapshot(label: string, s: Awaited<ReturnType<typeof snapshot>>): void {
  console.log(`\n── ${label} ──────────────────────────────────────────`)
  console.log(`  Matched     : ${s.matched.toLocaleString()}`)
  console.log(`  Seedable    : ${s.seedable.toLocaleString()}  (isbn13 present, no canonical)`)
  console.log(`  Unmatchable : ${s.unmatchable.toLocaleString()}  (no isbn13)`)
  console.log(`  Total       : ${s.total.toLocaleString()}`)
  console.log()
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${'═'.repeat(60)}`)
  console.log(` Catch Comics — Canonical Product Seed`)
  console.log(` Mode  : ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'}`)
  console.log(` Batch : ${BATCH_SIZE} ISBNs, rate-limited to 1/s`)
  console.log(` Resume: ${RESUME}`)
  console.log(`${'═'.repeat(60)}\n`)

  const before = await snapshot()
  printSnapshot('Before', before)

  // ── Find unmatched ISBNs ordered by listing count ─────────────────────────
  // Also fetch a sample of raw_data so we can check product_type and tags
  // before making an expensive enrichment API call.
  const rows = await prisma.$queryRaw<Array<{
    isbn13:        string
    listing_count: bigint
    product_type:  string | null
    tags:          string | null
  }>>`
    SELECT DISTINCT ON (isbn_13)
      isbn_13                                      AS isbn13,
      COUNT(*) OVER (PARTITION BY isbn_13)         AS listing_count,
      raw_data->>'product_type'                    AS product_type,
      (raw_data->'tags')::text                     AS tags
    FROM retailer_listings
    WHERE isbn_13 IS NOT NULL
      AND canonical_product_id IS NULL
    ORDER BY isbn_13, first_seen_at DESC
    LIMIT ${BATCH_SIZE * 10}
  `

  const checkpoint = loadCheckpoint()

  // Stats
  let processed  = 0
  let created    = 0
  let alreadyExisted = 0
  let linked     = 0
  let notFound   = 0
  let errors     = 0

  const startTime = Date.now()

  for (const row of rows) {
    const isbn13 = row.isbn13

    // Skip if already done in a previous run
    if (checkpoint.has(isbn13)) {
      continue
    }

    processed++

    // ── a. Quick Shopify metadata pre-check (avoids API call for obvious non-comics) ──
    const shopifySignal = isLikelyComicFromShopifyData(row.product_type, row.tags)
    if (shopifySignal === false) {
      // Shopify data explicitly signals non-comic (not just "no signal")
      // Currently no case returns false — reserved for future explicit exclusion
    }

    // ── b. Check for existing canonical ──────────────────────────────────────
    const existing = await prisma.canonicalProduct.findFirst({
      where : { isbn13 },
      select: { id: true },
    })

    let canonicalId: string | null = existing?.id ?? null

    if (!existing) {
      // ── b. Enrich from Google Books / Open Library ────────────────────────
      let enrichResult
      try {
        enrichResult = await enrichByIsbn(isbn13)
      } catch (err) {
        console.error(`  [${processed}] ✗ enrichment error for ${isbn13}:`, err)
        errors++
        await new Promise(r => setTimeout(r, RATE_MS))
        continue
      }

      if (enrichResult.source === 'none' || !enrichResult.title) {
        console.log(`  [${processed}] – ${isbn13}: no enrichment data`)
        notFound++
        checkpoint.add(isbn13)
        saveCheckpoint(checkpoint)
        await new Promise(r => setTimeout(r, RATE_MS))
        continue
      }

      // ── Genre filter — skip non-comic content ──────────────────────────────
      // shopifySignal=true means the Shopify product_type/tags confirm it's a comic;
      // skip the enrichment-based check in that case (trust the retailer's own category).
      if (shopifySignal !== true && !isLikelyComic(enrichResult)) {
        console.log(`  [${processed}] ✗ ${isbn13}: not a comic — "${enrichResult.title}" (publisher: ${enrichResult.publisher ?? 'unknown'})`)
        notFound++
        checkpoint.add(isbn13)
        saveCheckpoint(checkpoint)
        await new Promise(r => setTimeout(r, RATE_MS))
        continue
      }

      // ── c. Create canonical product ────────────────────────────────────────
      const title  = enrichResult.title!
      const format = enrichResult.format ?? inferFormat(title) ?? 'OTHER'
      const slug   = makeCanonicalSlug(title, isbn13)

      if (!DRY_RUN) {
        try {
          const product = await prisma.canonicalProduct.create({
            data: {
              isbn13,
              title,
              format,
              canonicalSlug : slug,
              subtitle      : enrichResult.subtitle      ?? null,
              publisher     : enrichResult.publisher     ?? null,
              releaseDate   : enrichResult.releaseDate   ?? null,
              description   : enrichResult.description   ?? null,
              coverImageUrl : enrichResult.coverImageUrl ?? null,
              seriesName    : enrichResult.seriesName    ?? null,
              volumeNumber  : enrichResult.volumeNumber  ?? null,
              isbn10        : null,
              ean           : null,
              comicvineId   : null,
              issueNumber   : null,
            },
            select: { id: true },
          })
          canonicalId = product.id
          created++
          console.log(`  [${processed}] + ${isbn13}: created "${title}" (${format})`)
        } catch (err) {
          // P2002 race condition — another process created it simultaneously
          const raceRow = await prisma.canonicalProduct.findFirst({ where: { isbn13 }, select: { id: true } })
          if (raceRow) {
            canonicalId = raceRow.id
            alreadyExisted++
          } else {
            console.error(`  [${processed}] ✗ create failed for ${isbn13}:`, err)
            errors++
            await new Promise(r => setTimeout(r, RATE_MS))
            continue
          }
        }
      } else {
        console.log(`  [${processed}] ~ ${isbn13}: would create "${title}" (${format}) [dry-run]`)
        created++
      }
    } else {
      alreadyExisted++
      console.log(`  [${processed}] = ${isbn13}: canonical already exists`)
    }

    // ── d. Link all unmatched listings for this ISBN ──────────────────────────
    if (!DRY_RUN && canonicalId) {
      // Raw SQL to work with the isbn_13 column regardless of Prisma client version
      const updateResult = await prisma.$executeRaw`
        UPDATE retailer_listings
        SET    canonical_product_id = ${canonicalId}::uuid,
               match_method         = 'ISBN',
               match_confidence     = 95
        WHERE  isbn_13              = ${isbn13}
          AND  canonical_product_id IS NULL
      `
      linked += updateResult
    } else if (DRY_RUN) {
      const rows = await prisma.$queryRaw<[{ n: bigint }]>`
        SELECT COUNT(*) AS n FROM retailer_listings
        WHERE isbn_13 = ${isbn13} AND canonical_product_id IS NULL
      `
      linked += Number(rows[0].n)
    }

    checkpoint.add(isbn13)
    if (processed % 10 === 0) saveCheckpoint(checkpoint)

    // Rate limit
    await new Promise(r => setTimeout(r, RATE_MS))
  }

  // Final checkpoint save
  saveCheckpoint(checkpoint)

  // ── Report ────────────────────────────────────────────────────────────────
  const after = DRY_RUN ? before : await snapshot()
  const elapsed = Date.now() - startTime

  console.log(`\n${'═'.repeat(60)}`)
  console.log(` Seed complete — ${(elapsed / 1000).toFixed(1)}s`)
  console.log(`${'═'.repeat(60)}`)
  console.log(`  ISBNs processed      : ${processed}`)
  console.log(`  Canonical created    : ${created}`)
  console.log(`  Already existed      : ${alreadyExisted}`)
  console.log(`  Listings linked      : ${linked}`)
  console.log(`  Enrichment not found : ${notFound}`)
  console.log(`  Errors               : ${errors}`)

  if (!DRY_RUN) {
    console.log()
    printSnapshot('After', after)
    const delta = after.matched - before.matched
    console.log(`  Matched delta: +${delta.toLocaleString()} listings`)
  }

  // Estimate remaining backlog
  const remaining = after.seedable - linked
  if (remaining > 0 && processed > 0) {
    const ratePerHour = (processed / (elapsed / 1000)) * 3600
    const hoursRemaining = remaining / ratePerHour
    console.log(`\n  Remaining backlog    : ~${remaining.toLocaleString()} listings`)
    console.log(`  Estimated time       : ~${hoursRemaining.toFixed(1)} hours at current rate`)
    console.log(`  Tip: Run with --batch-size ${BATCH_SIZE * 4} and a GOOGLE_BOOKS_API_KEY for faster processing`)
  }

  console.log()
}

main()
  .catch(err => { console.error('Fatal error:', err); process.exit(1) })
  .finally(() => prisma.$disconnect())
