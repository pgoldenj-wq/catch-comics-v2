#!/usr/bin/env tsx
/**
 * scripts/purge-noncomic-canonicals-v2.ts
 *
 * Identifies non-comic canonical_products for safe cleanup.
 * DRY-RUN ONLY by default. Does not write or delete anything.
 *
 * BACKGROUND
 * ──────────
 * When Travelling Man was first synced (before the comic_filter was added),
 * ~15,922 non-comic listings (board games, RPGs, miniatures, merch) were
 * ingested. Those listings were soft-deleted in Week 1. However, the
 * seed-canonical-from-listings.ts script had ALREADY created canonical_products
 * for many of them. Those canonicals now have zero active listings and no
 * path back to a real comic product.
 *
 * A separate contamination source: the enrichment pipeline enriches by ISBN
 * and may have ingested ISBNs from academic, educational, or general trade
 * publishers that happened to appear in the retailer_listings table.
 *
 * SCHEMA NOTE
 * ───────────
 * canonical_products has NO deleted_at column. The safest cleanup approach is:
 *
 *   OPTION A (recommended): Add deleted_at to canonical_products via migration.
 *     - Additive, zero data loss, fully reversible
 *     - Migration: ALTER TABLE canonical_products ADD COLUMN deleted_at TIMESTAMPTZ;
 *     - Then this script can soft-delete instead of hard-delete
 *
 *   OPTION B (simpler, used if migration not desired):
 *     - Export flagged rows to a backup JSON file
 *     - Hard-delete from DB (rows have no external dependencies beyond retailer_listings FK)
 *     - The FK on retailer_listings.canonical_product_id is ON DELETE SET NULL, so the
 *       listing stays but loses its canonical link (it becomes unmatched again)
 *     - The backup JSON allows restore if needed
 *
 *   OPTION C (conservative, no schema change, no deletion):
 *     - Just unlink: SET canonical_product_id = NULL on any listing linked to a flagged canonical
 *     - Then ignore the orphan canonical rows — they don't appear in search (queryA) because
 *       they have no offers, and they appear in sitemap (which is a minor SEO noise issue)
 *
 * DETECTION TIERS
 * ───────────────
 * Tier 1 — Publisher blocklist (highest confidence, ~370+ rows)
 *   Academic, educational, and clearly non-comic publishers identified by the data audit.
 *   Safe to delete with or without backup.
 *
 * Tier 2 — Title keyword signals (high confidence, smaller set)
 *   Titles containing words like "maths", "textbook", "workbook" etc.
 *   Cross-checked against active listings to ensure no false positives.
 *
 * Tier 3 — Orphaned zero-listing canonicals (medium confidence, large set)
 *   Canonicals with format=OTHER, no comic publisher, and ZERO active retailer listings.
 *   These are almost certainly the canonicals created from the now-deleted non-comic
 *   TM listings. Safe to remove but should be reviewed before live run.
 *
 * Usage:
 *   npx dotenv -e .env.local -- npx tsx scripts/purge-noncomic-canonicals-v2.ts
 *   npx dotenv -e .env.local -- npx tsx scripts/purge-noncomic-canonicals-v2.ts --soft-delete
 *   npx dotenv -e .env.local -- npx tsx scripts/purge-noncomic-canonicals-v2.ts --soft-delete --include-tier2
 *
 * Flags:
 *   (none)           dry-run report only, no DB writes
 *   --soft-delete    sets deleted_at = NOW() for Tier 1 rows (confirmed non-comic publishers)
 *   --include-tier2  also soft-deletes Tier 2 (title keyword matches) — review Tier 2 first
 */

import { prisma } from '../lib/prisma'

// ── CLI flags ─────────────────────────────────────────────────────────────────
const ARGS          = process.argv.slice(2)
const SOFT_DELETE   = ARGS.includes('--soft-delete')   // set deleted_at = NOW()
const INCLUDE_TIER2 = ARGS.includes('--include-tier2') // also soft-delete Tier 2
const DRY_RUN       = !SOFT_DELETE

