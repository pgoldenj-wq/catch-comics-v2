/**
 * cover-zero-cleanup.ts — Operation Cover Zero catalogue-pollution analysis + cleanup.
 *
 * DRY-RUN by default (no writes). Confidence-tiered classification of non-comic
 * pollution among LIVE canonical_products, reusing the safety guards proven in
 * purge-noncomic-canonicals-v2.ts (comic-format preserve, comic-publisher
 * preserve, comic title-signal preserve) plus the launch series registry.
 *
 * Only format=OTHER products are ever eligible — every typed comic format
 * (SINGLE_ISSUE/TPB/HARDCOVER/OMNIBUS/DELUXE/COMPENDIUM/MANGA_VOLUME/ABSOLUTE)
 * is preserved unconditionally. Comic publishers and comic title signals are
 * also preserved, so franchise companion books from comic publishers
 * (e.g. "Attack on Titan Encyclopedia — Kodansha") are never touched.
 *
 * Categories:
 *   AUTO  (≈99%)  CAT1 academic / reprint-mill publisher
 *   AUTO  (≈98%)  CAT2 unambiguous academic title (proceedings, textbook, GCSE…)
 *   REVIEW(≈70%)  CAT3 other non-comic (classifyText) or soft academic pattern
 *   REVIEW(≈60%)  CAT4 orphan: format=OTHER, 0 active listings, no comic signal
 *
 * Flags:
 *   (none)          dry-run report only — NO writes
 *   --execute-safe  soft-delete (deletedAt=NOW) CAT1 + CAT2 only; logs every id
 *
 * Run:
 *   npx dotenv -e .env.local -- tsx scripts/cover-zero-cleanup.ts
 *   npx dotenv -e .env.local -- tsx scripts/cover-zero-cleanup.ts --execute-safe
 */

import fs   from 'fs'
import path from 'path'
import { prisma }                          from '../lib/prisma'
import { classifyText, isStrongComic,
         COMIC_PUBLISHERS_EXACT }          from '../lib/search/isLikelyComic'
import { SERIES_REGISTRY }                 from '../lib/series/registry'

const ARGS         = process.argv.slice(2)
const EXECUTE_SAFE = ARGS.includes('--execute-safe')   // soft-delete CAT1+CAT2
const EXECUTE_CAT3 = ARGS.includes('--execute-cat3')   // soft-delete CAT3
const CAT3_REPORT  = ARGS.includes('--cat3-report') || EXECUTE_CAT3
const CAT4_REPORT  = ARGS.includes('--cat4-report')

// Word-boundary comic-franchise watchlist (avoids 'thor' matching "author").
const COMIC_WATCH_RX = [
  /\bbatman\b/i, /\bsuperman\b/i, /\bspider-?man\b/i, /\bx-men\b/i, /\bavengers\b/i,
  /\bjustice league\b/i, /\bwonder woman\b/i, /\bgreen lantern\b/i, /\bdeadpool\b/i,
  /\bwolverine\b/i, /\bnaruto\b/i, /\bone piece\b/i, /\bdragon ball\b/i, /\bbleach\b/i,
  /\bdemon slayer\b/i, /\bjujutsu\b/i, /\bmy hero academia\b/i, /\battack on titan\b/i,
  /\bchainsaw man\b/i, /\bdeath note\b/i, /\btokyo ghoul\b/i, /\bsailor moon\b/i,
  /\bhunter x hunter\b/i, /\bberserk\b/i, /\bvinland\b/i, /\bspy ?x ?family\b/i,
  /\bmanga\b/i, /\bmanhwa\b/i, /\bgraphic novel\b/i, /\bcomics?\b/i, /\bomnibus\b/i,
  /\bwalking dead\b/i, /\binvincible\b/i, /\bhellboy\b/i, /\bsandman\b/i, /\bwatchmen\b/i,
  /\btransformers\b/i, /\btmnt\b/i, /\bstar wars\b/i, /\bjudge dredd\b/i,
]

