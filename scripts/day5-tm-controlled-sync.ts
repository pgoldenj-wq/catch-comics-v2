/**
 * Day 5 Controlled Sync — Travelling Man (comic-only, page-limited)
 *
 * Usage:
 *   npx tsx scripts/day5-tm-controlled-sync.ts [options]
 *
 * Options:
 *   --dry-run          Fetch + filter + normalise, but write nothing to DB
 *   --max-pages N      Pages to fetch (default: 2, hard cap: 2)
 *   --pages-from N     Start at page N (default: 1)
 *
 * Safeguards vs the full ShopifyAdapter.syncRetailer():
 *   1. Hard page cap     — max 2 pages = 500 products, hard-coded here
 *   2. Comic filter      — only Manga / Graphic Novel / Comic product types
 *   3. Dry-run mode      — zero DB side-effects; safe to run first
 *   4. Conservative match — ISBN-exact (confidence 95) or new-stub (80)
 *                           EAN lookup-only, no auto-create
 *                           No fuzzy title matching, ever
 *   5. QA report         — end-of-run shortlist of 20 products for manual review
 *
 * Comic filter accepts (case-insensitive):
 *   Manga, Graphic Novel, Comic, Comics, Trade Paperback, Hardcover, Single Issue
 *
 * Comic filter rejects (intentionally):
 *   Light Novel, Art Book, Novel, Book, Miniature Game, Board Game,
 *   Merchandise, Japanese Merch, CCG, Model Kit, Accessories, Dice,
 *   Gamers Grass, Basing Material, Siege Scenics, roleplaying game
 */

import 'dotenv/config'
import * as fs   from 'fs'
import * as path from 'path'

