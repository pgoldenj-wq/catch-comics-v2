/**
 * cleanup-non-comics — Classifier + executor for canonical_products pollution.
 *
 * Background: ~38k canonical_products have format='OTHER' AND comicvine_id
 * IS NULL — a mix of legitimate comics wrongly typed as OTHER and non-comic
 * books from general-book retailer feeds (Cicero, German poetry, cookbooks,
 * textbooks, etc.).
 *
 * Classification:
 *   Bucket A   — confident non-comic, no active priced listings → delete cand.
 *   Bucket B   — confident comic (broad signals)               → review
 *   Bucket B+  — confident comic AND strong signal             → safe reclassify
 *                (subset of B: title has explicit comic word or named comic
 *                 publisher, OR publisher field exactly matches comic publisher)
 *   Bucket C   — uncertain or safety-overridden from A         → manual review
 *
 * Safety override: any product with at least ONE active priced listing
 * (price > 0, retailer active, not soft-deleted) is demoted from Bucket A
 * to Bucket C — a live sale is evidence of a real product.
 *
 * Modes:
 *   (default)       — dry run, reports and writes JSON files
 *   --execute-a     — soft-deletes Bucket A (sets deleted_at = NOW())
 *   --execute-b-plus — bulk reclassifies Bucket B+ format (OTHER → guessed)
 *
 * Execute modes write a JSON audit trail before touching the DB.
 *
 * Usage:
 *   npm run cleanup:noncomics:dry
 *   npm run cleanup:noncomics:execute-a
 *   npm run cleanup:noncomics:execute-b-plus    (not wired by default)
 */

import { PrismaClient } from '@prisma/client'
import { writeFileSync } from 'fs'
import { join } from 'path'
import {
  classifyText,
  isStrongComic,
  COMIC_SIGNALS,
  type ComicClassification,
} from '../lib/search/isLikelyComic'

const prisma = new PrismaClient()

// ── CLI ───────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2)
const EXECUTE_A           = argv.includes('--execute-a')
const EXECUTE_B_PLUS      = argv.includes('--execute-b-plus')
const EXECUTE_C_PRUNED    = argv.includes('--execute-c-pruned')
const DRY_C_PRUNED        = argv.includes('--dry-c-pruned')

// Publishers that are confirmed public-domain reprint mills / print-on-demand
// outfits — their entire WoB-fed inventory is non-comic. Approved by user
// after publisher-distribution review (see Step 2 dry-run report).
const DELETE_PUBLISHERS: readonly string[] = [
  'Creative Media Partners, LLC',
  'Legare Street Press',
  'Kessinger Publishing, LLC',
  'Wentworth Press',
  'Palala Press',
  'Nabu Press',
  'BoD - Books on Demand',
  'Tradd Street Press',
  'Anson Street Press',
  'Hassell Street Press',
]