// ── Preserve: typed comic formats are never eligible ──────────────────────────
const ALWAYS_COMIC_FORMATS = new Set([
  'SINGLE_ISSUE','TPB','HARDCOVER','OMNIBUS','DELUXE','COMPENDIUM','MANGA_VOLUME','ABSOLUTE',
])

// ── Preserve: comic publishers (exact + substring net) ────────────────────────
const COMIC_PUBLISHER_SUBSTR = [
  'comic', 'manga', 'manhwa', 'manhua', 'graphic novel',
  'viz', 'kodansha', 'marvel', 'dc comics', 'image comics', 'dark horse',
  'idw', 'boom', 'titan', 'oni press', 'fantagraphics', 'dynamite', 'valiant',
  'yen press', 'yen on', 'seven seas', 'tokyopop', 'square enix', 'shueisha',
  'shogakukan', 'vertical', 'udon', 'graphix', 'first second', 'humanoids',
  'papercutz', 'ablaze', 'vault', 'drawn & quarterly', 'drawn and quarterly',
  'abrams comicarts', 'rebellion', '2000 ad', 'viz media',
  'archie', 'avatar press', 'antarctic press', 'lion forge',
  // additional manga/comic imprints + distributors (from purge-noncomic-v2 audit)
  'denpa', 'fakku', 'ghost ship', 'airship', 'sublime', 'one peace', 'nbm',
  'del rey', 'eurocomics', 'fanfare', 'star fruit', 'kodansha usa',
  'arotahi', 'hachette aotearoa', 'penguin random house nz', 'melia publishing',
  'aloha comics', 'scout comics', 'ahoy', 'slg publishing', 'humanoids inc',
  'dark horse', 'last gasp', 'oni-lion forge', 'magnetic press', 'ablaze publishing',
]

function isComicPublisher(pub: string | null): boolean {
  if (!pub) return false
  const p = pub.toLowerCase().trim()
  if (COMIC_PUBLISHERS_EXACT.has(p)) return true
  return COMIC_PUBLISHER_SUBSTR.some(s => p.includes(s))
}

