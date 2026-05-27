/**
 * scripts/migrate-covers.ts
 *
 * Bulk-migrates all external cover_image_url values in canonical_products
 * to self-hosted Cloudflare R2 URLs.
 *
 * Usage:
 *   npm run migrate:covers               # dry run (safe, no writes)
 *   npm run migrate:covers -- --write    # real migration
 *   npm run migrate:covers -- --write --limit 10   # test 10 images first
 *
 * Features:
 *   - Priority order: CV → AWIN → Google → OL → other
 *   - 10 concurrent downloads per batch, 500ms between batches
 *   - Checkpoint file: skips already-migrated IDs on resume
 *   - Never throws — failed images are logged and skipped
 */

import * as fs   from 'fs'
import * as path from 'path'
import { prisma }                  from '../lib/prisma'
import { downloadAndStoreCover, isAlreadyHosted } from '../lib/images/download'

// ── Args ──────────────────────────────────────────────────────────────────────

const WRITE_MODE = process.argv.includes('--write')
const LIMIT_ARG  = process.argv.indexOf('--limit')
const LIMIT      = LIMIT_ARG !== -1 ? parseInt(process.argv[LIMIT_ARG + 1], 10) : Infinity

const BATCH_SIZE   = 10
const BATCH_DELAY  = 500   // ms between batches
const PROGRESS_EVERY = 25  // log every N images

const CHECKPOINT_PATH = path.join(__dirname, '.cover-migration-checkpoint.json')

// ── Checkpoint ────────────────────────────────────────────────────────────────

function loadCheckpoint(): Set<string> {
  try {
    if (fs.existsSync(CHECKPOINT_PATH)) {
      const ids = JSON.parse(fs.readFileSync(CHECKPOINT_PATH, 'utf8')) as string[]
      return new Set(ids)
    }
  } catch {}
  return new Set()
}

function saveCheckpoint(done: Set<string>): void {
  fs.writeFileSync(CHECKPOINT_PATH, JSON.stringify([...done], null, 2))
}

// ── Source label ──────────────────────────────────────────────────────────────