// ── Publisher blocklist ────────────────────────────────────────────────────────
// These are CONFIRMED non-comic publishers from the data audit.
// None of these publish comics, manga, or graphic novels.
const NON_COMIC_PUBLISHERS_EXACT = new Set([
  'BRILL',
  'Brill',
  'Brill Academic Publishers',
  'Martinus Nijhoff Publishers',   // Brill imprint
  'Creative Media Partners, LLC',  // Public domain reprints (academic/classics)
  'Legare Street Press',           // Public domain reprints
  'Kessinger Publishing, LLC',     // Public domain reprints
  'Kessinger Publishing',          // Public domain reprints (alt spelling in DB)
  'McGill-Queen\'s University Press',
  'Hachette Livre - Bnf',          // French digitized historical texts
  'IWA Publishing',                // International Water Association
  'Hachette Livre BNF',
  // REMOVED — confirmed legitimate manga publishers/distributors (⚠ Day 5C ④ audit):
  // 'Arotahi Agency'                → NZ manga distributor (One Punch Man, JoJo, Fly Me to the Moon…)
  // 'Hachette Aotearoa New Zealand' → NZ manga imprint (Battle Royale Deluxe, Re:ZERO…)
  // 'Penguin Random House NZ'       → NZ comics/manga publisher (Apothecary Diaries, Absolute Flash…)
  // 'Melia Publishing Services Limited' → manga/BL distributor (Acid Town, Crossplay Love…)
])

// Publishers that are borderline / partial — only flag if also format=OTHER and no active listings
const BORDERLINE_PUBLISHERS = new Set([
  'Andrews McMeel Publishing',     // Mostly calendars/puzzles; also Peanuts, Calvin & Hobbes etc — do NOT auto-delete
])

// ── Known comic publishers — never delete these rows ──────────────────────────
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
  // NZ distributors/imprints confirmed as comics/manga (Day 5C ④ audit):
  'Arotahi Agency',                // NZ manga distributor (One Punch Man, JoJo, Fly Me to the Moon…)
  'Hachette Aotearoa New Zealand', // NZ manga imprint (Battle Royale, Re:ZERO…)
  'Penguin Random House NZ',       // NZ comics/manga arm (Apothecary Diaries, Absolute Flash…)
  'Melia Publishing Services Limited', // manga/BL distributor (Acid Town, Crossplay Love…)
])

// ── Title keyword signals (non-comic indicators) ──────────────────────────────
const NON_COMIC_TITLE_PATTERNS = [
  /\b(maths?|mathematics|arithmetic)\b/i,
  /\b(textbook|coursebook|workbook|exercise book|study guide)\b/i,
  /\b(grammar|vocabulary|comprehension)\b/i,
  /\b(chemistry|physics|biology|science|gcse|a-level|a level)\b/i,
  /\b(11\+|eleven plus)\b/i,
  /\b(dissertation|thesis|proceedings|journal of)\b/i,
  /\b(law reports?|legislation|statutes?)\b/i,
]

