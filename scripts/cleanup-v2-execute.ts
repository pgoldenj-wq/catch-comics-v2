/**
 * cleanup-v2-execute.ts
 *
 * Executes the two approved Cleanup v2 operations:
 *   A. Soft-delete  6 confirmed non-comic canonical_products (academic press)
 *   B. Reclassify 220 confirmed comics from format=OTHER to correct format
 *
 * SOURCE OF TRUTH: existing JSON candidate files only — no new candidate
 * generation. Stops immediately if file counts differ from sign-off values.
 *
 * Sign-off date: 2026-06-07
 * Approved:  6 soft-deletes  |  220 format reclassifications
 *
 * Usage:
 *   npx dotenv -e .env.local -- npx tsx scripts/cleanup-v2-execute.ts
 */

import { PrismaClient, ProductFormat } from '@prisma/client'
import { readFileSync }                 from 'fs'
import { join }                         from 'path'

const prisma = new PrismaClient()

// ── Approved counts from sign-off report ──────────────────────────────────────
const APPROVED_DELETE_COUNT     = 6
const APPROVED_RECLASSIFY_COUNT = 220

// ── Strong-signal guard (sanity check on delete set) ──────────────────────────
const STRONG_SIGNALS = [
  'manga','graphic novel','omnibus','tpb','trade paperback','compendium',
  'marvel','dc comics','image comics','dark horse','idw','boom!','titan comics',
  'oni press','fantagraphics','viz media','kodansha','yen press','seven seas',
  'batman','superman','spider-man','x-men','wonder woman','justice league',
  'avengers','deadpool','wolverine','captain america','watchmen','sandman',
  'invincible','walking dead','hellboy','maus',
]
function hasStrongSignal(title: string, publisher: string | null): boolean {
  const t = (title + ' ' + (publisher ?? '')).toLowerCase()
  return STRONG_SIGNALS.some(s => t.includes(s))
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface DeleteCandidate   { id: string; title: string; publisher: string | null }
interface ReclassifyCandidate {
  id: string; title: string; publisher: string | null
  canonicalSlug: string; activeOffers: number; maxPrice: number
  reason: string; suggestedFormat: string
}

// ── Display helpers ───────────────────────────────────────────────────────────
const HR  = '═══════════════════════════════════════════════════════════════'
const HR2 = '───────────────────────────────────────────────────────────────'
function section(label: string) {
  console.log(`\n── ${label} ${'─'.repeat(Math.max(0, 58 - label.length))}`)
}
function fmtDist(rows: { format: string; count: number }[]) {
  return rows.map(r => `  ${r.format.padEnd(16)} ${String(r.count).padStart(6)}`).join('\n')
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(HR)
  console.log('  Cleanup v2 — Execute  |  sign-off: 2026-06-07')
  console.log(HR)

  // ── STEP 1: Load candidate files ──────────────────────────────────────────
  section('Loading approved candidate files')

  const deleteCandidates: DeleteCandidate[] = JSON.parse(
    readFileSync(join(__dirname, 'cleanup-v2-delete-candidates.json'), 'utf8'),
  )
  const reclassifyCandidates: ReclassifyCandidate[] = JSON.parse(
    readFileSync(join(__dirname, 'reclassify-candidates-strict.json'), 'utf8'),
  )
  console.log(`  cleanup-v2-delete-candidates.json   ${deleteCandidates.length} rows`)
  console.log(`  reclassify-candidates-strict.json   ${reclassifyCandidates.length} rows`)

  // ── STEP 2: Count verification — HARD STOP if wrong ──────────────────────
  section('Count verification  (STOPS on any mismatch)')

  let stop = false
  if (deleteCandidates.length !== APPROVED_DELETE_COUNT) {
    console.error(`  ❌  delete count ${deleteCandidates.length} ≠ approved ${APPROVED_DELETE_COUNT}`)
    stop = true
  } else {
    console.log(`  ✓  delete count     ${deleteCandidates.length}  =  approved ${APPROVED_DELETE_COUNT}`)
  }
  if (reclassifyCandidates.length !== APPROVED_RECLASSIFY_COUNT) {
    console.error(`  ❌  reclassify count ${reclassifyCandidates.length} ≠ approved ${APPROVED_RECLASSIFY_COUNT}`)
    stop = true
  } else {
    console.log(`  ✓  reclassify count ${reclassifyCandidates.length}  =  approved ${APPROVED_RECLASSIFY_COUNT}`)
  }

  // Strong-signal guard: confirm no real comic in delete set
  const leaked = deleteCandidates.filter(r => hasStrongSignal(r.title, r.publisher))
  if (leaked.length > 0) {
    console.error(`  ❌  ${leaked.length} delete candidate(s) have a strong comic signal:`)
    leaked.forEach(r => console.error(`      ${r.title}`))
    stop = true
  } else {
    console.log(`  ✓  0 strong comic signals in delete set`)
  }

  if (stop) {
    console.error('\n  Aborting — no data written.\n')
    process.exit(1)
  }

  // ── STEP 3: Live DB safety checks ────────────────────────────────────────
  section('Live DB safety checks')

  const deleteIds     = deleteCandidates.map(r => r.id)
  const reclassifyIds = reclassifyCandidates.map(r => r.id)

  // Delete candidates: must still be live, no new listings, no new CVID
  const deleteCheck = await prisma.canonicalProduct.findMany({
    where:  { id: { in: deleteIds }, deletedAt: null },
    select: {
      id:          true,
      comicvineId: true,
      listings: {
        where:  { deletedAt: null, priceAmount: { gt: 0 }, retailer: { isActive: true } },
        select: { id: true },
        take:   1,
      },
    },
  })
  const newListings = deleteCheck.filter(r => r.listings.length > 0)
  const newCVIDs    = deleteCheck.filter(r => r.comicvineId !== null)

  console.log(`  Delete candidates still live:            ${deleteCheck.length} / ${APPROVED_DELETE_COUNT}`)
  console.log(`  With new active listings (must be 0):    ${newListings.length}`)
  console.log(`  With new ComicVine ID    (must be 0):    ${newCVIDs.length}`)

  if (newListings.length > 0 || newCVIDs.length > 0) {
    console.error('\n  ❌ Safety check failed — enrichment or sync may have claimed a candidate.')
    newListings.forEach(r => console.error(`    listings: ${r.id}`))
    newCVIDs.forEach(r   => console.error(`    CVID ${r.comicvineId}: ${r.id}`))
    process.exit(1)
  }
  console.log('  ✓  All delete candidates safe to proceed.\n')

  // Reclassify candidates: still in DB and still OTHER
  const reclassifyCheck = await prisma.canonicalProduct.findMany({
    where:  { id: { in: reclassifyIds }, deletedAt: null },
    select: { id: true, format: true },
  })
  const stillOther     = reclassifyCheck.filter(r => r.format === 'OTHER').length
  const alreadyChanged = reclassifyCheck.filter(r => r.format !== 'OTHER').length
  const notFound       = reclassifyIds.length - reclassifyCheck.length

  console.log(`  Reclassify candidates in DB:             ${reclassifyCheck.length} / ${APPROVED_RECLASSIFY_COUNT}`)
  console.log(`  format=OTHER (will update):              ${stillOther}`)
  if (alreadyChanged > 0) console.log(`  format≠OTHER (already corrected, skip):  ${alreadyChanged}`)
  if (notFound > 0)       console.log(`  Not found / already deleted (skip):      ${notFound}`)

  // ── STEP 4: Baseline snapshots (for integrity check after) ────────────────
  section('Baseline snapshots')

  const beforeDist = await prisma.canonicalProduct.groupBy({
    by: ['format'], where: { deletedAt: null },
    _count: { format: true }, orderBy: { _count: { format: 'desc' } },
  })
  const totalBefore = beforeDist.reduce((s, r) => s + r._count.format, 0)

  console.log('  Format distribution BEFORE:')
  console.log(fmtDist(beforeDist.map(r => ({ format: r.format, count: r._count.format }))))
  console.log(`  ${'─'.repeat(24)}`)
  console.log(`  Total live              ${String(totalBefore).padStart(6)}`)

  // Freeze counts for post-exec integrity assertions
  const snap_listings    = await prisma.retailerListing.count()
  const snap_history     = await prisma.priceHistory.count()
  const snap_cvEnriched  = await prisma.canonicalProduct.count({
    where: { deletedAt: null, comicvineId: { not: null } },
  })

  console.log(`\n  retailer_listings snapshot:      ${snap_listings}`)
  console.log(`  price_history snapshot:          ${snap_history}`)
  console.log(`  CV-enriched products snapshot:   ${snap_cvEnriched}`)

  // ═══════════════════════════════════════════════════════════════════
  // OPERATION A — Soft-delete 6 non-comics
  // ═══════════════════════════════════════════════════════════════════
  section('OPERATION A  —  Soft-deleting 6 non-comic products')

  const opA = await prisma.canonicalProduct.updateMany({
    where: {
      id:          { in: deleteIds },
      deletedAt:   null,      // safety: only still-live rows
      comicvineId: null,      // safety: never touch enriched rows
    },
    data: { deletedAt: new Date() },
  })

  console.log(`  Rows soft-deleted: ${opA.count}  (expected: ${deleteCheck.length})`)
  console.log()
  deleteCandidates.forEach(r =>
    console.log(`    ✗  ${r.title.slice(0, 54).padEnd(54)}  [${(r.publisher ?? 'null').slice(0, 28)}]`)
  )

  if (opA.count !== deleteCheck.length) {
    console.warn(`\n  ⚠️  Count mismatch: ${opA.count} updated vs ${deleteCheck.length} expected.`)
    console.warn('     Possible race condition — check DB for IDs that were not updated.')
  } else {
    console.log('\n  ✓  All expected rows soft-deleted.')
  }

  // ═══════════════════════════════════════════════════════════════════
  // OPERATION B — Format reclassification (220 rows)
  // ═══════════════════════════════════════════════════════════════════
  section('OPERATION B  —  Format reclassification  (220 rows)')

  // Group IDs by target format
  const byFormat = new Map<string, string[]>()
  for (const r of reclassifyCandidates) {
    const grp = byFormat.get(r.suggestedFormat) ?? []
    grp.push(r.id)
    byFormat.set(r.suggestedFormat, grp)
  }

  let opBTotal   = 0
  let opBSkipped = 0
  const opBDetail: Array<{ format: string; expected: number; updated: number }> = []

  for (const [fmt, ids] of [...byFormat.entries()].sort()) {
    const res = await prisma.canonicalProduct.updateMany({
      where: { id: { in: ids }, deletedAt: null, format: 'OTHER' },
      data:  { format: fmt as ProductFormat },
    })
    opBTotal   += res.count
    opBSkipped += ids.length - res.count
    opBDetail.push({ format: fmt, expected: ids.length, updated: res.count })
    const skip = ids.length - res.count
    console.log(
      `  OTHER → ${fmt.padEnd(14)}` +
      `  expected: ${String(ids.length).padStart(3)}` +
      `  updated: ${String(res.count).padStart(3)}` +
      (skip > 0 ? `  skipped: ${skip}` : ''),
    )
  }

  console.log(`\n  ${'─'.repeat(54)}`)
  console.log(`  Total updated:  ${opBTotal}`)
  if (opBSkipped > 0) console.log(`  Total skipped:  ${opBSkipped}  (already correct format or deleted)`)
  console.log(opBTotal === APPROVED_RECLASSIFY_COUNT ? '  ✓  Full 220 updated.' : `  ⚠️  ${opBSkipped} skipped.`)

  // ═══════════════════════════════════════════════════════════════════
  // POST-EXECUTION REPORT
  // ═══════════════════════════════════════════════════════════════════
  section('POST-EXECUTION  —  Format distribution AFTER')

  const afterDist = await prisma.canonicalProduct.groupBy({
    by: ['format'], where: { deletedAt: null },
    _count: { format: true }, orderBy: { _count: { format: 'desc' } },
  })
  const totalAfter = afterDist.reduce((s, r) => s + r._count.format, 0)

  console.log(fmtDist(afterDist.map(r => ({ format: r.format, count: r._count.format }))))
  console.log(`  ${'─'.repeat(24)}`)
  console.log(`  Total live              ${String(totalAfter).padStart(6)}`)
  console.log(`  Net change:             ${totalAfter > totalBefore ? '+' : ''}${totalAfter - totalBefore}  (expected: −6)`)

  // Before vs after delta by format
  console.log('\n  Δ Format changes:')
  const beforeMap = new Map(beforeDist.map(r => [r.format, r._count.format]))
  const afterMap  = new Map(afterDist.map(r => [r.format, r._count.format]))
  const allFormats = new Set([...beforeMap.keys(), ...afterMap.keys()])
  for (const fmt of [...allFormats].sort()) {
    const b = beforeMap.get(fmt) ?? 0
    const a = afterMap.get(fmt)  ?? 0
    if (a !== b) {
      const delta = a - b
      console.log(`    ${fmt.padEnd(16)} ${String(b).padStart(6)} → ${String(a).padStart(6)}  (${delta > 0 ? '+' : ''}${delta})`)
    }
  }

  // ── Integrity: confirm untouched tables ───────────────────────────────────
  section('Integrity — untouched tables')

  const after_listings   = await prisma.retailerListing.count()
  const after_history    = await prisma.priceHistory.count()
  const after_cvEnriched = await prisma.canonicalProduct.count({
    where: { deletedAt: null, comicvineId: { not: null } },
  })

  const ok_listings   = after_listings   === snap_listings
  const ok_history    = after_history    === snap_history
  const ok_cvEnriched = after_cvEnriched === snap_cvEnriched

  console.log(`  retailer_listings:          ${after_listings}   ${ok_listings   ? '✓ unchanged' : `⚠ was ${snap_listings}`}`)
  console.log(`  price_history:              ${after_history}   ${ok_history    ? '✓ unchanged' : `⚠ was ${snap_history}`}`)
  console.log(`  CV-enriched products:       ${after_cvEnriched}   ${ok_cvEnriched ? '✓ unchanged' : `⚠ was ${snap_cvEnriched}`}`)

  // ── Launch health checks ──────────────────────────────────────────────────
  section('Launch health checks')

  // 1. Search: products available in search (live, non-OTHER, with active listing)
  const searchable = await prisma.canonicalProduct.count({
    where: {
      deletedAt: null,
      format:    { not: 'OTHER' },
      listings:  { some: { deletedAt: null, priceAmount: { gt: 0 }, retailer: { isActive: true } } },
    },
  })
  // For comparison: all live products with active listings
  const allWithListings = await prisma.canonicalProduct.count({
    where: {
      deletedAt: null,
      listings: { some: { deletedAt: null, priceAmount: { gt: 0 }, retailer: { isActive: true } } },
    },
  })
  console.log(`  Search-ready (non-OTHER + active listing): ${searchable}`)
  console.log(`  All live with active listing:              ${allWithListings}`)

  // 2. Series health: Absolute Batman series intact
  const abSeries = await prisma.canonicalProduct.count({
    where: { deletedAt: null, seriesName: 'Absolute Batman' },
  })
  console.log(`  Absolute Batman series products:           ${abSeries}  (expect 22: 20 issues + 2 volumes)`)

  // 3. Product page health: key canonical pages exist
  const keyPages = await prisma.canonicalProduct.findMany({
    where: {
      canonicalSlug: {
        in: [
          'absolute-batman-1-1073108',
          'absolute-batman-volume-1-the-zoo-505259',
          'absolute-batman-19-1163009',
        ],
      },
      deletedAt: null,
    },
    select: { canonicalSlug: true, format: true, deletedAt: true },
  })
  console.log(`  Key product pages alive:                   ${keyPages.length} / 3`)
  keyPages.forEach(p => console.log(`    ✓  /product/${p.canonicalSlug}  [${p.format}]`))

  // 4. Sitemap health: live products with a slug
  const sitemapCount = await prisma.canonicalProduct.count({
    where: { deletedAt: null, canonicalSlug: { not: '' } },
  })
  console.log(`  Sitemap-eligible products:                 ${sitemapCount}`)

  // 5. Regression: any of the 6 deleted products were real comics?
  const deletedWithSignal = deleteCandidates.filter(r => hasStrongSignal(r.title, r.publisher))
  console.log(`  Deleted products with strong comic signal: ${deletedWithSignal.length}  (must be 0)`)
  if (deletedWithSignal.length > 0) {
    deletedWithSignal.forEach(r => console.error(`    ⚠️  ${r.title}`))
  }

  // 6. Format distribution post-reclassify vs before
  const otherNow   = afterMap.get('OTHER') ?? 0
  const otherBefore = beforeMap.get('OTHER') ?? 0
  const otherDelta = otherNow - otherBefore
  console.log(`  OTHER format pool: ${otherBefore} → ${otherNow}  (Δ ${otherDelta}, expected ≈ −${opBTotal + opA.count})`)

  // ── Final summary ─────────────────────────────────────────────────────────
  console.log(`\n${HR}`)
  console.log(`  CLEANUP V2 COMPLETE`)
  console.log(`  Op A  soft-deleted:   ${opA.count}  non-comic products`)
  console.log(`  Op B  reclassified:   ${opBTotal}  products (format OTHER → correct)`)
  console.log(`  Total rows written:   ${opA.count + opBTotal}  (canonical_products only)`)
  console.log(`  Rollback available:   yes  — see sign-off SQL in report 2026-06-07`)
  console.log(`  Enrichment pipeline:  unaffected (guards comicvineId IS NULL)`)
  console.log(HR + '\n')

  await prisma.$disconnect()
}

main().catch(async e => {
  console.error('\n❌ Fatal error:', e.message ?? String(e))
  await prisma.$disconnect()
  process.exit(1)
})