// ── Load .env.local (local dev; no-op on Vercel) ──────────────────────────────
const envPath = path.join(__dirname, '..', '.env.local')
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').split('\n')
  for (const line of lines) {
    const m = line.match(/^([^#=]+)=(.*)$/)
    if (m && !process.env[m[1].trim()]) {
      process.env[m[1].trim()] = m[2].trim()
    }
  }
}

import { PrismaClient, ListingCondition, MatchMethod, StockStatus, ProductFormat, Prisma }
  from '@prisma/client'

const prisma = new PrismaClient()

// ── CLI flags ─────────────────────────────────────────────────────────────────

const args      = process.argv.slice(2)
const DRY_RUN   = args.includes('--dry-run')
const PAGES_FROM = parseInt(args.find(a => a.startsWith('--pages-from='))?.split('=')[1] ?? '1', 10)
// Hard cap at 2 regardless of --max-pages to enforce the "controlled" constraint
const MAX_PAGES_ARG = parseInt(args.find(a => a.startsWith('--max-pages='))?.split('=')[1] ?? '2', 10)
const MAX_PAGES = Math.min(MAX_PAGES_ARG, 2)

console.log(`\n${'═'.repeat(60)}`)
console.log(`  Day 5 Controlled Sync — Travelling Man`)
console.log(`  Mode: ${DRY_RUN ? '🔍 DRY-RUN (no DB writes)' : '✍️  LIVE (DB writes enabled)'}`)
console.log(`  Pages: ${PAGES_FROM}–${PAGES_FROM + MAX_PAGES - 1}  (max 500 products)`)
console.log(`${'═'.repeat(60)}\n`)

// ── Constants ─────────────────────────────────────────────────────────────────

const TM_DOMAIN   = 'travellingman.com'
const TM_CURRENCY = 'GBP'
const PAGE_SIZE   = 250
const BETWEEN_PAGE_MS = 2_000
const USER_AGENT  = 'CatchComics/1.0 (+https://catchcomics.com/bot)'

// ── Comic product-type allowlist ──────────────────────────────────────────────
// Travelling Man uses these product_type values for comic-adjacent products.
// All others (Board Game, Miniature Game, Merchandise, etc.) are rejected.

const COMIC_PRODUCT_TYPES = new Set([
  'manga',
  'graphic novel',
  'comic',
  'comics',
  'trade paperback',
  'hardcover',
  'single issue',
])

function isComicProductType(rawProductType: string | null | undefined): boolean {
  if (!rawProductType) return false
  return COMIC_PRODUCT_TYPES.has(rawProductType.toLowerCase().trim())
}

// ── Shopify types (minimal — only what we need) ───────────────────────────────

interface ShopifyVariant {
  id:        number
  title:     string
  price:     string
  sku:       string
  barcode:   string | null
  available: boolean
}

interface ShopifyProduct {
  id:           number
  title:        string
  handle:       string
  body_html:    string | null
  product_type: string | null
  tags:         string[]
  images:       { src: string }[]
  variants:     ShopifyVariant[]
}

// ── Identifier extraction (same logic as shared/matching.ts) ──────────────────

function extractIdentifiers(barcode: string | null | undefined): {
  isbn13: string | null
  ean:    string | null
} {
  if (!barcode) return { isbn13: null, ean: null }
  const digits = barcode.replace(/\D/g, '')
  if (digits.length !== 13) return { isbn13: null, ean: null }
  if (digits.startsWith('978') || digits.startsWith('979')) {
    return { isbn13: digits, ean: null }
  }
  return { isbn13: null, ean: digits }
}

function extractBestIdentifiers(variant: ShopifyVariant): {
  isbn13: string | null
  ean:    string | null
} {
  // Try barcode first (WoB pattern); fall back to SKU (Travelling Man stores
  // bare ISBN-13s in the SKU field instead of barcode)
  const fromBarcode = extractIdentifiers(variant.barcode)
  if (fromBarcode.isbn13 || fromBarcode.ean) return fromBarcode
  return extractIdentifiers(variant.sku)
}

// ── Condition mapping (same logic as shopify.ts adapter) ─────────────────────

function mapVariantCondition(variantTitle: string): {
  condition:       ListingCondition
  conditionDetail: string | null
} {
  const t = variantTitle.toLowerCase().trim()
  if (/\b(cgc|pgx|cbcs|sgc)\b/.test(t) || t.includes('graded')) {
    return { condition: ListingCondition.GRADED,      conditionDetail: variantTitle }
  }
  if (/\bnear\s*mint\b|\bnm\b/.test(t)) {
    return { condition: ListingCondition.LIKE_NEW,    conditionDetail: variantTitle }
  }
  if (/\bvery\s*good\b|\bvg\b/.test(t)) {
    return { condition: ListingCondition.VERY_GOOD,   conditionDetail: variantTitle }
  }
  if (/\bgood\b|\bgd\b/.test(t)) {
    return { condition: ListingCondition.GOOD,        conditionDetail: variantTitle }
  }
  if (/\bacceptable\b|\bfair\b|\bfine\b|\bfn\b/.test(t)) {
    return { condition: ListingCondition.ACCEPTABLE,  conditionDetail: variantTitle }
  }
  if (/\bpoor\b|\breading\s*copy\b/.test(t)) {
    return { condition: ListingCondition.POOR,        conditionDetail: variantTitle }
  }
  if (t === '' || t === 'default title' || t === 'new') {
    return { condition: ListingCondition.NEW,         conditionDetail: null }
  }
  if (/\bcover\b|\bedition\b|\bdm\s+only\b|\bvariant\b|\bfoil\b/.test(t)) {
    return { condition: ListingCondition.NEW,         conditionDetail: null }
  }
  return { condition: ListingCondition.NEW, conditionDetail: null }
}

// ── Slug generation ───────────────────────────────────────────────────────────

function makeCanonicalSlug(title: string, isbn13: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
  return `${base}-${isbn13.slice(-6)}`
}

// ── Stats tracking ────────────────────────────────────────────────────────────

interface Stats {
  totalFetched:         number
  totalFilteredOut:     number   // rejected by comic filter
  totalNormalized:      number
  // Canonical match outcomes
  matchedByIsbn:        number   // found existing canonical by ISBN
  newCanonicalCreated:  number   // new canonical stub created
  matchedByEan:         number   // found existing canonical by EAN
  unmatched:            number   // no identifier → no canonical link
  // DB outcomes
  listingsCreated:      number
  listingsUpdated:      number
  listingsPriceChanged: number
  listingsSkipped:      number   // dry-run or upsert skipped
  errors:               string[]
}

const stats: Stats = {
  totalFetched:         0,
  totalFilteredOut:     0,
  totalNormalized:      0,
  matchedByIsbn:        0,
  newCanonicalCreated:  0,
  matchedByEan:         0,
  unmatched:            0,
  listingsCreated:      0,
  listingsUpdated:      0,
  listingsPriceChanged: 0,
  listingsSkipped:      0,
  errors:               [],
}

// Track what was filtered out by type
const filteredTypeCount: Record<string, number> = {}

// QA candidates — products processed this run for the shortlist
interface QACandidate {
  title:        string
  isbn13:       string | null
  productType:  string
  price:        string
  matchMethod:  MatchMethod
  confidence:   number
  canonicalId:  string | null
  isNew:        boolean   // canonical was newly created this run
  retailerUrl:  string
}
const qaPool: QACandidate[] = []

// ── Canonical matching (conservative — mirrors shared/matching.ts exactly) ────
// No fuzzy matching. ISBN exact → confidence 95 (existing) or 80 (new stub).
// EAN lookup-only → no auto-create. No match → UNMATCHED.

async function matchCanonicalConservative(
  isbn13: string | null,
  ean:    string | null,
  title:  string,
): Promise<{
  canonicalProductId: string | null
  matchMethod:        MatchMethod
  matchConfidence:    number
  isNewCanonical:     boolean
}> {
  if (isbn13) {
    // 1. Look up existing canonical by ISBN
    const existing = await prisma.canonicalProduct.findFirst({
      where:  { isbn13 },
      select: { id: true },
    })
    if (existing) {
      stats.matchedByIsbn++
      return {
        canonicalProductId: existing.id,
        matchMethod:        MatchMethod.ISBN,
        matchConfidence:    95,
        isNewCanonical:     false,
      }
    }

    // 2. No existing match — create stub canonical if not dry-run
    if (DRY_RUN) {
      stats.newCanonicalCreated++
      return {
        canonicalProductId: null,   // dry-run: pretend it would be created
        matchMethod:        MatchMethod.ISBN,
        matchConfidence:    80,
        isNewCanonical:     true,
      }
    }

    const slug   = makeCanonicalSlug(title, isbn13)
    const format = inferFormatFromTitle(title)

    try {
      const created = await prisma.canonicalProduct.create({
        data: {
          isbn13,
          title,
          format,
          canonicalSlug: slug,
        },
        select: { id: true },
      })
      stats.newCanonicalCreated++
      console.log(`  ✨ new canonical: "${title}" (${isbn13}) → ${created.id}`)
      return {
        canonicalProductId: created.id,
        matchMethod:        MatchMethod.ISBN,
        matchConfidence:    80,
        isNewCanonical:     true,
      }
    } catch (err) {
      // P2002 race condition — another process created this ISBN
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const race = await prisma.canonicalProduct.findFirst({
          where: { isbn13 },
          select: { id: true },
        })
        if (race) {
          stats.matchedByIsbn++
          return {
            canonicalProductId: race.id,
            matchMethod:        MatchMethod.ISBN,
            matchConfidence:    80,
            isNewCanonical:     false,
          }
        }
      }
      throw err
    }
  }

  // 3. EAN lookup only (no auto-create)
  if (ean) {
    const hit = await prisma.canonicalProduct.findFirst({
      where:  { ean },
      select: { id: true },
    })
    if (hit) {
      stats.matchedByEan++
      return {
        canonicalProductId: hit.id,
        matchMethod:        MatchMethod.EAN,
        matchConfidence:    90,
        isNewCanonical:     false,
      }
    }
  }

  // 4. No match — leave as UNMATCHED
  stats.unmatched++
  return {
    canonicalProductId: null,
    matchMethod:        MatchMethod.UNMATCHED,
    matchConfidence:    0,
    isNewCanonical:     false,
  }
}

// ── Format inference (minimal — for stub canonical creation) ──────────────────
// Mirrors the COMIC_SPECIFIC_FORMATS logic from seed-canonical-from-listings.ts

function inferFormatFromTitle(title: string): ProductFormat {
  const t = title.toLowerCase()
  if (/\bmanga\b|\bvol\b|\bvolume\b/.test(t) && /\bjapan/i.test(t)) return ProductFormat.MANGA_VOLUME
  if (/\b(vol\.?\s*\d+|volume\s*\d+)\b/.test(t)) {
    if (/\b(manga|shonen|shojo|seinen|josei)\b/.test(t)) return ProductFormat.MANGA_VOLUME
    return ProductFormat.TPB
  }
  if (/\bsingle\s*issue\b|#\d+/.test(t))                   return ProductFormat.SINGLE_ISSUE
  if (/\bomnibus\b/.test(t))                                return ProductFormat.OMNIBUS
  if (/\babsolute\b/.test(t))                               return ProductFormat.ABSOLUTE
  if (/\bcompendium\b/.test(t))                             return ProductFormat.COMPENDIUM
  if (/\bdeluxe\b/.test(t))                                 return ProductFormat.DELUXE
  if (/\bhardcover\b|\bhc\b/.test(t))                       return ProductFormat.HARDCOVER
  if (/\bgraphic\s*novel\b/.test(t))                        return ProductFormat.TPB
  return ProductFormat.OTHER
}

// ── Fetch with back-off ───────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

async function fetchPage(page: number): Promise<ShopifyProduct[]> {
  const url = `https://${TM_DOMAIN}/products.json?limit=${PAGE_SIZE}&page=${page}`
  let backoffMs = 2_000

  for (let attempt = 0; attempt <= 3; attempt++) {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    })

    if (res.ok) {
      const body = await res.json() as { products?: ShopifyProduct[] }
      return body.products ?? []
    }

    if (res.status === 404) throw new Error(`404 — ${url}`)
    if (res.status === 403) throw new Error(`403 — /products.json blocked on ${TM_DOMAIN}`)

    if (attempt < 3) {
      const retryAfterSec = parseInt(res.headers.get('Retry-After') ?? '0', 10)
      const waitMs = Math.min(retryAfterSec > 0 ? retryAfterSec * 1_000 : backoffMs, 60_000)
      console.warn(`  ⚠ HTTP ${res.status} page ${page} — retry in ${waitMs}ms`)
      await sleep(waitMs)
      backoffMs = Math.min(backoffMs * 2, 60_000)
    }
  }
  throw new Error(`HTTP error fetching page ${page} after 3 retries`)
}