// Title-level final safety net. If any product slated for delete has a
// comic-signal substring in its title, spare it regardless of publisher.
// Uses the BROAD COMIC_SIGNALS (includes 'vol.', 'volume ', '#1' etc.) —
// for cleanup we want max generosity in sparing potential comics.
function titleHasComicSignal(title: string): boolean {
  const t = title.toLowerCase()
  for (const s of COMIC_SIGNALS) {
    if (t.includes(s)) return true
  }
  return false
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface Candidate {
  id:                 string
  title:              string
  publisher:          string | null
  canonical_slug:     string
  active_listing_cnt: number
  max_price:          string | null
}

interface BucketEntry {
  id:            string
  title:         string
  publisher:     string | null
  canonicalSlug: string
  activeOffers:  number
  maxPrice:      number | null
  /** Why this entry landed in its bucket. */
  reason:        string
  /** Suggested format for Bucket B+ reclassification ('TPB', 'MANGA_VOLUME', etc.) */
  suggestedFormat?: string
}

interface Buckets {
  A:     BucketEntry[]  // delete candidates
  B:     BucketEntry[]  // confident comic (broad)
  BPlus: BucketEntry[]  // safe-to-reclassify subset of B
  C:     BucketEntry[]  // uncertain or safety-held
}

// ── Format inference for Bucket B+ reclassification ───────────────────────────
//
// When we reclassify a "comic" out of OTHER, we still need to pick the right
// format enum value. Heuristic on title + publisher.

function inferFormat(title: string, publisher: string | null): string {
  const t = title.toLowerCase()
  const p = (publisher ?? '').toLowerCase()

  // Manga publishers — almost always MANGA_VOLUME
  const MANGA_PUBS = ['viz', 'kodansha', 'yen press', 'seven seas', 'tokyopop',
    'square enix', 'shueisha', 'shogakukan']
  if (MANGA_PUBS.some(mp => p.includes(mp))) return 'MANGA_VOLUME'
  if (t.includes('manga')) return 'MANGA_VOLUME'

  if (t.includes('omnibus'))    return 'OMNIBUS'
  if (t.includes('compendium')) return 'COMPENDIUM'
  if (t.includes('absolute'))   return 'ABSOLUTE'
  if (t.includes('deluxe'))     return 'DELUXE'
  if (t.includes('hardcover') || / hc\b/.test(t)) return 'HARDCOVER'

  // Trade paperback markers
  if (t.includes('tpb') || t.includes('trade paperback')) return 'TPB'

  // Single issue — has # followed by a number, or "issue #"
  if (/(?:^|\s)#\d+/.test(t) && !t.includes('volume') && !t.includes('vol.')) {
    return 'SINGLE_ISSUE'
  }

  // Default: TPB for collected comic editions
  return 'TPB'
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const mode = EXECUTE_A ? 'EXECUTE Bucket A (soft-delete)'
            : EXECUTE_B_PLUS ? 'EXECUTE Bucket B+ (format reclassify)'
            : 'DRY RUN'
  console.log(`Mode: ${mode}`)
  console.log("Scanning canonical_products WHERE format='OTHER' AND comicvine_id IS NULL …\n")

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

  const buckets: Buckets = { A: [], B: [], BPlus: [], C: [] }
  let safetyOverrideCount = 0

  for (const r of rows) {
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
      // Strict subset: also passes isStrongComic on title OR publisher field
      if (isStrongComic(r.title, r.publisher)) {
        const bPlusEntry: BucketEntry = {
          ...entry,
          reason:          'strong comic signal (named publisher or specific format/character)',
          suggestedFormat: inferFormat(r.title, r.publisher),
        }
        buckets.BPlus.push(bPlusEntry)
      }
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
  console.log('BUCKET A — Confident non-comic (DELETE)')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log(`Count: ${buckets.A.length} (${pct(buckets.A.length)}%)`)

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('BUCKET B  — Confident comic, broad (REVIEW)')
  console.log('BUCKET B+ — Strong comic signal (SAFE TO RECLASSIFY)')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log(`B:     ${buckets.B.length} (${pct(buckets.B.length)}%)`)
  console.log(`B+:    ${buckets.BPlus.length} (${pct(buckets.BPlus.length)}%)  ← subset of B`)
  console.log('B+ sample (30) with suggested format:')
  for (const e of buckets.BPlus.slice(0, 30)) {
    const pubStr = e.publisher ? ` [${e.publisher}]` : ''
    const fmt    = e.suggestedFormat ? ` → ${e.suggestedFormat}` : ''
    console.log(`  ${e.title.slice(0, 60)}${pubStr}${fmt}`.slice(0, 110))
  }

  // Format breakdown for B+
  const fmtCounts = new Map<string, number>()
  for (const e of buckets.BPlus) {
    const f = e.suggestedFormat ?? 'OTHER'
    fmtCounts.set(f, (fmtCounts.get(f) ?? 0) + 1)
  }
  console.log('\nB+ format distribution:')
  for (const [fmt, cnt] of [...fmtCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${fmt.padEnd(15)} ${cnt}`)
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('BUCKET C — Uncertain / safety-held (KEEP)')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log(`Count: ${buckets.C.length} (${pct(buckets.C.length)}%)`)
  console.log(`  ↳ of which safety-overridden from A: ${safetyOverrideCount}`)

  // ── Write JSON audit trail (always, before any execute) ──────────────────
  const aPath  = join(__dirname, 'delete-candidates.json')
  const bPath  = join(__dirname, 'reclassify-candidates.json')
  const bpPath = join(__dirname, 'reclassify-candidates-strict.json')

  writeFileSync(aPath,  JSON.stringify(buckets.A,     null, 2))
  writeFileSync(bPath,  JSON.stringify(buckets.B,     null, 2))
  writeFileSync(bpPath, JSON.stringify(buckets.BPlus, null, 2))

  console.log(`\n  JSON written:`)
  console.log(`    ${aPath}     (${buckets.A.length} rows)`)
  console.log(`    ${bPath}     (${buckets.B.length} rows)`)
  console.log(`    ${bpPath}    (${buckets.BPlus.length} rows)`)

  // ── EXECUTE modes ─────────────────────────────────────────────────────────

  if (EXECUTE_A) {
    if (buckets.A.length === 0) {
      console.log('\n[execute-a] Bucket A is empty — nothing to delete.')
    } else if (buckets.A.length > 500) {
      console.error(`\n[execute-a] REFUSING: Bucket A has ${buckets.A.length} rows (limit 500).`)
      console.error('  Investigate before deleting — your classifier may be too aggressive.')
      process.exit(1)
    } else {
      const ids = buckets.A.map(e => e.id)
      console.log(`\n[execute-a] Soft-deleting ${ids.length} Bucket A products …`)
      const updated = await prisma.$executeRaw`
        UPDATE canonical_products
        SET deleted_at = NOW(), updated_at = NOW()
        WHERE id = ANY(${ids}::uuid[])
          AND deleted_at IS NULL
      `
      console.log(`[execute-a] Rows updated: ${updated}`)
      console.log(`[execute-a] Reversible — clear deleted_at to restore.`)
    }
  }

  if (EXECUTE_B_PLUS) {
    if (buckets.BPlus.length === 0) {
      console.log('\n[execute-b-plus] Bucket B+ is empty — nothing to reclassify.')
    } else {
      console.log(`\n[execute-b-plus] Reclassifying ${buckets.BPlus.length} Bucket B+ products …`)
      // Group by suggested format for batched UPDATEs
      const byFormat = new Map<string, string[]>()
      for (const e of buckets.BPlus) {
        const fmt = e.suggestedFormat ?? 'TPB'
        const arr = byFormat.get(fmt) ?? []
        arr.push(e.id)
        byFormat.set(fmt, arr)
      }
      let totalUpdated = 0
      for (const [fmt, ids] of byFormat.entries()) {
        const updated = await prisma.$executeRawUnsafe(`
          UPDATE canonical_products
          SET format = $1::"ProductFormat", updated_at = NOW()
          WHERE id = ANY($2::uuid[])
            AND format::text = 'OTHER'
        `, fmt, ids)
        console.log(`  ${fmt.padEnd(15)} ${updated} reclassified`)
        totalUpdated += Number(updated)
      }
      console.log(`[execute-b-plus] Total reclassified: ${totalUpdated}`)
    }
  }

  // ── C-pruned: format=OTHER + no CV id + no live listings + (NULL pub or
  //   approved reprint mill) + no comic-signal in title.
  //   Final safety net is the title comic-signal check — even with NULL
  //   publisher, a title containing 'manga'/'omnibus'/'batman'/'vol.' etc.
  //   spares the row. Approved 2026-05-29.
  if (DRY_C_PRUNED || EXECUTE_C_PRUNED) {
    const pubList = DELETE_PUBLISHERS.map(p => `'${p.replace(/'/g, "''")}'`).join(',')
    const cRows = await prisma.$queryRawUnsafe<Array<{
      id: string; title: string; publisher: string | null
    }>>(`
      SELECT cp.id, cp.title, cp.publisher
      FROM canonical_products cp
      WHERE cp.format::text = 'OTHER'
        AND cp.comicvine_id IS NULL
        AND cp.deleted_at IS NULL
        AND (cp.publisher IS NULL OR cp.publisher IN (${pubList}))
        AND NOT EXISTS (
          SELECT 1 FROM retailer_listings rl
          JOIN retailers ret ON ret.id = rl.retailer_id
          WHERE rl.canonical_product_id = cp.id
            AND rl.price_amount > 0
            AND rl.deleted_at IS NULL
            AND ret.is_active = true
        )
    `)

    // Apply title-level comic-signal guard (final safety net)
    const beforeGuard = cRows.length
    const cToDelete   = cRows.filter(r => !titleHasComicSignal(r.title))
    const spared      = cRows.filter(r =>  titleHasComicSignal(r.title))

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('C-PRUNED — format=OTHER, no CV, no live listings, junk publishers')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log(`Raw match (pub criterion + no-listings):     ${beforeGuard}`)
    console.log(`  ↳ spared by title comic-signal guard:      ${spared.length}`)
    console.log(`  ↳ to delete:                                ${cToDelete.length}`)
    console.log('\nSample of 20 spared (title comic-signal hit):')
    spared.slice(0, 20).forEach(r => {
      console.log(`  ${r.title.slice(0, 70)}${r.publisher ? ` [${r.publisher}]` : ''}`)
    })

    const auditPath = join(__dirname, 'c-pruned-delete-candidates.json')
    writeFileSync(auditPath, JSON.stringify(cToDelete, null, 2))
    console.log(`\n  JSON audit written: ${auditPath} (${cToDelete.length} rows)`)

    if (EXECUTE_C_PRUNED) {
      if (cToDelete.length === 0) {
        console.log('\n[execute-c-pruned] Nothing to delete.')
      } else if (cToDelete.length > 5000) {
        console.error(`\n[execute-c-pruned] REFUSING: ${cToDelete.length} > 5000 row safety limit.`)
        process.exit(1)
      } else {
        console.log(`\n[execute-c-pruned] Soft-deleting ${cToDelete.length} rows …`)
        const ids = cToDelete.map(r => r.id)
        const updated = await prisma.$executeRaw`
          UPDATE canonical_products
          SET deleted_at = NOW(), updated_at = NOW()
          WHERE id = ANY(${ids}::uuid[])
            AND deleted_at IS NULL
        `
        console.log(`[execute-c-pruned] Rows soft-deleted: ${updated}`)
        console.log(`[execute-c-pruned] Reversible — set deleted_at = NULL to restore.`)
      }
    }
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('SUMMARY')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log(`  Total scanned: ${total}`)
  console.log(`  Bucket A:      ${buckets.A.length}`)
  console.log(`  Bucket B:      ${buckets.B.length}  (broad)`)
  console.log(`  Bucket B+:     ${buckets.BPlus.length}  (strict — strong signal)`)
  console.log(`  Bucket C:      ${buckets.C.length}  (incl. ${safetyOverrideCount} safety-held)`)
  if (!EXECUTE_A && !EXECUTE_B_PLUS && !EXECUTE_C_PRUNED) {
    console.log('\nDry run — NO DATA MODIFIED.')
  }

  await prisma.$disconnect()
}

main().catch(async e => {
  console.error('Cleanup failed:', e)
  await prisma.$disconnect()
  process.exit(1)
})
