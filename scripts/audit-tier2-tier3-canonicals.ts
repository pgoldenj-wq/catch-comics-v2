#!/usr/bin/env tsx
/**
 * scripts/audit-tier2-tier3-canonicals.ts
 *
 * READ-ONLY diagnostic audit for Tier 2 and Tier 3 canonical cleanup candidates.
 * Does NOT write or delete anything.
 *
 * Tier 2 — Title keyword matches (format=OTHER, non-comic title signals, not in Tier 1 blocklist)
 *   - All 29 candidates, with active listing details, retailer names, price range
 *   - Risk classification: SAFE_DELETE / REVIEW / FALSE_POSITIVE
 *   - Which keyword triggered each match
 *
 * Tier 3 — Orphaned format=OTHER, 0 active listings, not in Tier 1 blocklist
 *   - Sample of 30 for manual review
 *   - Classification per row
 *
 * Usage:
 *   npx dotenv -e .env.local -- npx tsx scripts/audit-tier2-tier3-canonicals.ts
 */

import { prisma } from '../lib/prisma'

// ── Re-declare exactly as in purge-noncomic-canonicals-v2.ts ─────────────────

const NON_COMIC_PUBLISHERS_EXACT = new Set([
  'BRILL',
  'Brill',
  'Brill Academic Publishers',
  'Martinus Nijhoff Publishers',
  'Creative Media Partners, LLC',
  'Legare Street Press',
  'Kessinger Publishing, LLC',
  'Kessinger Publishing',
  "McGill-Queen's University Press",
  'Hachette Livre - Bnf',
  'IWA Publishing',
  'Hachette Livre BNF',
])

const COMIC_PUBLISHERS = new Set([
  'Marvel', 'DC Comics', 'Image Comics', 'Dark Horse Comics', 'IDW Publishing',
  'BOOM! Studios', 'Valiant', 'Dynamite', 'Oni Press', 'Fantagraphics',
  'Drawn & Quarterly', 'Top Shelf', 'Archie Comics', 'Titan Comics',
  'Rebellion', 'Ablaze', 'Scout Comics', 'Vault Comics', 'AHOY Comics',
  'Avatar Press', 'SLG Publishing', 'Viz Media', 'Yen Press', 'Kodansha',
  'Seven Seas', 'Tokyopop', 'Square Enix', 'Square Enix Manga',
  'Del Rey Manga', 'Vertical', 'SuBLime', 'Ghost Ship', 'Airship',
  'Yen On', 'FAKKU', 'DENPA', 'One Peace Books', 'Udon Entertainment',
  'Antarctic Press', 'Humanoids', 'Lion Forge', 'Papercutz',
  'First Second', 'Graphix', 'Scholastic', 'Abrams ComicArts',
  'NBM Publishing', 'Eurocomics', 'Fanfare', 'Drawn',
  'Arotahi Agency',
  'Hachette Aotearoa New Zealand',
  'Penguin Random House NZ',
  'Melia Publishing Services Limited',
])

const ALWAYS_COMIC_FORMATS = new Set([
  'SINGLE_ISSUE', 'TPB', 'HARDCOVER', 'OMNIBUS',
  'DELUXE', 'COMPENDIUM', 'MANGA_VOLUME', 'ABSOLUTE',
])

const NON_COMIC_TITLE_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: 'math/arithmetic',    pattern: /\b(maths?|mathematics|arithmetic)\b/i },
  { label: 'textbook/workbook',  pattern: /\b(textbook|coursebook|workbook|exercise book|study guide)\b/i },
  { label: 'grammar/vocab',      pattern: /\b(grammar|vocabulary|comprehension)\b/i },
  { label: 'science/curriculum', pattern: /\b(chemistry|physics|biology|science|gcse|a-level|a level)\b/i },
  { label: '11-plus exam',       pattern: /\b(11\+|eleven plus)\b/i },
  { label: 'academic paper',     pattern: /\b(dissertation|thesis|proceedings|journal of)\b/i },
  { label: 'law/legislation',    pattern: /\b(law reports?|legislation|statutes?)\b/i },
]

