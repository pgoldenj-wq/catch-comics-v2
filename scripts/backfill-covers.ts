/**
 * backfill-covers — Open Library / Google Books cover backfill.
 *
 * Targets canonical_products with cover_image_url IS NULL that DO have an
 * isbn_13. Tries Open Library first (free, generally good), Google Books
 * second (also free, more variable). Validates dimensions ≥50×50 via sharp
 * in downloadAndStoreCoverWithFallback().
 *
 * Designed to be run AFTER enrich-catalogue-cv.ts has had its full pass.
 * That script handles cover sourcing for products it can match to CV; this
 * script handles the remainder — usually collected editions / manga with
 * ISBNs but no successful CV match.
 *
 * Rate: Open Library doesn't publish a hard rate cap but politeness =
 * 1 request/second. With 10 concurrent workers that's effective ~10/sec.
 * Resumable via scripts/.backfill-covers-checkpoint.json
 *
 * Modes:
 *   --dry-run     report how many products would be attempted, no DB writes
 *   --limit N     max products this run (default 500)
 *   --reset       wipe checkpoint
 *   --report      print checkpoint stats and exit
 *
 * Usage:
 *   npm run backfill:covers:dry           — report count, no writes
 *   npm run backfill:covers -- --limit 100 — real run, capped at 100
 */

import { PrismaClient } from '@prisma/client'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { downloadAndStoreCoverWithFallback } from '../lib/images/download'

const prisma = new PrismaClient()

interface Args {
  limit:  number
  dryRun: boolean
  reset:  boolean
  report: boolean
}

function parseArgs(): Args {
  const argv = process.argv.slice(2)
  const args: Args = { limit: 500, dryRun: false, reset: false, report: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--limit')               args.limit = parseInt(argv[++i] ?? '500', 10)
    else if (a.startsWith('--limit=')) args.limit = parseInt(a.split('=')[1], 10)
    else if (a === '--dry-run') args.dryRun = true
    else if (a === '--reset')   args.reset = true
    else if (a === '--report')  args.report = true
  }
  return args
}

const CHECKPOINT_PATH = join(__dirname, '.backfill-covers-checkpoint.json')

interface Checkpoint {
  startedAt: string
  lastUpdatedAt: string
  processedIds: string[]
  stats: { seen: number; recovered: number; failed: number }
}

function loadCheckpoint(): Checkpoint {
  if (existsSync(CHECKPOINT_PATH)) {
    try { return JSON.parse(readFileSync(CHECKPOINT_PATH, 'utf8')) } catch {}
  }
  return {
    startedAt: new Date().toISOString(), lastUpdatedAt: new Date().toISOString(),
    processedIds: [], stats: { seen: 0, recovered: 0, failed: 0 },
  }
}

function saveCheckpoint(c: Checkpoint) {
  c.lastUpdatedAt = new Date().toISOString()
  writeFileSync(CHECKPOINT_PATH, JSON.stringify(c, null, 2))
}

