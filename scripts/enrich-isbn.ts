/**
 * ISBN metadata enrichment CLI.
 *
 * Usage:
 *   # Enrich a single ISBN (dry-run — prints result, does not write to DB)
 *   npm run enrich:isbn -- <isbn13>
 *
 *   # Enrich all pending canonical products (up to --batch rows)
 *   npm run enrich:isbn -- --batch [N]
 *
 * Options:
 *   --batch [N]   Run bulk enrichment. N defaults to 50.
 *   --write       Actually apply enrichment to DB (default: dry-run for single ISBN)
 *   --no-cache    Skip the DB cache and always call the API (useful for debugging)
 */

import {
  enrichByIsbn,
  enrichPendingProducts,
  applyEnrichment,
  inferFormat,
  extractSeriesVolume,
} from '../lib/enrichment/isbn'
import { prisma } from '../lib/prisma'

// ── Arg parsing ───────────────────────────────────────────────────────────────

const args         = process.argv.slice(2)
const batchMode    = args.includes('--batch')
const writeMode    = args.includes('--write')
const noCacheMode  = args.includes('--no-cache')

const batchIdx = args.indexOf('--batch')
const batchSize =
  batchIdx !== -1 && !isNaN(Number(args[batchIdx + 1]))
    ? parseInt(args[batchIdx + 1], 10)
    : 50

const isbnArg = args.find(a => /^\d{13}$/.test(a))

// ── Helpers ───────────────────────────────────────────────────────────────────

async function bustCache(isbn13: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE metadata_cache
    SET expires_at = NOW() - INTERVAL '1 second'
    WHERE isbn_13 = ${isbn13}
  `
}

function fmt(value: unknown): string {
  if (value == null) return '(none)'
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'string' && value.length > 80) return value.slice(0, 80) + '…'
  return String(value)
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!batchMode && !isbnArg) {
    console.error(
      'Usage:\n' +
      '  enrich-isbn <isbn13>          — dry-run single ISBN\n' +
      '  enrich-isbn <isbn13> --write  — enrich single ISBN and save to DB\n' +
      '  enrich-isbn --batch [N]       — enrich up to N pending products\n'
    )
    throw new Error('Missing arguments')
  }

  // ── Single ISBN mode ───────────────────────────────────────────────────────
  if (!batchMode && isbnArg) {
    console.log(`\n🔍  Enriching ISBN ${isbnArg}…\n`)

    if (noCacheMode) {
      await bustCache(isbnArg)
      console.log('  (cache busted — forcing fresh API call)\n')
    }

    const result = await enrichByIsbn(isbnArg)

    console.log(`  Source       : ${result.source}`)
    console.log(`  Title        : ${fmt(result.title)}`)
    console.log(`  Subtitle     : ${fmt(result.subtitle)}`)
    console.log(`  Publisher    : ${fmt(result.publisher)}`)
    console.log(`  Release date : ${fmt(result.releaseDate)}`)
    console.log(`  Format       : ${fmt(result.format)}`)
    console.log(`  Series name  : ${fmt(result.seriesName)}`)
    console.log(`  Volume #     : ${fmt(result.volumeNumber)}`)
    console.log(`  Description  : ${fmt(result.description)}`)
    console.log(`  Cover URL    : ${fmt(result.coverImageUrl)}`)

    if (result.source === 'none') {
      console.log('\n  ⚠  No metadata found from any source.')
    } else if (writeMode) {
      // Find the canonical product for this ISBN
      const product = await prisma.canonicalProduct.findFirst({
        where: { isbn13: isbnArg },
        select: { id: true, title: true },
      })

      if (!product) {
        console.log('\n  ⚠  No canonical product found for this ISBN — nothing written.')
      } else {
        const updated = await applyEnrichment(product.id, result)
        if (updated) {
          console.log(`\n  ✅  Applied enrichment to "${product.title}" (${product.id})`)
        } else {
          console.log(`\n  ℹ  No new fields to fill for "${product.title}" (already enriched)`)
        }
      }
    } else {
      console.log('\n  (dry-run — pass --write to apply enrichment to DB)')
    }

    console.log()
  }

  // ── Batch mode ─────────────────────────────────────────────────────────────
  if (batchMode) {
    console.log(`\n📚  Enriching up to ${batchSize} pending products…\n`)
    const summary = await enrichPendingProducts(batchSize, noCacheMode)
    console.log(`  Processed : ${summary.processed}`)
    console.log(`  Enriched  : ${summary.enriched}`)
    console.log(`  Skipped   : ${summary.skipped}   (already fully enriched)`)
    console.log(`  Not found : ${summary.notFound}  (API returned no data)`)
    console.log(`  Errors    : ${summary.errors}`)
    console.log()
  }
}

main()
  .catch(err => { console.error('\n❌ ', err.message ?? err); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