function sourceLabel(url: string): string {
  if (url.includes('comicvine'))       return 'ComicVine'
  if (url.includes('productserve') ||
      url.includes('awin'))            return 'AWIN'
  if (url.includes('google'))          return 'Google'
  if (url.includes('openlibrary'))     return 'Open Library'
  if (url.includes('r2.dev') ||
      url.includes('cloudflarestorage')) return 'R2 (already hosted)'
  return 'Other'
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('')
  console.log('══════════════════════════════════════════════════════════')
  console.log(' Catch Comics — Cover Migration to R2')
  console.log(` Mode    : ${WRITE_MODE ? 'WRITE (uploading to R2)' : 'DRY RUN (no uploads)'}`)
  if (LIMIT !== Infinity) console.log(` Limit   : ${LIMIT}`)
  console.log(' Batch   : 10 concurrent, 500ms gap')
  console.log('══════════════════════════════════════════════════════════')
  console.log('')

  // ── Query products ─────────────────────────────────────────────────────────
  // Priority: CV → AWIN → Google → OL → other
  // Excludes already-hosted R2 URLs and nulls
  const products = await prisma.$queryRaw<
    Array<{ id: string; cover_image_url: string; title: string }>
  >`
    SELECT id, cover_image_url, title
    FROM canonical_products
    WHERE cover_image_url IS NOT NULL
      AND cover_image_url NOT LIKE '%r2.dev%'
      AND cover_image_url NOT LIKE '%cloudflarestorage%'
      AND deleted_at IS NULL
    ORDER BY
      CASE
        WHEN cover_image_url LIKE '%comicvine%'    THEN 1
        WHEN cover_image_url LIKE '%productserve%' THEN 2
        WHEN cover_image_url LIKE '%google%'       THEN 3
        WHEN cover_image_url LIKE '%openlibrary%'  THEN 4
        ELSE 5
      END,
      updated_at DESC
  `

  // ── Source breakdown ───────────────────────────────────────────────────────
  const bySource = new Map<string, number>()
  for (const p of products) {
    const src = sourceLabel(p.cover_image_url)
    bySource.set(src, (bySource.get(src) ?? 0) + 1)
  }

  console.log(`  Total with external covers : ${products.length}`)
  for (const [src, n] of [...bySource.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${n.toString().padStart(6)}  ${src}`)
  }

  // ── Checkpoint ─────────────────────────────────────────────────────────────
  const done = loadCheckpoint()
  const remaining = products.filter(p => !done.has(p.id))
  const toProcess = LIMIT !== Infinity ? remaining.slice(0, LIMIT) : remaining

  if (done.size > 0) {
    console.log(`\n  Checkpoint: ${done.size} already migrated — skipping`)
  }
  console.log(`  To process : ${toProcess.length}`)

  // ── Dry-run report ─────────────────────────────────────────────────────────
  if (!WRITE_MODE) {
    const avgKb    = 45    // ~45 KB per WebP cover (empirical estimate)
    const totalMb  = Math.round(toProcess.length * avgKb / 1024)
    const batchSec = (BATCH_SIZE * 1.2 + BATCH_DELAY / 1000)
    const totalMin = Math.round((toProcess.length / BATCH_SIZE) * batchSec / 60)

    console.log('')
    console.log('── DRY RUN REPORT ───────────────────────────────────────')
    console.log(`  Images to download & upload : ${toProcess.length}`)
    console.log(`  Estimated storage           : ~${totalMb} MB`)
    console.log(`  Estimated time              : ~${totalMin} min`)
    console.log(`  Batch size                  : ${BATCH_SIZE} concurrent`)
    console.log(`  R2 bucket                   : ${process.env.R2_BUCKET_NAME}`)
    console.log(`  R2 public URL               : ${process.env.R2_PUBLIC_URL}`)
    console.log('')
    console.log('  Source breakdown:')
    for (const [src, n] of [...bySource.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${n.toString().padStart(6)}  ${src}`)
    }
    console.log('')
    console.log('  Sample URLs (first 5):')
    toProcess.slice(0, 5).forEach(p => {
      console.log(`    [${sourceLabel(p.cover_image_url).padEnd(12)}] ${p.title.slice(0, 50)}`)
      console.log(`      ${p.cover_image_url}`)
    })
    console.log('')
    console.log('  Run with --write to start the real migration.')
    console.log('══════════════════════════════════════════════════════════')
    await prisma.$disconnect()
    return
  }

  // ── Real migration ─────────────────────────────────────────────────────────
  console.log('')

  let success = 0
  let failed  = 0
  const failReasons = new Map<string, number>()
  const sampleUrls: string[] = []
  const startTime = Date.now()

  for (let i = 0; i < toProcess.length; i += BATCH_SIZE) {
    const batch = toProcess.slice(i, i + BATCH_SIZE)

    const results = await Promise.all(
      batch.map(async p => {
        const r2Url = await downloadAndStoreCover(p.id, p.cover_image_url)
        return { p, r2Url }
      })
    )

    for (const { p, r2Url } of results) {
      if (r2Url) {
        success++
        done.add(p.id)
        if (sampleUrls.length < 3) sampleUrls.push(r2Url)
      } else {
        failed++
        const reason = sourceLabel(p.cover_image_url)
        failReasons.set(reason, (failReasons.get(reason) ?? 0) + 1)
      }
    }

    saveCheckpoint(done)

    const processed = Math.min(i + BATCH_SIZE, toProcess.length)

    if (processed % PROGRESS_EVERY < BATCH_SIZE || processed === toProcess.length) {
      const elapsed  = (Date.now() - startTime) / 1000
      const rate     = processed / elapsed            // images/sec
      const remaining = toProcess.length - processed
      const etaSec   = rate > 0 ? remaining / rate : 0
      const etaMin   = Math.round(etaSec / 60)
      console.log(
        `  ✓ ${processed}/${toProcess.length} — ${success} success, ${failed} failed` +
        (etaMin > 0 ? ` — ~${etaMin} min remaining` : '')
      )
    }

    // Pause between batches (except after the last one)
    if (i + BATCH_SIZE < toProcess.length) {
      await new Promise(r => setTimeout(r, BATCH_DELAY))
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  const totalMin = Math.round((Date.now() - startTime) / 1000 / 60)
  console.log('')
  console.log('── MIGRATION COMPLETE ───────────────────────────────────')
  console.log(`  Processed : ${toProcess.length}`)
  console.log(`  Success   : ${success}`)
  console.log(`  Failed    : ${failed}`)
  if (failReasons.size > 0) {
    console.log('  Failures by source:')
    for (const [src, n] of failReasons) {
      console.log(`    ${n.toString().padStart(5)}  ${src}`)
    }
  }
  console.log(`  Duration  : ${totalMin} min`)
  if (sampleUrls.length > 0) {
    console.log('  Sample R2 URLs (verify these work):')
    sampleUrls.forEach(u => console.log(`    ${u}`))
  }
  console.log('══════════════════════════════════════════════════════════')

  await prisma.$disconnect()
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
