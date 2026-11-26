/**
 * awin-feed-overlap.ts — READ-ONLY. Streams each entitled Awin feed ONCE and
 * reports the real funnel:
 *
 *   feed rows → distinct valid ISBNs → exact catalogue matches
 *             → comic-eligible matches → in-stock, priced, publishable
 *
 * Zero database writes. One HTTP request per feed.
 *
 * Two rules this script exists to respect:
 *
 *   1. It matches against EXISTING canonical_products only. A general-book
 *      feed contains tens of thousands of titles we do not and should not
 *      carry; appearing in an entitled feed is not a reason to create a
 *      catalogue record.
 *   2. "Eligible" means the SAME comic-confidence predicate already used by
 *      scripts/price-verify-dryrun.ts — ComicVine id, CV metadata, or a known
 *      comic publisher. The criteria are not broadened to inflate the count.
 *
 * The matched set is written to a JSON artefact so the ingest step can run
 * without re-downloading the feed.
 *
 *   npx dotenv -e <main>/.env.local -- npx tsx scripts/awin-feed-overlap.ts [--feed 3787]
 */
import { PrismaClient }            from '@prisma/client'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join }            from 'node:path'

import {
  downloadFeed, parseCsvFeed, extractAwinIdentifiers, redactFeedSecrets,
  type AwinProduct,
} from '@/lib/adapters/awin-feed'

const prisma = new PrismaClient()
const KEY = process.env.AWIN_DATAFEED_KEY

/** Entitled, active feeds confirmed by scripts/awin-entitlements.ts. */
const FEEDS = [
  { label: 'Waterstones',       domain: 'waterstones.com',  feedId: '3787'   },
  { label: 'Scholastic',        domain: 'scholastic.co.uk', feedId: '2957'   },
  { label: 'Lets Buy Books',    domain: 'letsbuybooks.com', feedId: '112530' },
  { label: 'Bookshop.org - UK', domain: 'uk.bookshop.org',  feedId: '99173'  },
]

/** Hard ceiling: a feed larger than this is a surprise worth stopping on. */
const MAX_ROWS_PER_FEED = 400_000
const MATCH_BATCH       = 1_000

const log = (m: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`)

interface FeedRow {
  isbn: string
  sku: string
  name: string
  price: number
  currency: string
  inStock: boolean
  condition: string
  url: string
}

async function streamFeed(feedId: string): Promise<{ rows: number; byIsbn: Map<string, FeedRow>; noId: number; badPrice: number }> {
  const url = `https://productdata.awin.com/datafeed/download/apikey/${KEY}/fid/${feedId}/format/csv/language/en/delimiter/%2C/compression/gzip/`
  const stream = await downloadFeed(url)

  const byIsbn = new Map<string, FeedRow>()
  let rows = 0, noId = 0, badPrice = 0

  for await (const p of parseCsvFeed(stream)) {
    rows++
    if (rows > MAX_ROWS_PER_FEED) { log(`  SAFE STOP — feed exceeded ${MAX_ROWS_PER_FEED.toLocaleString()} rows`); break }
    if (rows % 25_000 === 0) log(`  …${rows.toLocaleString()} rows, ${byIsbn.size.toLocaleString()} distinct ISBNs`)

    const { isbn13 } = extractAwinIdentifiers(p)
    if (!isbn13) { noId++; continue }

    const price = Number(p.search_price)
    if (!Number.isFinite(price) || price <= 0) { badPrice++; continue }

    const r = p as unknown as Record<string, unknown>
    const link = String(p.aw_deep_link || p.merchant_deep_link || '')
    if (!link) continue

    // Keep the first row per ISBN. Feeds repeat an ISBN across formats and
    // bundles; taking the first keeps this deterministic rather than letting
    // the cheapest bundle win and misrepresent the edition.
    if (!byIsbn.has(isbn13)) {
      byIsbn.set(isbn13, {
        isbn: isbn13,
        sku: String(p.merchant_product_id ?? ''),
        name: String(p.product_name ?? '').slice(0, 200),
        price,
        currency: String(p.currency ?? ''),
        inStock: String(r.in_stock ?? '').trim() === '1',
        condition: String(r.condition ?? '').trim().toLowerCase(),
        url: link,
      })
    }
  }
  return { rows, byIsbn, noId, badPrice }
}