const PRESERVE_IF_TITLE_CONTAINS: Array<{ label: string; pattern: RegExp }> = [
  { label: 'vol/volume N',     pattern: /\b(vol\.?|volume)\s*\d/i },
  { label: 'manga/manhwa',     pattern: /\b(manga|manhwa|manhua)\b/i },
  { label: 'omnibus/absolute', pattern: /\b(omnibus|compendium|absolute|deluxe)\b/i },
  { label: 'graphic novel',    pattern: /\b(graphic novel|comic|comics|trade paperback|tpb)\b/i },
  { label: 'issue/#N',         pattern: /\b(issue|#\s*\d)\b/i },
  { label: 'collection/ed.',   pattern: /\b(collected|collection|edition)\b/i },
]

function getPreserveSignal(title: string): string | null {
  for (const { label, pattern } of PRESERVE_IF_TITLE_CONTAINS) {
    if (pattern.test(title)) return label
  }
  return null
}

function getTriggeringKeyword(title: string): string | null {
  const preserve = getPreserveSignal(title)
  if (preserve) return null // preserved → no trigger
  for (const { label, pattern } of NON_COMIC_TITLE_PATTERNS) {
    if (pattern.test(title)) return label
  }
  return null
}

// ── Risk classification ───────────────────────────────────────────────────────

type Risk = 'SAFE_DELETE' | 'REVIEW' | 'FALSE_POSITIVE'

function classifyTier2Risk(
  title:          string,
  publisher:      string | null,
  format:         string,
  activeListings: number,
  triggerKeyword: string,
): { risk: Risk; rationale: string } {
  // If format is a known-comic format, this shouldn't appear in Tier 2 — flag
  if (ALWAYS_COMIC_FORMATS.has(format)) {
    return { risk: 'FALSE_POSITIVE', rationale: `Format ${format} is a comic format — keyword match is incidental` }
  }

  // If publisher is a known comic publisher, false positive
  if (publisher && COMIC_PUBLISHERS.has(publisher)) {
    return { risk: 'FALSE_POSITIVE', rationale: `Publisher "${publisher}" is a confirmed comic publisher` }
  }

  // Highest-confidence non-comic signals with zero active listings
  if (activeListings === 0) {
    if (['math/arithmetic', '11-plus exam', 'science/curriculum', 'academic paper', 'law/legislation'].includes(triggerKeyword)) {
      return { risk: 'SAFE_DELETE', rationale: `Zero active listings + unambiguous keyword (${triggerKeyword})` }
    }
    if (triggerKeyword === 'textbook/workbook') {
      return { risk: 'SAFE_DELETE', rationale: `Zero active listings + "textbook/workbook" keyword` }
    }
    // grammar/vocab can occasionally appear in language-learning manga titles
    return { risk: 'REVIEW', rationale: `Zero active listings but keyword "${triggerKeyword}" has occasional false positives` }
  }

  // Active listings present — need manual eyes regardless
  if (activeListings > 0) {
    if (['math/arithmetic', '11-plus exam', 'law/legislation', 'academic paper'].includes(triggerKeyword)) {
      return {
        risk: 'REVIEW',
        rationale: `${activeListings} active listing(s) + keyword "${triggerKeyword}" — likely non-comic but verify retailer`,
      }
    }
    if (triggerKeyword === 'science/curriculum') {
      return {
        risk: 'REVIEW',
        rationale: `${activeListings} active listing(s) + keyword "${triggerKeyword}" — "science" can appear in sci-fi comics`,
      }
    }
    if (triggerKeyword === 'grammar/vocab') {
      return {
        risk: 'REVIEW',
        rationale: `${activeListings} active listing(s) + "${triggerKeyword}" — check whether this is a language-learning graphic novel`,
      }
    }
    return {
      risk: 'REVIEW',
      rationale: `${activeListings} active listing(s) — manual review needed before any delete`,
    }
  }

  return { risk: 'REVIEW', rationale: 'Unclassified — default to REVIEW' }
}

function classifyTier3Row(title: string, publisher: string | null): { risk: Risk; rationale: string } {
  const pub = publisher ?? ''

  // No publisher + format=OTHER + 0 active = almost certainly a TM non-comic orphan
  if (!pub) {
    return { risk: 'SAFE_DELETE', rationale: 'No publisher, format=OTHER, 0 active listings — classic TM orphan' }
  }

  // Light-novel publishers (Yen On, J-Novel, etc.) may legitimately have 0 listings right now
  const lightNovelHints = /\b(yen on|j-novel|seven seas|airship|ghost ship)\b/i
  if (lightNovelHints.test(pub)) {
    return { risk: 'REVIEW', rationale: `Publisher "${pub}" may be a light novel imprint — verify before deleting` }
  }

  // If title looks like a real book (vol N, etc.)
  const preserve = getPreserveSignal(title)
  if (preserve) {
    return { risk: 'FALSE_POSITIVE', rationale: `Title has preserve signal "${preserve}" — may be a real comic product` }
  }

  // Generic unknown publisher with 0 listings → safe to delete
  return { risk: 'SAFE_DELETE', rationale: `Unknown publisher "${pub}", format=OTHER, 0 active — likely TM orphan` }
}

// ── Main ──────────────────────────────────────────────────────────────────────

interface CanonicalRow {
  id:         string
  title:      string
  publisher:  string | null
  format:     string
  isbn13:     string | null
}

interface ListingDetail {
  canonical_product_id: string
  retailer_name:        string
  stock_status:         string
  price_amount:         string
  price_currency:       string
}

async function main() {
  console.log(`\n${'═'.repeat(80)}`)
  console.log(`  Catch Comics — Tier 2 + Tier 3 Canonical Cleanup Audit`)
  console.log(`  READ-ONLY — no writes, no deletes`)
  console.log(`  Date: ${new Date().toISOString().slice(0, 10)}`)
  console.log(`${'═'.repeat(80)}\n`)

  // ── 1. Load all format=OTHER, not soft-deleted canonicals ─────────────────────
  console.log('Loading format=OTHER, deletedAt IS NULL canonicals …')
  const allOther = await prisma.$queryRaw<CanonicalRow[]>`
    SELECT id, title, publisher, format::text AS format, isbn_13 AS isbn13
    FROM   canonical_products
    WHERE  format = 'OTHER'
      AND  deleted_at IS NULL
    ORDER  BY publisher NULLS LAST, title
  `
  console.log(`  Found ${allOther.length.toLocaleString()} format=OTHER live canonicals\n`)

  // ── 2. For each, get active listing count ─────────────────────────────────────
  console.log('Loading active listing counts …')
  const activeCounts = await prisma.$queryRaw<
    Array<{ canonical_product_id: string; active_count: bigint }>
  >`
    SELECT   rl.canonical_product_id,
             COUNT(*) AS active_count
    FROM     retailer_listings rl
    WHERE    rl.deleted_at IS NULL
      AND    rl.stock_status IN ('IN_STOCK', 'LOW_STOCK', 'PREORDER')
      AND    rl.canonical_product_id IS NOT NULL
    GROUP BY rl.canonical_product_id
  `
  const activeCountMap = new Map<string, number>()
  for (const r of activeCounts) {
    activeCountMap.set(r.canonical_product_id, Number(r.active_count))
  }

  // ── 3. Classify into Tier 2 and Tier 3 ───────────────────────────────────────
  const tier2Candidates: Array<{
    row:            CanonicalRow
    activeListings: number
    triggerKeyword: string
  }> = []

  const tier3Candidates: Array<{
    row:            CanonicalRow
    activeListings: number
  }> = []

  for (const row of allOther) {
    const pub    = row.publisher ?? ''
    const active = activeCountMap.get(row.id) ?? 0

    // Skip Tier 1 blocklisted publishers (they were already handled)
    if (NON_COMIC_PUBLISHERS_EXACT.has(pub)) continue

    // Skip confirmed comic publishers
    if (pub && COMIC_PUBLISHERS.has(pub)) continue

    // Check preserve signal
    const preserve = getPreserveSignal(row.title)
    if (preserve) continue

    // Tier 2: has a non-comic keyword trigger
    const trigger = getTriggeringKeyword(row.title)
    if (trigger) {
      tier2Candidates.push({ row, activeListings: active, triggerKeyword: trigger })
      continue
    }

    // Tier 3: no keyword, but 0 active listings
    if (active === 0) {
      tier3Candidates.push({ row, activeListings: active })
    }
  }

  console.log(`  Tier 2 candidates : ${tier2Candidates.length}`)
  console.log(`  Tier 3 candidates : ${tier3Candidates.length}\n`)

  // ── 4. Load listing details for Tier 2 candidates with active listings ────────
  const tier2ActiveIds = tier2Candidates
    .filter(c => c.activeListings > 0)
    .map(c => c.row.id)

  let listingDetails: ListingDetail[] = []
  if (tier2ActiveIds.length > 0) {
    listingDetails = await prisma.$queryRaw<ListingDetail[]>`
      SELECT
        rl.canonical_product_id,
        ret.name           AS retailer_name,
        rl.stock_status::text AS stock_status,
        rl.price_amount::text AS price_amount,
        rl.price_currency  AS price_currency
      FROM retailer_listings rl
      JOIN retailers ret ON ret.id = rl.retailer_id
      WHERE rl.deleted_at IS NULL
        AND rl.stock_status IN ('IN_STOCK', 'LOW_STOCK', 'PREORDER')
        AND rl.canonical_product_id = ANY(${tier2ActiveIds}::uuid[])
      ORDER BY rl.canonical_product_id, ret.name
    `
  }

  // Group listing details by canonical_product_id
  const listingsByCanonical = new Map<string, ListingDetail[]>()
  for (const ld of listingDetails) {
    const arr = listingsByCanonical.get(ld.canonical_product_id) ?? []
    arr.push(ld)
    listingsByCanonical.set(ld.canonical_product_id, arr)
  }

  // ── 5. Report: Tier 2 full list ───────────────────────────────────────────────
  console.log('═'.repeat(80))
  console.log('  TIER 2 — ALL CANDIDATES (title keyword matches)')
  console.log('  Format=OTHER, deletedAt IS NULL, not in Tier 1 blocklist')
  console.log('═'.repeat(80))
  console.log()

  const tier2Results: Array<{
    id:             string
    title:          string
    publisher:      string | null
    isbn13:         string | null
    activeListings: number
    triggerKeyword: string
    risk:           Risk
    rationale:      string
    retailers:      string
    priceRange:     string
  }> = []

  // Risk counters
  const riskCounts: Record<Risk, number> = { SAFE_DELETE: 0, REVIEW: 0, FALSE_POSITIVE: 0 }
  const safeDeleteIds: string[] = []
  const reviewIds:     string[] = []
  const falsePositiveIds: string[] = []

  for (const c of tier2Candidates) {
    const { risk, rationale } = classifyTier2Risk(
      c.row.title,
      c.row.publisher,
      c.row.format,
      c.activeListings,
      c.triggerKeyword,
    )

    const listings  = listingsByCanonical.get(c.row.id) ?? []
    const retailers = [...new Set(listings.map(l => l.retailer_name))].join(', ') || '—'

    let priceRange = '—'
    if (listings.length > 0) {
      const prices = listings.map(l => parseFloat(l.price_amount))
      const min = Math.min(...prices).toFixed(2)
      const max = Math.max(...prices).toFixed(2)
      const currency = listings[0].price_currency
      priceRange = min === max ? `${currency} ${min}` : `${currency} ${min}–${max}`
    }

    tier2Results.push({
      id:             c.row.id,
      title:          c.row.title,
      publisher:      c.row.publisher,
      isbn13:         c.row.isbn13,
      activeListings: c.activeListings,
      triggerKeyword: c.triggerKeyword,
      risk,
      rationale,
      retailers,
      priceRange,
    })

    riskCounts[risk]++
    if (risk === 'SAFE_DELETE')    safeDeleteIds.push(c.row.id)
    if (risk === 'REVIEW')         reviewIds.push(c.row.id)
    if (risk === 'FALSE_POSITIVE') falsePositiveIds.push(c.row.id)
  }

  // Print each Tier 2 row
  let rowNum = 0
  for (const r of tier2Results) {
    rowNum++
    const pubDisplay  = (r.publisher ?? '(no publisher)').substring(0, 40)
    const titleDisplay = r.title.substring(0, 70)
    const riskTag = r.risk === 'SAFE_DELETE'    ? '[SAFE_DELETE   ]'
                  : r.risk === 'FALSE_POSITIVE' ? '[FALSE_POSITIVE]'
                  :                               '[REVIEW        ]'

    console.log(`── #${rowNum} ─────────────────────────────────────────────────────────────────`)
    console.log(`  ${riskTag}`)
    console.log(`  Title     : ${titleDisplay}`)
    console.log(`  Publisher : ${pubDisplay}`)
    console.log(`  ISBN-13   : ${r.isbn13 ?? '(none)'}`)
    console.log(`  Trigger   : ${r.triggerKeyword}`)
    console.log(`  Active    : ${r.activeListings} listing(s)`)
    if (r.activeListings > 0) {
      console.log(`  Retailers : ${r.retailers}`)
      console.log(`  Prices    : ${r.priceRange}`)
    }
    console.log(`  Rationale : ${r.rationale}`)
    console.log()
  }

  // ── 6. Tier 2 summary ─────────────────────────────────────────────────────────
  const tier2WithActive = tier2Candidates.filter(c => c.activeListings > 0).length
  console.log('─'.repeat(80))
  console.log('  TIER 2 SUMMARY')
  console.log('─'.repeat(80))
  console.log(`  Total Tier 2 candidates    : ${tier2Candidates.length}`)
  console.log(`  With active listings       : ${tier2WithActive}`)
  console.log(`  Without active listings    : ${tier2Candidates.length - tier2WithActive}`)
  console.log()
  console.log(`  SAFE_DELETE                : ${riskCounts.SAFE_DELETE}`)
  console.log(`  REVIEW (manual eyes)       : ${riskCounts.REVIEW}`)
  console.log(`  FALSE_POSITIVE (keep)      : ${riskCounts.FALSE_POSITIVE}`)
  console.log()

  // ── 7. Tier 3 sample ─────────────────────────────────────────────────────────
  console.log('═'.repeat(80))
  console.log('  TIER 3 — ORPHANED format=OTHER, 0 active listings (sample of 30)')
  console.log('  Not in Tier 1 blocklist, no comic publisher, no preserve signal')
  console.log('═'.repeat(80))
  console.log()

  const tier3Sample = tier3Candidates.slice(0, 30)
  const tier3RiskCounts: Record<Risk, number> = { SAFE_DELETE: 0, REVIEW: 0, FALSE_POSITIVE: 0 }

  let t3Num = 0
  for (const c of tier3Sample) {
    t3Num++
    const { risk, rationale } = classifyTier3Row(c.row.title, c.row.publisher)
    tier3RiskCounts[risk]++

    const riskTag = risk === 'SAFE_DELETE'    ? '[SAFE_DELETE   ]'
                  : risk === 'FALSE_POSITIVE' ? '[FALSE_POSITIVE]'
                  :                             '[REVIEW        ]'

    console.log(`── #${t3Num} ─────────────────────────────────────────────────────────────────`)
    console.log(`  ${riskTag}`)
    console.log(`  Title     : ${c.row.title.substring(0, 70)}`)
    console.log(`  Publisher : ${(c.row.publisher ?? '(no publisher)').substring(0, 40)}`)
    console.log(`  ISBN-13   : ${c.row.isbn13 ?? '(none)'}`)
    console.log(`  Rationale : ${rationale}`)
    console.log()
  }

  const tier3SafePct = tier3Candidates.length > 0
    ? ((tier3RiskCounts.SAFE_DELETE / tier3Sample.length) * 100).toFixed(0)
    : '0'

  console.log('─'.repeat(80))
  console.log('  TIER 3 SUMMARY (based on 30-row sample)')
  console.log('─'.repeat(80))
  console.log(`  Total Tier 3 candidates    : ${tier3Candidates.length.toLocaleString()}`)
  console.log(`  Sample size                : ${tier3Sample.length}`)
  console.log(`  SAFE_DELETE (sample)       : ${tier3RiskCounts.SAFE_DELETE}  (~${tier3SafePct}% extrapolated)`)
  console.log(`  REVIEW (sample)            : ${tier3RiskCounts.REVIEW}`)
  console.log(`  FALSE_POSITIVE (sample)    : ${tier3RiskCounts.FALSE_POSITIVE}`)
  console.log()

  // ── 8. Recommended soft-delete batch ─────────────────────────────────────────
  console.log('═'.repeat(80))
  console.log('  RECOMMENDED SOFT-DELETE BATCH')
  console.log('═'.repeat(80))
  console.log()
  console.log(`  ► Tier 2 SAFE_DELETE (${safeDeleteIds.length} rows) — delete immediately:`)
  console.log()
  for (const r of tier2Results.filter(r => r.risk === 'SAFE_DELETE')) {
    console.log(`    id: ${r.id}`)
    console.log(`    title: "${r.title.substring(0, 65)}"`)
    console.log(`    trigger: ${r.triggerKeyword}`)
    console.log()
  }

  console.log(`  ► Tier 2 REVIEW (${reviewIds.length} rows) — manual review before deleting:`)
  console.log()
  for (const r of tier2Results.filter(r => r.risk === 'REVIEW')) {
    console.log(`    id: ${r.id}`)
    console.log(`    title: "${r.title.substring(0, 65)}"`)
    console.log(`    active: ${r.activeListings}, trigger: ${r.triggerKeyword}`)
    console.log(`    retailers: ${r.retailers}`)
    console.log()
  }

  console.log(`  ► Tier 2 FALSE_POSITIVE (${falsePositiveIds.length} rows) — DO NOT DELETE:`)
  for (const r of tier2Results.filter(r => r.risk === 'FALSE_POSITIVE')) {
    console.log(`    id: ${r.id}  "${r.title.substring(0, 65)}"`)
  }
  console.log()

  // ── 9. Rollback approach ──────────────────────────────────────────────────────
  console.log('═'.repeat(80))
  console.log('  ROLLBACK APPROACH')
  console.log('═'.repeat(80))
  console.log()
  console.log('  canonical_products now has deletedAt (added Week 2A migration).')
  console.log('  Soft-delete sets deleted_at = NOW() — fully reversible at any time:')
  console.log()
  console.log('    -- Restore a single canonical:')
  console.log("    UPDATE canonical_products SET deleted_at = NULL WHERE id = '<uuid>';")
  console.log()
  console.log('    -- Restore all Tier 2 soft-deletes done after a given timestamp:')
  console.log("    UPDATE canonical_products")
  console.log("      SET deleted_at = NULL")
  console.log("      WHERE deleted_at >= '2026-05-15 00:00:00+00';")
  console.log()
  console.log('  Before running --soft-delete --include-tier2, also export IDs as a backup:')
  console.log()
  console.log('    npx dotenv -e .env.local -- npx tsx scripts/purge-noncomic-canonicals-v2.ts \\')
  console.log('      --export-ids-to tier2-soft-delete-ids-2026-05-15.json')
  console.log()
  console.log('  Retailer listings pointing to these canonicals are NOT affected:')
  console.log('  the FK is ON DELETE SET NULL — listings remain, just lose their')
  console.log('  canonical link and become unmatched. They do not surface in search.')
  console.log()

  // ── 10. Final counts ──────────────────────────────────────────────────────────
  console.log('═'.repeat(80))
  console.log('  BOTTOM LINE')
  console.log('═'.repeat(80))
  console.log()
  console.log(`  Tier 2 — total candidates  : ${tier2Candidates.length}`)
  console.log(`    SAFE_DELETE now           : ${riskCounts.SAFE_DELETE}  (keyword unambiguous, 0 active listings)`)
  console.log(`    REVIEW first              : ${riskCounts.REVIEW}  (active listings or ambiguous keyword)`)
  console.log(`    FALSE_POSITIVE — keep     : ${riskCounts.FALSE_POSITIVE}`)
  console.log()
  console.log(`  Tier 3 — total candidates  : ${tier3Candidates.length.toLocaleString()}`)
  console.log(`    Estimated SAFE_DELETE     : ~${Math.round(tier3Candidates.length * tier3RiskCounts.SAFE_DELETE / Math.max(tier3Sample.length, 1)).toLocaleString()} (from sample extrapolation)`)
  console.log(`    Review first (sample %)   : ~${Math.round(tier3Candidates.length * tier3RiskCounts.REVIEW / Math.max(tier3Sample.length, 1))} rows need eyes`)
  console.log()
  console.log('  Suggested execution order:')
  console.log('    1. Soft-delete Tier 2 SAFE_DELETE rows (this script lists IDs above)')
  console.log('    2. Human reviews Tier 2 REVIEW rows — clear REVIEW ones → soft-delete')
  console.log('    3. Run Tier 3 with --include-tier3 flag once sample looks clean')
  console.log()
}

main()
  .catch(err => { console.error('\n❌ Fatal:', err); process.exit(1) })
  .finally(() => prisma.$disconnect())