async function dryRunReport() {
  const total = await prisma.$queryRaw<Array<{ cnt: number }>>`
    SELECT COUNT(*)::int AS cnt FROM canonical_products
    WHERE cover_image_url IS NULL AND deleted_at IS NULL
  `
  const withIsbn = await prisma.$queryRaw<Array<{ cnt: number }>>`
    SELECT COUNT(*)::int AS cnt FROM canonical_products
    WHERE cover_image_url IS NULL AND deleted_at IS NULL
      AND isbn_13 IS NOT NULL
  `
  const noIsbn = total[0].cnt - withIsbn[0].cnt

  // Sample 10 to show what would be tried
  const sample = await prisma.$queryRaw<Array<{ title: string; isbn_13: string; publisher: string | null }>>`
    SELECT title, isbn_13, publisher FROM canonical_products
    WHERE cover_image_url IS NULL AND deleted_at IS NULL
      AND isbn_13 IS NOT NULL
    ORDER BY RANDOM() LIMIT 10
  `

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('COVER BACKFILL — DRY RUN')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log(`  Total products with NULL cover:        ${total[0].cnt}`)
  console.log(`  ↳ with ISBN-13 (Open Library candidates): ${withIsbn[0].cnt}`)
  console.log(`  ↳ without ISBN (cannot backfill):         ${noIsbn}`)
  console.log('')
  console.log(`  Estimated time (10 workers, 1s polite delay): ${Math.round(withIsbn[0].cnt / 10)} seconds ≈ ${(withIsbn[0].cnt / 10 / 60).toFixed(1)} minutes`)
  console.log('')
  console.log('  Sample of products that would be attempted:')
  sample.forEach((s, i) => {
    console.log(`    ${i+1}. ${s.title.slice(0,60)} [ISBN ${s.isbn_13}] ${s.publisher ?? ''}`)
  })
  console.log('')
  console.log('  No data modified — this is a dry run.')
  console.log(`  To run for real: npm run backfill:covers -- --limit ${Math.min(withIsbn[0].cnt, 500)}`)

  await prisma.$disconnect()
}

async function reportProgress() {
  const cp = loadCheckpoint()
  console.log(`Checkpoint:`)
  console.log(`  startedAt:    ${cp.startedAt}`)
  console.log(`  lastUpdate:   ${cp.lastUpdatedAt}`)
  console.log(`  processed:    ${cp.processedIds.length}`)
  console.log(`  recovered:    ${cp.stats.recovered}`)
  console.log(`  failed:       ${cp.stats.failed}`)
  await prisma.$disconnect()
}

async function realRun(args: Args) {
  let cp = loadCheckpoint()
  if (args.reset) {
    cp = { startedAt: new Date().toISOString(), lastUpdatedAt: new Date().toISOString(), processedIds: [], stats: { seen: 0, recovered: 0, failed: 0 } }
    saveCheckpoint(cp)
  }
  const processed = new Set(cp.processedIds)

  const candidates = await prisma.$queryRaw<Array<{ id: string; isbn_13: string; title: string }>>`
    SELECT id, isbn_13, title FROM canonical_products
    WHERE cover_image_url IS NULL AND deleted_at IS NULL
      AND isbn_13 IS NOT NULL
    ORDER BY (publisher IS NOT NULL) DESC, updated_at DESC NULLS LAST, id
    LIMIT ${BigInt(Math.min(args.limit * 2, 50000))}
  `
  const pool = candidates.filter(c => !processed.has(c.id)).slice(0, args.limit)
  console.log(`Pool: ${candidates.length} raw, ${pool.length} unprocessed selected.`)

  // 10 concurrent workers, each polite 1s between requests
  const concurrency = 10
  const queue = [...pool]
  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length > 0) {
      const c = queue.shift()
      if (!c) break
      cp.stats.seen++
      const result = await downloadAndStoreCoverWithFallback(c.id, { isbn13: c.isbn_13 })
      if (result) cp.stats.recovered++; else cp.stats.failed++
      processed.add(c.id)
      // Save checkpoint every 25 products
      if (cp.stats.seen % 25 === 0) {
        cp.processedIds = [...processed]
        saveCheckpoint(cp)
        console.log(`  …${cp.stats.seen} seen, ${cp.stats.recovered} recovered, ${cp.stats.failed} failed`)
      }
      await new Promise(r => setTimeout(r, 1000))
    }
  })
  await Promise.all(workers)
  cp.processedIds = [...processed]
  saveCheckpoint(cp)

  console.log(`\nDone. seen=${cp.stats.seen} recovered=${cp.stats.recovered} failed=${cp.stats.failed}`)
  await prisma.$disconnect()
}

async function main() {
  const args = parseArgs()
  if (args.report)  { await reportProgress(); return }
  if (args.dryRun)  { await dryRunReport();   return }
  await realRun(args)
}
main().catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1) })
