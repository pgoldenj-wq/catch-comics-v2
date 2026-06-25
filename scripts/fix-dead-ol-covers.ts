/**
 * fix-dead-ol-covers.ts — Phase 2 of the launch cover-gap fix.
 *
 * Root cause (proven in Phase 1): ~9,909 products have cover_image_url pointing
 * at a bare Open Library URL that returns a 1×1 dead GIF. They count as
 * "covered" (non-null) but render blank, and — because isBadCoverUrl treats a
 * bare OL URL as valid — they suppress every fallback. Every prior recovery
 * pass filtered cover_image_url IS NULL, so these were systematically skipped.
 *
 * Two reversible passes (run together):
 *   Pass A — BACKFILL: for comic-eligible products whose cover is OL-direct and
 *            which have a usable retailer image (cdn.shopify.com etc.), download
 *            it to R2 via downloadAndStoreCover (dimension + placeholder-hash
 *            guarded). Replaces the dead URL with a real cover.
 *   Pass B — NULL: any remaining OL-direct cover that probes dead (?default=false
 *            → 404 / non-image) is nulled, so the metric is honest and fallbacks
 *            (live-CV hero, letter-initial) engage. Genuine OL covers are kept.
 *
 * Reversible: every mutation logs { id, oldCover, action, newCover }.
 *
 *   npx dotenv -e .env.local -- tsx scripts/fix-dead-ol-covers.ts            # dry-run
 *   npx dotenv -e .env.local -- tsx scripts/fix-dead-ol-covers.ts --named    # dry, named examples only
 *   npx dotenv -e .env.local -- tsx scripts/fix-dead-ol-covers.ts --execute  # mutate
 */
import fs from 'fs'
import path from 'path'
import { prisma } from '../lib/prisma'
import { classifyText } from '../lib/search/isLikelyComic'
import { downloadAndStoreCover } from '../lib/images/download'

const EXECUTE = process.argv.includes('--execute')
const NAMED_ONLY = process.argv.includes('--named')
const TYPED = new Set(['SINGLE_ISSUE','TPB','HARDCOVER','OMNIBUS','DELUXE','COMPENDIUM','MANGA_VOLUME','ABSOLUTE'])
const NAMED_ISBNS = new Set(['9781302958282','9781302958299','9781302960131','9781779516602','9781779520456'])

// Accessibility rank for retailer images — lower tried first. Bookshop 403s.
function rank(url: string): number {
  if (url.includes('bookshop.org')) return 9
  if (url.includes('cdn.shopify.com')) return 1
  if (url.includes('media-amazon') || url.includes('images-amazon')) return 2
  return 5
}
function isComicEligible(p: { format: string; comicvineId: string | null; title: string; publisher: string | null }) {
  return TYPED.has(p.format) || !!p.comicvineId || classifyText(`${p.title} ${p.publisher ?? ''}`) === 'comic'
}

interface LogEntry { id: string; isbn: string | null; title: string; oldCover: string | null; action: 'backfill' | 'null'; newCover: string | null }
const log: LogEntry[] = []

async function pool<T>(items: T[], n: number, fn: (t: T, i: number) => Promise<void>) {
  let idx = 0
  await Promise.all([...Array(Math.min(n, items.length))].map(async () => {
    while (idx < items.length) { const i = idx++; await fn(items[i], i) }
  }))
}

/** HEAD-probe an OL URL with ?default=false. true = dead (404/non-image). */
async function olIsDead(url: string): Promise<boolean> {
  const probe = url + (url.includes('?') ? '&' : '?') + 'default=false'
  try {
    const r = await fetch(probe, { method: 'GET', signal: AbortSignal.timeout(12000), headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (!r.ok) return true
    const ct = r.headers.get('content-type') ?? ''
    if (!ct.startsWith('image/')) return true
    const len = parseInt(r.headers.get('content-length') ?? '0', 10)
    return len > 0 && len < 200            // 43b dead GIF ≪ 200; real covers are KBs
  } catch { return true }
}

async function main() {
  const sel = { id: true, isbn13: true, title: true, format: true, publisher: true, comicvineId: true, coverImageUrl: true,
    listings: { where: { deletedAt: null }, select: { imageUrl: true } } } as const

  // ── Pass A: backfill comic-eligible OL-direct products that have a retailer image
  const olProducts = await prisma.canonicalProduct.findMany({
    where: { deletedAt: null, coverImageUrl: { contains: 'openlibrary.org' } },
    select: sel,
  })
  const namedFilter = (p: { isbn13: string | null }) => !NAMED_ONLY || NAMED_ISBNS.has(p.isbn13 ?? '')
  const backfillable = olProducts.filter(p => namedFilter(p) && isComicEligible(p) &&
    p.listings.some(l => l.imageUrl))
  console.log(`OL-direct products: ${olProducts.length}  ·  comic-eligible w/ retailer image: ${backfillable.length}  [${EXECUTE ? 'EXECUTE' : 'DRY'}]`)

  let backfilled = 0, backfillFailed = 0
  await pool(backfillable, EXECUTE ? 8 : 16, async (p) => {
    const urls = [...new Set(p.listings.map(l => l.imageUrl).filter((u): u is string => !!u))].sort((a, b) => rank(a) - rank(b))
    if (NAMED_ONLY) { console.log(`  named ${p.isbn13} ${p.title.slice(0,40)} → ${urls[0]}`); return }
    if (!EXECUTE) { backfilled++; return }
    for (const u of urls) {
      const r2 = await downloadAndStoreCover(p.id, u)
      if (r2) { log.push({ id: p.id, isbn: p.isbn13, title: p.title, oldCover: p.coverImageUrl, action: 'backfill', newCover: r2 }); backfilled++; return }
    }
    backfillFailed++
  })
  console.log(`Pass A: ${EXECUTE ? 'backfilled' : 'would backfill'} ${backfilled}${EXECUTE ? `, failed ${backfillFailed}` : ''}`)
  if (NAMED_ONLY) { await prisma.$disconnect(); return }

  // ── Pass B: null remaining dead OL-direct covers (any format)
  const remaining = await prisma.canonicalProduct.findMany({
    where: { deletedAt: null, coverImageUrl: { contains: 'openlibrary.org' } },
    select: { id: true, isbn13: true, title: true, coverImageUrl: true },
  })
  console.log(`\nPass B: probing ${remaining.length} remaining OL-direct covers for dead links...`)
  let nulled = 0, kept = 0
  await pool(remaining, 20, async (p) => {
    if (!p.coverImageUrl) return
    const dead = await olIsDead(p.coverImageUrl)
    if (!dead) { kept++; return }
    if (EXECUTE) {
      await prisma.canonicalProduct.update({ where: { id: p.id }, data: { coverImageUrl: null, updatedAt: new Date() } })
      log.push({ id: p.id, isbn: p.isbn13, title: p.title, oldCover: p.coverImageUrl, action: 'null', newCover: null })
    }
    nulled++
  })
  console.log(`Pass B: ${EXECUTE ? 'nulled' : 'would null'} ${nulled} dead, kept ${kept} live OL covers`)

  if (EXECUTE && log.length) {
    const lp = path.join(__dirname, `.cover-dead-ol-fix-log-${Date.now()}.json`)
    fs.writeFileSync(lp, JSON.stringify(log, null, 2))
    console.log(`\nReversible log (${log.length} mutations): ${path.basename(lp)}`)
  }
  await prisma.$disconnect()
}
main().catch(e => { console.error('ERR', e); process.exit(1) }).finally(() => prisma.$disconnect())