async function main() {
  if (!KEY) { console.log('AWIN_DATAFEED_KEY not set.'); return }

  const only = process.argv.includes('--feed') ? process.argv[process.argv.indexOf('--feed') + 1] : null
  const feeds = only ? FEEDS.filter(f => f.feedId === only) : FEEDS

  const summary: Record<string, unknown>[] = []

  for (const f of feeds) {
    console.log(`\n═══ ${f.label} — feed ${f.feedId} ═══`)
    const t0 = Date.now()

    let streamed
    try {
      streamed = await streamFeed(f.feedId)
    } catch (e) {
      console.log(`  FAILED: ${redactFeedSecrets(e instanceof Error ? e.message : String(e))}`)
      summary.push({ label: f.label, feedId: f.feedId, error: 'download or parse failed' })
      continue
    }
    const { rows, byIsbn, noId, badPrice } = streamed
    const secs = ((Date.now() - t0) / 1000).toFixed(1)
    log(`  streamed ${rows.toLocaleString()} rows in ${secs}s · ${byIsbn.size.toLocaleString()} distinct priced ISBNs · ${noId.toLocaleString()} without an identifier · ${badPrice.toLocaleString()} without a usable price`)

    // ── Match against EXISTING catalogue editions, in bounded batches ──────
    const isbns = [...byIsbn.keys()]
    const matched: { id: string; isbn_13: string; title: string; canonical_slug: string; eligible: boolean }[] = []

    for (let i = 0; i < isbns.length; i += MATCH_BATCH) {
      const batch = isbns.slice(i, i + MATCH_BATCH)
      const hit = await prisma.$queryRaw<{ id: string; isbn_13: string; title: string; canonical_slug: string; eligible: boolean }[]>`
        SELECT cp.id::text, cp.isbn_13, cp.title, cp.canonical_slug,
               (cp.comicvine_id IS NOT NULL OR cp.cv_metadata IS NOT NULL
                OR cp.publisher ILIKE ANY(ARRAY['%marvel%','%dc comic%','%image comic%','%dark horse%','%idw%','%viz%','%kodansha%','%boom%','%titan%','%rebellion%','%yen press%','%seven seas%','%dynamite%','%vertigo%','%oni press%','%fantagraphics%','%tokyopop%','%square enix%'])) AS eligible
        FROM canonical_products cp
        WHERE cp.isbn_13 = ANY(${batch}::text[]) AND cp.deleted_at IS NULL`
      matched.push(...hit)
      if ((i / MATCH_BATCH) % 25 === 0 && i > 0) log(`  …matched ${matched.length.toLocaleString()} of ${i.toLocaleString()} ISBNs checked`)
    }

    const eligible = matched.filter(m => m.eligible)
    const rowsFor  = (m: { isbn_13: string }) => byIsbn.get(m.isbn_13)!
    const inStock  = eligible.filter(m => rowsFor(m).inStock)
    const newCond  = inStock.filter(m => /new/.test(rowsFor(m).condition) || rowsFor(m).condition === '')

    console.log(`\n  FUNNEL — ${f.label}`)
    console.log(`    feed rows                      ${rows.toLocaleString()}`)
    console.log(`    distinct priced ISBNs          ${byIsbn.size.toLocaleString()}`)
    console.log(`    exact catalogue matches        ${matched.length.toLocaleString()}`)
    console.log(`    of those, comic-eligible       ${eligible.length.toLocaleString()}`)
    console.log(`    comic-eligible AND in stock    ${inStock.length.toLocaleString()}`)
    console.log(`    …and condition new/blank       ${newCond.length.toLocaleString()}`)

    // How many of those editions already have another retailer's live price?
    let wouldBeSecond = 0
    if (eligible.length) {
      const ids = eligible.map(e => e.id)
      const [cnt] = await prisma.$queryRaw<{ c: bigint }[]>`
        SELECT COUNT(DISTINCT canonical_product_id)::bigint AS c
        FROM retailer_listings
        WHERE canonical_product_id = ANY(${ids}::uuid[])
          AND deleted_at IS NULL AND price_amount > 0`
      wouldBeSecond = Number(cnt.c)
    }
    console.log(`    already priced elsewhere       ${wouldBeSecond.toLocaleString()}  (these become 2+ retailer comparisons)`)

    const artefact = {
      label: f.label, domain: f.domain, feedId: f.feedId,
      measuredAt: new Date().toISOString(),
      funnel: {
        feedRows: rows, distinctPricedIsbns: byIsbn.size,
        catalogueMatches: matched.length, comicEligible: eligible.length,
        eligibleInStock: inStock.length, eligibleInStockNew: newCond.length,
        alreadyPricedElsewhere: wouldBeSecond,
        rowsWithoutIdentifier: noId, rowsWithoutUsablePrice: badPrice,
      },
      streamSeconds: Number(secs),
      offers: eligible.map(m => ({ productId: m.id, slug: m.canonical_slug, title: m.title, ...byIsbn.get(m.isbn_13)! })),
    }
    const out = join(process.cwd(), 'launch', 'operations', `awin-overlap-${f.feedId}.json`)
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, JSON.stringify(artefact, null, 2))
    console.log(`    -> ${out}`)

    summary.push({ label: f.label, feedId: f.feedId, ...artefact.funnel })
  }

  console.log('\n═══ SUMMARY ═══')
  console.table(summary)

  await prisma.$disconnect()
}

main().catch(async e => {
  await prisma.$disconnect()
  console.error(redactFeedSecrets(e instanceof Error ? (e.stack ?? e.message) : String(e)))
  process.exit(1)
})