// ── Preserve: comic title signals (mirrors purge-noncomic-canonicals-v2) ───────
const PRESERVE_TITLE = [
  /\b(vol\.?|volume)\s*\d/i,
  /\b(manga|manhwa|manhua)\b/i,
  /\b(omnibus|compendium|absolute|deluxe)\b/i,
  /\b(graphic novel|comic|comics|trade paperback|tpb)\b/i,
  /\b(issue|#\s*\d)\b/i,
  /\b(collected|collection)\b/i,
]
const hasPreserveSignal = (t: string) => PRESERVE_TITLE.some(p => p.test(t))

// ── CAT1: academic / reprint-mill publishers (≈99% non-comic) ─────────────────
const ACADEMIC_PUBLISHER_SUBSTR = [
  'springer', 'oxford university press', 'cambridge university press',
  'routledge', 'john wiley', 'wiley-blackwell', 'elsevier', 'palgrave',
  'mcgraw-hill', 'mcgraw hill', 'pearson education', 'sage publications',
  'taylor & francis', 'taylor and francis', 'igi global', 'emerald publishing',
  'emerald group', 'de gruyter', 'bentham', 'cengage', 'wolters kluwer',
  'lippincott', 'thieme', 'crc press', 'apress', 'morgan kaufmann',
  'academic press', 'world scientific', 'now publishers', 'iwa publishing',
  'martinus nijhoff', 'edward elgar', 'brill', 'mit press',
  'princeton university press', 'yale university press', 'harvard university press',
  'university of chicago press', 'manchester university press', 'bloomsbury academic',
  // public-domain reprint mills (academic/classics scans)
  'creative media partners', 'legare street', 'kessinger', 'palala', 'nabu press',
  'wentworth press', 'hansebooks', 'forgotten books', 'books on demand',
  'bibliolife', 'trieste publishing', 'alpha editions', 'sagwan press',
  'franklin classics', 'scholar select', 'andesite press', 'rarebooksclub',
  'pranava books', 'tredition', 'hachette livre',
]
const isAcademicPublisher = (pub: string | null) =>
  !!pub && ACADEMIC_PUBLISHER_SUBSTR.some(s => pub.toLowerCase().includes(s))

// ── CAT2: unambiguous academic titles (≈98% non-comic) ────────────────────────
const ACADEMIC_TITLE_HARD = [
  /\bproceedings\b/i, /\bconference on\b/i, /\bsymposium\b/i,
  /\binternational conference\b/i, /\bworkshop on\b/i,
  /\btextbook\b/i, /\bworkbook\b/i, /\bcoursebook\b/i, /\bstudy guide\b/i,
  /\brevision guide\b/i, /\bexam practice\b/i, /\bpast papers\b/i,
  /\bgcse\b/i, /\ba-level\b/i, /\bigcse\b/i, /\bkey stage\b/i, /\bks[1-5]\b/i,
  /\beleven plus\b/i, /\b11\+/i,
  /\bthesis\b/i, /\bdissertation\b/i, /\bjournal of\b/i, /\bquarterly journal\b/i,
  /\bbellum gallicum\b/i, /\bciceronis\b/i, /\bopera omnia\b/i, /\btreatise\b/i,
]
const hasHardAcademicTitle = (t: string) => ACADEMIC_TITLE_HARD.some(p => p.test(t))

// ── CAT3 soft academic patterns (review, not auto) ────────────────────────────
const ACADEMIC_TITLE_SOFT = [
  /\bintroduction to\b/i, /\bprinciples of\b/i, /\bfundamentals of\b/i,
  /\bhandbook of\b/i, /\bencyclop(a)?edia\b/i, /\bdictionary of\b/i,
  /\blectures on\b/i, /\b(mathematics|algebra|calculus|trigonometry)\b/i,
]
const hasSoftAcademicTitle = (t: string) => ACADEMIC_TITLE_SOFT.some(p => p.test(t))

// Launch-series CV volume ids — never delete (extra safety net).
const REGISTRY_CV_IDS = new Set(Object.values(SERIES_REGISTRY).map(e => e.cvVolumeId))

type Cat = 'CAT1' | 'CAT2' | 'CAT3' | 'CAT4'
interface Row {
  id: string; title: string; publisher: string | null; format: string
  comicvine_id: string | null; active_listings: bigint; total_listings: bigint
}
interface Flagged { row: Row; cat: Cat; reason: string }

function classify(row: Row): Flagged | null {
  const fmt   = row.format
  const pub   = row.publisher
  const title = row.title ?? ''

  // ── Preserve guards (never delete) ──
  if (fmt !== 'OTHER') return null                       // only OTHER is eligible
  if (isComicPublisher(pub)) return null
  if (hasPreserveSignal(title)) return null
  if (isStrongComic(title, pub)) return null
  if (row.comicvine_id && REGISTRY_CV_IDS.has(row.comicvine_id)) return null

  // ── AUTO tiers ──
  if (isAcademicPublisher(pub))   return { row, cat: 'CAT1', reason: `academic/reprint publisher: "${pub}"` }
  if (hasHardAcademicTitle(title)) return { row, cat: 'CAT2', reason: `academic title pattern` }

  // ── REVIEW tiers ──
  if (classifyText(`${title} ${pub ?? ''}`) === 'non-comic' || hasSoftAcademicTitle(title))
    return { row, cat: 'CAT3', reason: `non-comic signal (classifyText / soft academic)` }
  if (Number(row.active_listings) === 0)
    return { row, cat: 'CAT4', reason: `orphan: format=OTHER, 0 active listings, no comic signal` }

  return null
}

function sample(flagged: Flagged[], cat: Cat, n: number) {
  const list = flagged.filter(f => f.cat === cat)
  console.log(`\n── ${cat} (${list.length.toLocaleString()}) ── sample ${Math.min(n, list.length)}:`)
  for (const f of list.slice(0, n)) {
    const act = Number(f.row.active_listings)
    console.log(`   "${f.row.title.slice(0, 60).padEnd(60)}" | ${(f.row.publisher ?? '(none)').slice(0, 26).padEnd(26)} | act:${act} | ${f.reason}`)
  }
}

function pubBreakdown(list: Flagged[], topN: number) {
  const byPub = new Map<string, number>()
  for (const f of list) { const p = f.row.publisher ?? '(none)'; byPub.set(p, (byPub.get(p) ?? 0) + 1) }
  return [...byPub.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN)
}
const isComicAdjacentPub = (p: string | null) =>
  !!p && COMIC_PUBLISHER_SUBSTR.some(s => p.toLowerCase().includes(s))

function reportCat3(cat3: Flagged[]) {
  console.log('\n══════════ CAT3 DETAILED SAFETY REPORT ══════════')
  console.log(`  CAT3 total: ${cat3.length.toLocaleString()} (with active listings: ${cat3.filter(f => Number(f.row.active_listings) > 0).length})`)

  // 1. comic-franchise leakage (word-boundary)
  const leaks = cat3.filter(f => COMIC_WATCH_RX.some(rx => rx.test(f.row.title)))
  console.log(`\n  1) Comic-franchise title leakage: ${leaks.length}`)
  for (const f of leaks.slice(0, 40)) console.log(`     ⚠ "${f.row.title.slice(0, 60)}" | ${f.row.publisher ?? '(none)'}`)

  // 2. comic-adjacent publishers (should be ~0 — preserve guard already excludes them)
  const adjacent = cat3.filter(f => isComicAdjacentPub(f.row.publisher))
  console.log(`\n  2) Comic-adjacent publishers in CAT3: ${adjacent.length}`)
  for (const f of adjacent.slice(0, 40)) console.log(`     ⚠ "${f.row.title.slice(0, 50)}" | ${f.row.publisher}`)

  // 3. publisher breakdown
  console.log(`\n  3) CAT3 publishers (top 40):`)
  for (const [p, c] of pubBreakdown(cat3, 40)) {
    console.log(`     ${String(c).padStart(4)}  ${p.slice(0, 50)}${isComicAdjacentPub(p) ? '  ⚠ COMIC-ADJACENT' : ''}`)
  }

  // 4. 50 samples
  console.log(`\n  4) CAT3 sample (50):`)
  for (const f of cat3.slice(0, 50)) {
    console.log(`     "${f.row.title.slice(0, 62).padEnd(62)}" | ${(f.row.publisher ?? '(none)').slice(0, 24)} | act:${Number(f.row.active_listings)}`)
  }
  return { leaks: leaks.length, adjacent: adjacent.length }
}

function reportCat4(cat4: Flagged[]) {
  console.log('\n══════════ CAT4 ANALYSIS — NOT DELETED (post-launch strategy input) ══════════')
  const cvLinked    = cat4.filter(f => f.row.comicvine_id)
  const hadListings = cat4.filter(f => Number(f.row.total_listings) > 0)
  const adjacent    = cat4.filter(f => isComicAdjacentPub(f.row.publisher))
  console.log(`  CAT4 total (format=OTHER, 0 active listings): ${cat4.length.toLocaleString()}`)
  console.log(`  ── likely-legitimate clusters to PRESERVE ──`)
  console.log(`    CV-linked (comicvine_id set)            : ${cvLinked.length.toLocaleString()}`)
  console.log(`    Comic-adjacent publisher                : ${adjacent.length.toLocaleString()}`)
  console.log(`    Had listings at some point (now inactive): ${hadListings.length.toLocaleString()}`)
  console.log(`    Pure orphans (no CV, no listings ever)  : ${cat4.filter(f => !f.row.comicvine_id && Number(f.row.total_listings) === 0).length.toLocaleString()}`)

  console.log(`\n  ── CAT4 by publisher (top 30) ──`)
  for (const [p, c] of pubBreakdown(cat4, 30)) {
    console.log(`    ${String(c).padStart(5)}  ${p.slice(0, 48)}${isComicAdjacentPub(p) ? '  ⚠ comic-adjacent' : ''}`)
  }
  console.log(`\n  ── CV-linked CAT4 samples (likely real comics — must NOT be deleted) ──`)
  for (const f of cvLinked.slice(0, 25)) {
    console.log(`    "${f.row.title.slice(0, 52).padEnd(52)}" | ${(f.row.publisher ?? '(none)').slice(0, 22)} | cv:${f.row.comicvine_id}`)
  }
}

async function softDelete(list: Flagged[], label: string) {
  const ids = list.map(f => f.row.id)
  const logPath = path.join(__dirname, `.cover-zero-cleanup-log-${label}-${Date.now()}.json`)
  fs.writeFileSync(logPath, JSON.stringify(
    list.map(f => ({ id: f.row.id, title: f.row.title, publisher: f.row.publisher, cat: f.cat, reason: f.reason })), null, 2))
  console.log(`\n  Wrote reversible log: ${logPath}`)
  const result = await prisma.canonicalProduct.updateMany({
    where: { id: { in: ids }, deletedAt: null }, data: { deletedAt: new Date() },
  })
  console.log(`  ✅ Soft-deleted ${result.count.toLocaleString()} products (${label}).`)
  const nowLive = await prisma.canonicalProduct.count({ where: { deletedAt: null } })
  console.log(`  Live canonicals now: ${nowLive.toLocaleString()}`)
  console.log(`  To reverse: set deletedAt=null for the ids in the log file.`)
}

async function main() {
  console.log('═'.repeat(72))
  console.log(`  OPERATION COVER ZERO — pollution cleanup  ${EXECUTE_SAFE ? '[EXECUTE-SAFE]' : '[DRY RUN]'}`)
  console.log('═'.repeat(72))

  const liveTotal    = await prisma.canonicalProduct.count({ where: { deletedAt: null } })
  const alreadyDel   = await prisma.canonicalProduct.count({ where: { deletedAt: { not: null } } })
  console.log(`  Live canonicals          : ${liveTotal.toLocaleString()}`)
  console.log(`  Already soft-deleted      : ${alreadyDel.toLocaleString()}`)

  console.log('  Loading live canonicals with active-listing counts …')
  const rows = await prisma.$queryRawUnsafe<Row[]>(`
    SELECT cp.id, cp.title, cp.publisher, cp.format::text AS format, cp.comicvine_id,
           COUNT(rl.id) FILTER (
             WHERE rl.deleted_at IS NULL AND rl.stock_status IN ('IN_STOCK','LOW_STOCK','PREORDER')
           ) AS active_listings,
           COUNT(rl.id) AS total_listings
      FROM canonical_products cp
      LEFT JOIN retailer_listings rl ON rl.canonical_product_id = cp.id
     WHERE cp.deleted_at IS NULL
     GROUP BY cp.id, cp.title, cp.publisher, cp.format, cp.comicvine_id
  `)
  console.log(`  Loaded ${rows.length.toLocaleString()} rows`)

  const flagged: Flagged[] = []
  for (const r of rows) { const f = classify(r); if (f) flagged.push(f) }

  const byCat = (c: Cat) => flagged.filter(f => f.cat === c)
  const cat1 = byCat('CAT1'), cat2 = byCat('CAT2'), cat3 = byCat('CAT3'), cat4 = byCat('CAT4')
  const autoCount = cat1.length + cat2.length
  const withActive = (l: Flagged[]) => l.filter(f => Number(f.row.active_listings) > 0).length

  console.log('\n── SUMMARY ──────────────────────────────────────────────────────────')
  console.log(`  CAT1 academic/reprint publisher (AUTO ≈99%) : ${cat1.length.toLocaleString()}  (w/ active listings: ${withActive(cat1)})`)
  console.log(`  CAT2 academic title           (AUTO ≈98%) : ${cat2.length.toLocaleString()}  (w/ active listings: ${withActive(cat2)})`)
  console.log(`  CAT3 other non-comic        (REVIEW ≈70%) : ${cat3.length.toLocaleString()}  (w/ active listings: ${withActive(cat3)})`)
  console.log(`  CAT4 orphan OTHER/0-listing (REVIEW ≈60%) : ${cat4.length.toLocaleString()}`)
  console.log(`  ─────────────────────────────────────────────`)
  console.log(`  AUTO-safe total (CAT1+CAT2)               : ${autoCount.toLocaleString()}`)
  console.log(`  REVIEW total (CAT3+CAT4)                  : ${(cat3.length + cat4.length).toLocaleString()}`)
  console.log(`  Total flagged                            : ${flagged.length.toLocaleString()} of ${liveTotal.toLocaleString()} (${((flagged.length/liveTotal)*100).toFixed(1)}%)`)

  sample(flagged, 'CAT1', 25)
  sample(flagged, 'CAT2', 25)
  sample(flagged, 'CAT3', 30)
  sample(flagged, 'CAT4', 20)

  // ── Deterministic comic-franchise leakage scan over the AUTO set ───────────
  // If any CAT1/CAT2 candidate's title contains a comic/manga franchise token
  // the preserve guards missed, surface it BEFORE deleting. Expect ~0.
  const COMIC_WATCHLIST = [
    'batman','superman','spider-man','spiderman','x-men','avengers','justice league',
    'wonder woman','green lantern','the flash','iron man','captain america','wolverine',
    'deadpool','daredevil','punisher','hulk','thor','fantastic four','teen titans',
    'naruto','one piece','dragon ball','bleach','demon slayer','jujutsu kaisen','my hero academia',
    'attack on titan','chainsaw man','death note','tokyo ghoul','fullmetal alchemist','sailor moon',
    'one-punch','one punch','hunter x hunter','berserk','vinland saga','spy x family','frieren',
    'walking dead','invincible','saga ','hellboy','sandman','watchmen','sin city','preacher',
    'transformers','tmnt','teenage mutant','star wars','judge dredd','asterix','tintin',
    'manga','graphic novel',' comic',
  ]
  const autoSet = [...cat1, ...cat2]
  const leaks = autoSet.filter(f => {
    const t = f.row.title.toLowerCase()
    return COMIC_WATCHLIST.some(w => t.includes(w))
  })
  console.log(`\n── COMIC-FRANCHISE LEAKAGE SCAN over AUTO set (${autoSet.length.toLocaleString()}) ──`)
  console.log(`   Possible false positives (title contains a comic token): ${leaks.length}`)
  for (const f of leaks.slice(0, 40)) {
    console.log(`   ⚠ [${f.cat}] "${f.row.title.slice(0, 64)}" | ${f.row.publisher ?? '(none)'}`)
  }

  // Always dump the full AUTO candidate list for independent review.
  const dumpPath = path.join(__dirname, '.cover-zero-candidates-auto.txt')
  fs.writeFileSync(dumpPath, autoSet
    .map(f => `${f.cat}\t${f.row.publisher ?? '(none)'}\t${f.row.title}`)
    .join('\n'))
  console.log(`   Full AUTO candidate dump (${autoSet.length.toLocaleString()} rows): ${dumpPath}`)

  if (CAT3_REPORT) reportCat3(cat3)
  if (CAT4_REPORT) reportCat4(cat4)

  if (EXECUTE_CAT3) {
    // Final safety gate: never delete a CAT3 row from a comic-adjacent publisher
    // or whose title trips the franchise watchlist, even if it reached CAT3.
    const safe    = cat3.filter(f => !isComicAdjacentPub(f.row.publisher) && !COMIC_WATCH_RX.some(rx => rx.test(f.row.title)))
    const blocked = cat3.length - safe.length
    console.log(`\n── EXECUTE CAT3 ──  eligible: ${cat3.length}  ·  blocked by final safety gate: ${blocked}  ·  deleting: ${safe.length}`)
    await softDelete(safe, 'cat3')
    return
  }

  if (EXECUTE_SAFE) {
    await softDelete([...cat1, ...cat2], 'cat1cat2')
    return
  }

  console.log('\n  DRY RUN — no writes.')
  console.log('  --execute-safe → soft-delete CAT1+CAT2   ·   --execute-cat3 → soft-delete CAT3')
  console.log('  --cat3-report  → CAT3 detail             ·   --cat4-report  → CAT4 analysis')
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