// ── Safe comic-adjacent keywords (preserve these even if no publisher) ────────
// If a title contains any of these, do NOT flag it regardless of other signals.
const PRESERVE_IF_TITLE_CONTAINS = [
  /\b(vol\.?|volume)\s*\d/i,
  /\b(manga|manhwa|manhua)\b/i,
  /\b(omnibus|compendium|absolute|deluxe)\b/i,
  /\b(graphic novel|comic|comics|trade paperback|tpb)\b/i,
  /\b(issue|#\s*\d)\b/i,
  /\b(collected|collection|edition)\b/i,
]

function hasPreserveSignal(title: string): boolean {
  return PRESERVE_IF_TITLE_CONTAINS.some(p => p.test(title))
}

function hasNonComicTitleSignal(title: string): boolean {
  if (hasPreserveSignal(title)) return false
  return NON_COMIC_TITLE_PATTERNS.some(p => p.test(title))
}

// ── Formats that are always comic — never delete ───────────────────────────────
const ALWAYS_COMIC_FORMATS = new Set([
  'SINGLE_ISSUE', 'TPB', 'HARDCOVER', 'OMNIBUS',
  'DELUXE', 'COMPENDIUM', 'MANGA_VOLUME', 'ABSOLUTE',
])

// ── Main ───────────────────────────────────────────────────────────────────────

interface CanonicalRow {
  id:              string
  title:           string
  publisher:       string | null
  format:          string
  isbn13:          string | null
  active_listings: bigint
  total_listings:  bigint
}

async function main() {
  console.log(`\n${'═'.repeat(70)}`)
  console.log(`  purge-noncomic-canonicals-v2 — DRY RUN`)
  console.log(`  (no writes — review output before proceeding)`)
  console.log(`${'═'.repeat(70)}\n`)

  // ── 1. Total canonical count ─────────────────────────────────────────────────
  const totalResult = await prisma.$queryRaw<[{ n: bigint }]>`
    SELECT COUNT(*) AS n FROM canonical_products
  `
  const total = Number(totalResult[0].n)
  console.log(`  Total canonical products : ${total.toLocaleString()}\n`)

  // ── 2. Load all canonicals with active listing counts ────────────────────────
  // Active = deleted_at IS NULL and stock not OUT_OF_STOCK
  // We use a LEFT JOIN + GROUP BY so zero-listing canonicals appear.
  // IMPORTANT: do NOT select raw_data — only structured columns.
  console.log('  Loading canonicals with listing counts …')
  const rows = await prisma.$queryRaw<CanonicalRow[]>`
    SELECT
      cp.id,
      cp.title,
      cp.publisher,
      cp.format::text AS format,
      cp.isbn_13 AS isbn13,
      COUNT(rl.id) FILTER (
        WHERE rl.deleted_at IS NULL
          AND rl.stock_status IN ('IN_STOCK','LOW_STOCK','PREORDER')
      ) AS active_listings,
      COUNT(rl.id) AS total_listings
    FROM canonical_products cp
    LEFT JOIN retailer_listings rl ON rl.canonical_product_id = cp.id
    GROUP BY cp.id, cp.title, cp.publisher, cp.format, cp.isbn_13
    ORDER BY active_listings ASC, cp.publisher ASC
  `
  console.log(`  Loaded ${rows.length.toLocaleString()} rows\n`)

  // ── 3. Classify each row ─────────────────────────────────────────────────────

  type Tier = 1 | 2 | 3
  interface Flagged {
    row:    CanonicalRow
    tier:   Tier
    reason: string
  }

  const flagged:   Flagged[] = []
  const preserved: CanonicalRow[] = []

  for (const row of rows) {
    const activeListing = Number(row.active_listings)
    const fmt   = row.format
    const pub   = row.publisher ?? ''
    const title = row.title

    // NEVER flag these — they are definitively comics
    if (ALWAYS_COMIC_FORMATS.has(fmt)) {
      preserved.push(row)
      continue
    }

    // NEVER flag if a comic publisher
    if (pub && COMIC_PUBLISHERS.has(pub)) {
      preserved.push(row)
      continue
    }

    // NEVER flag if title has clear comic preserve signals
    if (hasPreserveSignal(title)) {
      preserved.push(row)
      continue
    }

    // Tier 1: publisher blocklist match
    if (NON_COMIC_PUBLISHERS_EXACT.has(pub)) {
      flagged.push({ row, tier: 1, reason: `Publisher blocklist: "${pub}"` })
      continue
    }

    // Tier 2: title keyword signal (only format=OTHER rows)
    if (fmt === 'OTHER' && hasNonComicTitleSignal(title)) {
      flagged.push({ row, tier: 2, reason: `Non-comic title keyword: "${title.slice(0, 60)}"` })
      continue
    }

    // Tier 3: orphaned + no comic publisher + format=OTHER + no active listings
    if (
      fmt === 'OTHER' &&
      activeListing === 0 &&
      !COMIC_PUBLISHERS.has(pub)
    ) {
      flagged.push({ row, tier: 3, reason: `Orphaned: format=OTHER, 0 active listings, unknown publisher "${pub || '(none)'}"` })
      continue
    }

    preserved.push(row)
  }

  // ── 4. Report ─────────────────────────────────────────────────────────────────

  const tier1 = flagged.filter(f => f.tier === 1)
  const tier2 = flagged.filter(f => f.tier === 2)
  const tier3 = flagged.filter(f => f.tier === 3)

  const tier1Active = tier1.filter(f => Number(f.row.active_listings) > 0)
  const tier2Active = tier2.filter(f => Number(f.row.active_listings) > 0)
  const tier3Active = tier3.filter(f => Number(f.row.active_listings) > 0)  // should be 0

  console.log('── SUMMARY ──────────────────────────────────────────────────────────')
  console.log(`  Total canonicals         : ${total.toLocaleString()}`)
  console.log(`  Preserved (clean)        : ${preserved.length.toLocaleString()}`)
  console.log(`  Flagged total            : ${flagged.length.toLocaleString()}  (${((flagged.length / total) * 100).toFixed(1)}% of all)`)
  console.log(`    Tier 1 — publisher     : ${tier1.length.toLocaleString()}`)
  console.log(`    Tier 2 — title keyword : ${tier2.length.toLocaleString()}`)
  console.log(`    Tier 3 — orphaned      : ${tier3.length.toLocaleString()}`)
  console.log()
  console.log(`  ⚠ Flagged WITH active listings (review before deleting):`)
  console.log(`    Tier 1 w/ active : ${tier1Active.length}`)
  console.log(`    Tier 2 w/ active : ${tier2Active.length}`)
  console.log(`    Tier 3 w/ active : ${tier3Active.length}  (should be 0 by design)`)
  console.log()

  // ── 5. Tier 1 examples ───────────────────────────────────────────────────────
  console.log('── TIER 1 — PUBLISHER BLOCKLIST (sample 20) ─────────────────────────')
  for (const f of tier1.slice(0, 20)) {
    const active = Number(f.row.active_listings)
    const flag   = active > 0 ? '  ⚠ HAS ACTIVE LISTING' : ''
    console.log(`  [${f.row.format.padEnd(12)}] "${f.row.title.slice(0, 55).padEnd(55)}" | ${f.reason}${flag}`)
  }
  if (tier1.length > 20) console.log(`  … and ${tier1.length - 20} more`)
  console.log()

  // ── 6. Tier 2 examples ───────────────────────────────────────────────────────
  console.log('── TIER 2 — TITLE KEYWORD (all, capped at 30) ──────────────────────')
  for (const f of tier2.slice(0, 30)) {
    const active = Number(f.row.active_listings)
    const flag   = active > 0 ? '  ⚠ HAS ACTIVE LISTING' : ''
    console.log(`  [${f.row.format.padEnd(12)}] "${f.row.title.slice(0, 55).padEnd(55)}" | pub: ${(f.row.publisher ?? '(none)').slice(0, 30)}${flag}`)
  }
  if (tier2.length > 30) console.log(`  … and ${tier2.length - 30} more`)
  console.log()

  // ── 7. Tier 3 examples ───────────────────────────────────────────────────────
  console.log('── TIER 3 — ORPHANED format=OTHER (sample 30) ──────────────────────')
  for (const f of tier3.slice(0, 30)) {
    console.log(`  [pub: ${(f.row.publisher ?? '(none)').slice(0, 30).padEnd(30)}] "${f.row.title.slice(0, 55)}"`)
  }
  if (tier3.length > 30) console.log(`  … and ${tier3.length - 30} more`)
  console.log()

  // ── 8. Preserved examples ────────────────────────────────────────────────────
  console.log('── PRESERVED (first 20, to verify no false negatives) ───────────────')
  for (const r of preserved.slice(0, 20)) {
    console.log(`  [${r.format.padEnd(12)}] "${r.title.slice(0, 55).padEnd(55)}" | ${r.publisher ?? '(no pub)'}`)
  }
  console.log()

  // ── 9. Risk assessment ───────────────────────────────────────────────────────
  console.log('── RISK ASSESSMENT ──────────────────────────────────────────────────')
  console.log()
  console.log('  Tier 1 risk : LOW — blocklisted publishers are definitively non-comic.')
  if (tier1Active.length > 0) {
    console.log(`  ⚠ WARNING: ${tier1Active.length} Tier 1 rows have active listings — investigate before deleting.`)
  } else {
    console.log('  ✓ No Tier 1 rows have active listings. Safe to delete.')
  }
  console.log()
  console.log('  Tier 2 risk : LOW-MED — title keyword matches, but review manually.')
  if (tier2Active.length > 0) {
    console.log(`  ⚠ WARNING: ${tier2Active.length} Tier 2 rows have active listings — manual review required.`)
  }
  console.log()
  console.log('  Tier 3 risk : MED — orphaned by design (TM soft-delete), but large set.')
  console.log('  Review sample manually: some may be light novels or illustrated books')
  console.log('  that should be preserved. Recommend reviewing first 50 before live run.')
  console.log()

  // ── 10. Schema recommendation ────────────────────────────────────────────────
  console.log('── SCHEMA RECOMMENDATION ────────────────────────────────────────────')
  console.log()
  console.log('  canonical_products has NO deleted_at column.')
  console.log()
  console.log('  RECOMMENDED: Add deleted_at via additive migration before live run:')
  console.log()
  console.log('    -- In a new Prisma migration:')
  console.log('    ALTER TABLE canonical_products')
  console.log('      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;')
  console.log()
  console.log('  Then add to schema.prisma CanonicalProduct model:')
  console.log('    deletedAt  DateTime? @map("deleted_at")')
  console.log()
  console.log('  This lets this script soft-delete instead of hard-delete,')
  console.log('  making cleanup fully reversible without a JSON backup.')
  console.log()
  console.log('  ALTERNATIVE (if migration not desired today):')
  console.log('  Run with --export flag to dump flagged rows to a JSON backup,')
  console.log('  then hard-delete. The retailer_listings FK is ON DELETE SET NULL,')
  console.log('  so soft-deleted TM listings are already unlinked anyway.')
  console.log()

  // ── 11. Cleanup command preview ──────────────────────────────────────────────
  console.log('── SAFE CLEANUP ORDER ───────────────────────────────────────────────')
  console.log()
  console.log('  Step 1: Add deleted_at migration (recommended) or skip to Step 2B')
  console.log()
  console.log('  Step 2A (with deleted_at): run this script with --soft-delete flag')
  console.log('          Sets deleted_at = NOW() for Tier 1 + Tier 2 rows only.')
  console.log('          Tier 3 requires --include-tier3 after manual review.')
  console.log()
  console.log('  Step 2B (without deleted_at): run with --export then --hard-delete-t1t2')
  console.log('          Exports to .json, then hard-deletes Tier 1 + Tier 2 only.')
  console.log()
  console.log('  Step 3: Verify sitemap, search, homepage still work correctly.')
  console.log('  Step 4: If Tier 3 sample looks clean, rerun with --include-tier3.')
  console.log()

  // ── 12. Final stat line ───────────────────────────────────────────────────────
  const safeToDelete = tier1.length + tier2.length
  console.log('── BOTTOM LINE ──────────────────────────────────────────────────────')
  console.log()
  console.log(`  Tier 1 + 2 (safe to delete)  : ${safeToDelete.toLocaleString()} canonicals`)
  console.log(`  Tier 3 (review first)         : ${tier3.length.toLocaleString()} canonicals`)
  console.log(`  Total potential cleanup       : ${flagged.length.toLocaleString()} of ${total.toLocaleString()} (${((flagged.length / total) * 100).toFixed(1)}%)`)
  console.log(`  Canonicals remaining          : ${(total - flagged.length).toLocaleString()}`)
  console.log()

  // ── 13. Soft-delete ──────────────────────────────────────────────────────────
  if (DRY_RUN) {
    console.log('  Mode: DRY RUN — pass --soft-delete to apply (Tier 1 only by default).')
    console.log('         Add --include-tier2 to also soft-delete Tier 2 rows.')
    console.log()
    return
  }

  // Build the set of IDs to soft-delete
  const toDelete = INCLUDE_TIER2
    ? [...tier1, ...tier2]
    : tier1

  if (toDelete.length === 0) {
    console.log('  ✓ Nothing to soft-delete.')
    return
  }

  console.log(`── SOFT-DELETE ───────────────────────────────────────────────────────`)
  console.log()
  console.log(`  Tiers to process : Tier 1${INCLUDE_TIER2 ? ' + Tier 2' : ' only'}`)
  console.log(`  Rows to mark     : ${toDelete.length}`)
  console.log()

  // Skip any already soft-deleted
  const ids = toDelete.map(f => f.row.id)
  const already = await prisma.canonicalProduct.count({
    where: { id: { in: ids }, deletedAt: { not: null } },
  })
  if (already > 0) {
    console.log(`  (${already} already have deletedAt set — will skip those)`)
  }

  const result = await prisma.canonicalProduct.updateMany({
    where: { id: { in: ids }, deletedAt: null },
    data:  { deletedAt: new Date() },
  })

  console.log(`  ✅ Soft-deleted ${result.count} canonical products.`)
  console.log()

  // Post-delete stats
  const remaining = await prisma.canonicalProduct.count({ where: { deletedAt: null } })
  const totalAll  = await prisma.canonicalProduct.count()
  console.log(`  Live canonicals  : ${remaining.toLocaleString()} of ${totalAll.toLocaleString()} total`)
  console.log()
}

main()
  .catch(err => { console.error('\n❌ Fatal:', err); process.exit(1) })
  .finally(() => prisma.$disconnect())