// ── DB upsert (mirrors shopify.ts upsertListing, without OUT_OF_STOCK sweep) ──

async function upsertListing(
  retailerId:  string,
  listing: {
    retailerSku:        string
    retailerUrl:        string
    title:              string
    priceAmount:        string
    priceCurrency:      string
    stockStatus:        StockStatus
    condition:          ListingCondition
    conditionDetail:    string | null
    imageUrl:           string | null
    isbn13:             string | null
    ean:                string | null
    rawData:            unknown
    canonicalProductId: string | null
    matchMethod:        MatchMethod
    matchConfidence:    number
  },
  syncStart: Date,
): Promise<'created' | 'updated' | 'price_changed'> {
  const existing = await prisma.retailerListing.findUnique({
    where: { retailerId_retailerSku: { retailerId, retailerSku: listing.retailerSku } },
  })

  if (!existing) {
    await prisma.retailerListing.create({
      data: {
        retailerId,
        retailerSku:        listing.retailerSku,
        retailerUrl:        listing.retailerUrl,
        title:              listing.title,
        priceAmount:        listing.priceAmount,
        priceCurrency:      listing.priceCurrency,
        stockStatus:        listing.stockStatus,
        condition:          listing.condition,
        conditionDetail:    listing.conditionDetail,
        imageUrl:           listing.imageUrl,
        ...({ isbn13: listing.isbn13, ean: listing.ean } as object),
        rawData:            listing.rawData as Prisma.InputJsonValue,
        canonicalProductId: listing.canonicalProductId,
        matchMethod:        listing.matchMethod,
        matchConfidence:    listing.matchConfidence,
        firstSeenAt:        syncStart,
        lastSeenAt:         syncStart,
        priceHistory: {
          create: {
            priceAmount:   listing.priceAmount,
            priceCurrency: listing.priceCurrency,
            stockStatus:   listing.stockStatus,
            recordedAt:    syncStart,
          },
        },
      },
    })
    return 'created'
  }

  const newDecimal  = new Prisma.Decimal(listing.priceAmount)
  const priceChanged = !existing.priceAmount.equals(newDecimal)

  // Only upgrade match data if the listing was previously UNMATCHED
  const matchUpdate =
    existing.matchMethod === MatchMethod.UNMATCHED && listing.canonicalProductId
      ? {
          canonicalProductId: listing.canonicalProductId,
          matchMethod:        listing.matchMethod,
          matchConfidence:    listing.matchConfidence,
        }
      : {}

  await prisma.retailerListing.update({
    where: { id: existing.id },
    data: {
      lastSeenAt:  syncStart,
      stockStatus: listing.stockStatus,
      priceAmount: listing.priceAmount,
      title:       listing.title,
      imageUrl:    listing.imageUrl,
      rawData:     listing.rawData as Prisma.InputJsonValue,
      ...(priceChanged ? { lastPriceChangeAt: syncStart } : {}),
      ...matchUpdate,
    },
  })

  if (priceChanged) {
    await prisma.priceHistory.create({
      data: {
        retailerListingId: existing.id,
        priceAmount:       listing.priceAmount,
        priceCurrency:     listing.priceCurrency,
        stockStatus:       listing.stockStatus,
        recordedAt:        syncStart,
      },
    })
    return 'price_changed'
  }

  return 'updated'
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const syncStart = new Date()

  // Look up Travelling Man retailer ID
  const retailer = await prisma.retailer.findFirst({
    where: { domain: TM_DOMAIN },
  })
  if (!retailer) throw new Error(`Retailer "${TM_DOMAIN}" not found in DB`)

  console.log(`Retailer:  ${retailer.name} (${retailer.id})`)
  console.log(`Currency:  ${retailer.currency}`)
  console.log(`Last sync: ${retailer.lastSyncedAt?.toISOString() ?? 'never'}\n`)

  // ── Paginate ────────────────────────────────────────────────────────────────
  for (let page = PAGES_FROM; page < PAGES_FROM + MAX_PAGES; page++) {
    console.log(`\n── Page ${page} ─${'─'.repeat(50)}`)

    let products: ShopifyProduct[]
    try {
      products = await fetchPage(page)
    } catch (err) {
      stats.errors.push(`Page ${page}: ${err instanceof Error ? err.message : String(err)}`)
      console.error(`  ✗ fetch failed:`, err instanceof Error ? err.message : err)
      break
    }

    if (products.length === 0) {
      console.log(`  (empty page — end of catalog)`)
      break
    }

    console.log(`  Fetched: ${products.length} products`)
    stats.totalFetched += products.length

    // ── Process each product ──────────────────────────────────────────────────
    for (const product of products) {
      const productType = product.product_type ?? ''

      // ── COMIC FILTER ─────────────────────────────────────────────────────────
      if (!isComicProductType(productType)) {
        stats.totalFilteredOut++
        filteredTypeCount[productType || '(empty)'] = (filteredTypeCount[productType || '(empty)'] ?? 0) + 1
        continue
      }

      // Pick primary variant (first available, else first)
      const primaryVariant = product.variants.find(v => v.available) ?? product.variants[0]
      if (!primaryVariant) continue

      const { isbn13, ean } = extractBestIdentifiers(primaryVariant)
      const { condition, conditionDetail } = mapVariantCondition(primaryVariant.title)
      stats.totalNormalized++

      // ── Canonical matching ────────────────────────────────────────────────────
      let matchResult: Awaited<ReturnType<typeof matchCanonicalConservative>>
      try {
        matchResult = await matchCanonicalConservative(isbn13, ean, product.title)
      } catch (err) {
        const msg = `Match failed for "${product.title}": ${err instanceof Error ? err.message : err}`
        stats.errors.push(msg)
        console.error(`  ✗ ${msg}`)
        matchResult = {
          canonicalProductId: null,
          matchMethod:        MatchMethod.UNMATCHED,
          matchConfidence:    0,
          isNewCanonical:     false,
        }
      }

      const listing = {
        retailerSku:        String(product.id),
        retailerUrl:        `https://${TM_DOMAIN}/products/${product.handle}`,
        title:              product.title,
        priceAmount:        parseFloat(primaryVariant.price).toFixed(2),
        priceCurrency:      TM_CURRENCY,
        stockStatus:        primaryVariant.available ? StockStatus.IN_STOCK : StockStatus.OUT_OF_STOCK,
        condition,
        conditionDetail,
        imageUrl:           product.images[0]?.src ?? null,
        isbn13,
        ean,
        rawData:            product,
        canonicalProductId: matchResult.canonicalProductId,
        matchMethod:        matchResult.matchMethod,
        matchConfidence:    matchResult.matchConfidence,
      }

      // Add to QA pool
      qaPool.push({
        title:       product.title,
        isbn13,
        productType,
        price:       `£${listing.priceAmount}`,
        matchMethod: matchResult.matchMethod,
        confidence:  matchResult.matchConfidence,
        canonicalId: matchResult.canonicalProductId,
        isNew:       matchResult.isNewCanonical,
        retailerUrl: listing.retailerUrl,
      })

      // ── DB upsert ─────────────────────────────────────────────────────────────
      if (DRY_RUN) {
        stats.listingsSkipped++
        continue
      }

      try {
        const outcome = await upsertListing(retailer.id, listing, syncStart)
        if      (outcome === 'created')       { stats.listingsCreated++ }
        else if (outcome === 'price_changed') { stats.listingsUpdated++; stats.listingsPriceChanged++ }
        else                                  { stats.listingsUpdated++ }
      } catch (err) {
        const msg = `Upsert failed for "${product.title}": ${err instanceof Error ? err.message : err}`
        stats.errors.push(msg)
        console.error(`  ✗ ${msg}`)
        stats.listingsSkipped++
      }
    }

    if (page < PAGES_FROM + MAX_PAGES - 1 && products.length === PAGE_SIZE) {
      console.log(`  Pausing ${BETWEEN_PAGE_MS}ms before next page...`)
      await sleep(BETWEEN_PAGE_MS)
    }
  }

  // ── Final stats ───────────────────────────────────────────────────────────
  const durationMs = Date.now() - syncStart.getTime()
  const durationS  = (durationMs / 1000).toFixed(1)

  console.log(`\n${'═'.repeat(60)}`)
  console.log(`  SYNC RESULTS — ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`)
  console.log(`${'═'.repeat(60)}`)
  console.log(`  Duration:             ${durationS}s`)
  console.log(`\n  Fetched from Shopify: ${stats.totalFetched}`)
  console.log(`  ├─ Filtered (not comic): ${stats.totalFilteredOut}`)
  console.log(`  └─ Passed comic filter:  ${stats.totalNormalized}`)
  console.log(`\n  Canonical matching:`)
  console.log(`  ├─ ISBN hit (existing):  ${stats.matchedByIsbn}`)
  console.log(`  ├─ ISBN new (stub):      ${stats.newCanonicalCreated}`)
  console.log(`  ├─ EAN hit:              ${stats.matchedByEan}`)
  console.log(`  └─ UNMATCHED:            ${stats.unmatched}`)
  console.log(`\n  DB outcome:`)
  console.log(`  ├─ Listings created:     ${stats.listingsCreated}`)
  console.log(`  ├─ Listings updated:     ${stats.listingsUpdated}`)
  console.log(`  ├─ Price changes:        ${stats.listingsPriceChanged}`)
  console.log(`  └─ Skipped/dry-run:      ${stats.listingsSkipped}`)

  if (stats.errors.length > 0) {
    console.log(`\n  Errors (${stats.errors.length}):`)
    stats.errors.slice(0, 10).forEach(e => console.log(`  ✗ ${e}`))
    if (stats.errors.length > 10) console.log(`  ... and ${stats.errors.length - 10} more`)
  }

  if (Object.keys(filteredTypeCount).length > 0) {
    console.log(`\n  Filtered product types (not comics):`)
    Object.entries(filteredTypeCount)
      .sort(([,a], [,b]) => b - a)
      .forEach(([type, count]) => console.log(`  ├─ ${type}: ${count}`))
  }

  // ── QA Shortlist ────────────────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(60)}`)
  console.log(`  QA SHORTLIST — 20 products for manual review`)
  console.log(`${'═'.repeat(60)}`)

  // Build a balanced shortlist across match method, format, new/existing
  const newCanonicals   = qaPool.filter(p => p.isNew).slice(0, 5)
  const unmatched       = qaPool.filter(p => p.matchMethod === 'UNMATCHED').slice(0, 4)
  const mangaItems      = qaPool.filter(p => p.productType.toLowerCase().includes('manga') && !p.isNew && p.matchMethod !== 'UNMATCHED').slice(0, 4)
  const gnItems         = qaPool.filter(p => p.productType.toLowerCase().includes('graphic') && !p.isNew && p.matchMethod !== 'UNMATCHED').slice(0, 4)
  const comicItems      = qaPool.filter(p => p.productType.toLowerCase() === 'comic' || p.productType.toLowerCase() === 'comics').slice(0, 3)

  // Combine and de-duplicate by title
  const seen   = new Set<string>()
  const shortlist: QACandidate[] = []
  for (const pool of [newCanonicals, unmatched, mangaItems, gnItems, comicItems]) {
    for (const item of pool) {
      if (!seen.has(item.title) && shortlist.length < 20) {
        seen.add(item.title)
        shortlist.push(item)
      }
    }
  }

  // Fill to 20 from the rest of the pool
  for (const item of qaPool) {
    if (!seen.has(item.title) && shortlist.length < 20) {
      seen.add(item.title)
      shortlist.push(item)
    }
  }

  shortlist.forEach((item, i) => {
    const idx    = String(i + 1).padStart(2)
    const match  = item.matchMethod === 'UNMATCHED'
      ? '⚠  UNMATCHED'
      : item.isNew
        ? '✨ NEW canonical'
        : `✅ ${item.matchMethod} (${item.confidence}%)`
    const isbn   = item.isbn13 ? ` | ISBN: ${item.isbn13}` : ''
    const flag   = item.isNew ? ' [NEW]' : ''
    console.log(`\n  ${idx}. ${item.title}${flag}`)
    console.log(`      Type: ${item.productType} | ${item.price}${isbn}`)
    console.log(`      Match: ${match}`)
    console.log(`      URL: ${item.retailerUrl}`)
  })

  if (shortlist.length === 0) {
    console.log('  (no comic products found on the fetched pages)')
  }

  console.log(`\n${'═'.repeat(60)}`)
  console.log(DRY_RUN
    ? '  ✅ Dry run complete. Re-run without --dry-run to commit to DB.'
    : '  ✅ Sync complete.')
  console.log(`${'═'.repeat(60)}\n`)

  await prisma.$disconnect()
}

main().catch(async err => {
  console.error('\n✗ Fatal:', err)
  await prisma.$disconnect()
  process.exit(1)
})
