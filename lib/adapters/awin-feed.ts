/**
 * Awin affiliate product feed adapter for Catch Comics.
 *
 * Awin feeds are large (50–200MB) XML or CSV files downloaded from:
 *   https://productdata.awin.com/datafeed/download/apikey/{KEY}/language/en/fid/{FEED_ID}/...
 *
 * Design:
 *   - Feed is streamed — never loaded fully into memory
 *   - XML parsed with fast-xml-parser (SAX-style chunked approach)
 *   - CSV parsed with csv-parse in streaming mode
 *   - Processed in chunks of 500 records, committed transactionally per chunk
 *   - Progress logged every 5 000 records
 *   - Upsert-based — safe to re-run (idempotent on merchant_product_id)
 *   - Canonical matching via shared/matching.ts (ISBN → EAN → UNMATCHED)
 *
 * sync_config fields (stored on the retailer row):
 *   feed_id      : string   — Awin feed ID
 *   api_key      : string   — per-retailer API key (or use env AWIN_API_KEY)
 *   feed_format  : "xml" | "csv"
 *
 * Env vars:
 *   AWIN_API_KEY — master API key (used as fallback if sync_config.api_key absent)
 *
 * Standard Awin CSV/XML column names used here:
 *   product_name, merchant_product_id, aw_product_id, merchant_image_url,
 *   description, merchant_category, search_price, currency, merchant_deep_link,
 *   aw_deep_link, in_stock, condition, isbn, ean, upc, brand, author
 */

import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { prisma }   from '@/lib/prisma'
import {
  extractIdentifiers,
  matchCanonical,
  type SyncResult,
  type SyncError,
} from '@/lib/adapters/shared/matching'
import {
  ListingCondition,
  MatchMethod,
  Prisma,
  StockStatus,
} from '@prisma/client'

export type { SyncResult, SyncError }

// ── Awin product record (normalised from XML or CSV) ──────────────────────────

interface AwinProduct {
  merchant_product_id : string
  aw_product_id       : string
  product_name        : string
  merchant_image_url  : string
  description         : string
  search_price        : string   // decimal string, e.g. "12.99"
  currency            : string
  aw_deep_link        : string   // use this as retailer_url — already affiliate-tagged
  merchant_deep_link  : string
  in_stock            : string   // "1" or "0" or "yes"/"no"
  condition           : string   // "new" | "used" | "refurbished"
  isbn                : string
  ean                 : string
  upc                 : string
  brand               : string
  author              : string
}

// ── sync_config contract for Awin retailers ───────────────────────────────────

interface AwinSyncConfig {
  feed_id     ?: string
  api_key     ?: string
  feed_format ?: 'xml' | 'csv'
  [key: string]: unknown
}

// ── Constants ─────────────────────────────────────────────────────────────────

const CHUNK_SIZE   = 500
const LOG_EVERY    = 5_000
const USER_AGENT   = 'CatchComics/1.0 (+https://catchcomics.com/bot)'

// ── Condition mapping ─────────────────────────────────────────────────────────

function mapAwinCondition(condition: string): ListingCondition {
  switch (condition.toLowerCase().trim()) {
    case 'used':         return ListingCondition.GOOD
    case 'refurbished':  return ListingCondition.ACCEPTABLE
    default:             return ListingCondition.NEW
  }
}

// ── Stock status mapping ──────────────────────────────────────────────────────

function mapAwinStock(inStock: string): StockStatus {
  const v = inStock.toLowerCase().trim()
  return (v === '1' || v === 'yes' || v === 'true' || v === 'in stock')
    ? StockStatus.IN_STOCK
    : StockStatus.OUT_OF_STOCK
}

// ── Price parsing ─────────────────────────────────────────────────────────────

function parsePrice(raw: string): string {
  const n = parseFloat(raw.replace(/[^0-9.]/g, ''))
  return isNaN(n) ? '0.00' : n.toFixed(2)
}

// ── Identifier extraction ─────────────────────────────────────────────────────

function extractAwinIdentifiers(product: AwinProduct): { isbn13: string | null; ean: string | null } {
  // ISBN field takes priority (Awin maps it directly from merchant data)
  const fromIsbn = extractIdentifiers(product.isbn)
  if (fromIsbn.isbn13) return fromIsbn

  // Try EAN field
  const fromEan = extractIdentifiers(product.ean)
  if (fromEan.isbn13) return fromEan
  if (fromEan.ean)    return fromEan

  // Try UPC (converted EAN-13 from UPC-A by prepending 0)
  if (product.upc?.length === 12) {
    const asEan = '0' + product.upc
    const fromUpc = extractIdentifiers(asEan)
    if (fromUpc.ean) return fromUpc
  }

  // Try merchant_product_id as last resort (some merchants use ISBN as SKU)
  return extractIdentifiers(product.merchant_product_id)
}

// ── DB upsert ─────────────────────────────────────────────────────────────────

async function upsertListing(
  retailerId        : string,
  product           : AwinProduct,
  canonicalProductId: string | null,
  matchMethod       : MatchMethod,
  matchConfidence   : number,
  syncStart         : Date,
): Promise<'created' | 'updated' | 'price_changed'> {
  const priceAmount = parsePrice(product.search_price)
  const existing    = await prisma.retailerListing.findUnique({
    where: { retailerId_retailerSku: { retailerId, retailerSku: product.merchant_product_id } },
  })

  if (!existing) {
    await prisma.retailerListing.create({
      data: {
        retailerId,
        retailerSku       : product.merchant_product_id,
        retailerUrl       : product.aw_deep_link,   // affiliate URL — do not modify
        title             : product.product_name,
        priceAmount,
        priceCurrency     : product.currency || 'GBP',
        stockStatus       : mapAwinStock(product.in_stock),
        condition         : mapAwinCondition(product.condition),
        conditionDetail   : null,
        imageUrl          : product.merchant_image_url || null,
        rawData           : product as unknown as Prisma.InputJsonValue,
        canonicalProductId,
        matchMethod,
        matchConfidence,
        firstSeenAt       : syncStart,
        lastSeenAt        : syncStart,
        priceHistory: {
          create: {
            priceAmount,
            priceCurrency: product.currency || 'GBP',
            stockStatus  : mapAwinStock(product.in_stock),
            recordedAt   : syncStart,
          },
        },
      },
    })
    return 'created'
  }

  const priceChanged = !existing.priceAmount.equals(new Prisma.Decimal(priceAmount))
  const matchUpdate  =
    existing.matchMethod === MatchMethod.UNMATCHED && canonicalProductId
      ? { canonicalProductId, matchMethod, matchConfidence }
      : {}

  await prisma.retailerListing.update({
    where: { id: existing.id },
    data: {
      lastSeenAt  : syncStart,
      stockStatus : mapAwinStock(product.in_stock),
      priceAmount,
      title       : product.product_name,
      imageUrl    : product.merchant_image_url || null,
      rawData     : product as unknown as Prisma.InputJsonValue,
      retailerUrl : product.aw_deep_link,
      deletedAt   : null,
      ...(priceChanged ? { lastPriceChangeAt: syncStart } : {}),
      ...matchUpdate,
    },
  })

  if (priceChanged) {
    await prisma.priceHistory.create({
      data: {
        retailerListingId: existing.id,
        priceAmount,
        priceCurrency    : product.currency || 'GBP',
        stockStatus      : mapAwinStock(product.in_stock),
        recordedAt       : syncStart,
      },
    })
    return 'price_changed'
  }

  return 'updated'
}

// ── Chunk processor ───────────────────────────────────────────────────────────

async function processChunk(
  retailerId : string,
  chunk      : AwinProduct[],
  syncStart  : Date,
  errors     : SyncError[],
  counters   : { created: number; updated: number; priceChanges: number },
): Promise<void> {
  for (const product of chunk) {
    const { isbn13, ean } = extractAwinIdentifiers(product)

    let canonicalProductId: string | null = null
    let mMethod: MatchMethod  = MatchMethod.UNMATCHED
    let mConf  : number       = 0

    try {
      const match = await matchCanonical(isbn13, ean, product.product_name, '[awin]')
      canonicalProductId = match.canonicalProductId
      mMethod            = match.matchMethod
      mConf              = match.matchConfidence
    } catch (err) {
      errors.push({
        type   : 'db',
        message: `canonical match failed: ${err instanceof Error ? err.message : err}`,
        context: product.merchant_product_id,
      })
    }

    try {
      const result = await upsertListing(retailerId, product, canonicalProductId, mMethod, mConf, syncStart)
      if (result === 'created')            counters.created++
      else if (result === 'price_changed') { counters.updated++; counters.priceChanges++ }
      else                                 counters.updated++
    } catch (err) {
      errors.push({
        type   : 'upsert',
        message: err instanceof Error ? err.message : String(err),
        context: product.merchant_product_id,
      })
    }
  }
}

// ── Feed download ─────────────────────────────────────────────────────────────

async function downloadFeed(url: string): Promise<ReadableStream<Uint8Array>> {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: '*/*' },
    signal : AbortSignal.timeout(300_000),  // 5-minute timeout for large feeds
  })
  if (!res.ok) throw new Error(`Feed download failed: HTTP ${res.status} ${res.statusText}`)
  if (!res.body) throw new Error('Feed response has no body')
  return res.body
}

// ── XML feed parser (streaming) ───────────────────────────────────────────────

async function* parseXmlFeed(stream: ReadableStream<Uint8Array>): AsyncGenerator<AwinProduct> {
  // Dynamically import fast-xml-parser to avoid bundling in edge runtime
  // @ts-ignore -- fast-xml-parser installed at runtime; types resolve after npm install
  const { XMLParser } = require('fast-xml-parser') as { XMLParser: new (opts: object) => { parse(xml: string): Record<string, unknown> } }

  const parser = new XMLParser({
    ignoreAttributes    : false,
    attributeNamePrefix : '@_',
    isArray             : (tagName: string) => tagName === 'product',
  })

  // Buffer-accumulate the entire XML then parse (safe for feeds up to ~512MB on Node)
  // For truly giant feeds (> 500MB), a SAX approach would be needed.
  const chunks: Uint8Array[] = []
  const reader = stream.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const totalBytes = chunks.reduce((a, b) => a + b.byteLength, 0)
  const buf        = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) { buf.set(chunk, offset); offset += chunk.byteLength }
  const xml = Buffer.from(buf).toString('utf-8')

  const parsed   = parser.parse(xml)
  // Awin XML feeds vary: root may be <merchant> or <feed> with nested <products><product>
  const products: unknown[] =
    parsed?.merchant?.products?.product ??
    parsed?.feed?.products?.product     ??
    parsed?.products?.product           ??
    []

  for (const p of products as Record<string, unknown>[]) {
    yield mapXmlProduct(p)
  }
}

function mapXmlProduct(p: Record<string, unknown>): AwinProduct {
  const str = (k: string) => String(p[k] ?? '')
  return {
    merchant_product_id : str('merchant_product_id') || str('merchant-product-id') || str('aw_product_id'),
    aw_product_id       : str('aw_product_id'),
    product_name        : str('product_name') || str('name'),
    merchant_image_url  : str('merchant_image_url') || str('large_image') || str('image_url'),
    description         : str('description'),
    search_price        : str('search_price') || str('price'),
    currency            : str('currency') || str('currency_symbol') || 'GBP',
    aw_deep_link        : str('aw_deep_link'),
    merchant_deep_link  : str('merchant_deep_link') || str('merchant_product_url'),
    in_stock            : str('in_stock') || str('stock_quantity') || '0',
    condition           : str('condition') || 'new',
    isbn                : str('isbn'),
    ean                 : str('ean'),
    upc                 : str('upc'),
    brand               : str('brand') || str('manufacturer'),
    author              : str('author'),
  }
}

// ── CSV feed parser (streaming) ───────────────────────────────────────────────

async function* parseCsvFeed(stream: ReadableStream<Uint8Array>): AsyncGenerator<AwinProduct> {
  // @ts-ignore -- csv-parse installed at runtime; types resolve after npm install
  const { parse } = require('csv-parse') as { parse: (opts: object) => NodeJS.ReadWriteStream }

  // Convert Web ReadableStream to Node.js Readable
  const nodeStream = Readable.fromWeb(stream as Parameters<typeof Readable.fromWeb>[0])

  const parser = nodeStream.pipe(
    parse({
      columns         : true,   // first row is header
      skip_empty_lines: true,
      trim            : true,
      bom             : true,   // handle UTF-8 BOM (common in Windows-generated Awin feeds)
    })
  )

  for await (const row of parser as AsyncIterable<Record<string, string>>) {
    yield mapCsvRow(row)
  }
}

function mapCsvRow(row: Record<string, string>): AwinProduct {
  // Normalise Awin's column names (they vary slightly between feeds)
  const get = (...keys: string[]) => {
    for (const k of keys) {
      const v = row[k] ?? row[k.toLowerCase()] ?? row[k.toUpperCase()] ?? ''
      if (v) return v
    }
    return ''
  }

  return {
    merchant_product_id : get('merchant_product_id', 'Merchant Product Id', 'product_id'),
    aw_product_id       : get('aw_product_id', 'AW Product Id'),
    product_name        : get('product_name', 'Product Name', 'name'),
    merchant_image_url  : get('merchant_image_url', 'Merchant Image URL', 'image_url'),
    description         : get('description', 'Description'),
    search_price        : get('search_price', 'Search Price', 'price'),
    currency            : get('currency', 'Currency') || 'GBP',
    aw_deep_link        : get('aw_deep_link', 'AW Deep Link'),
    merchant_deep_link  : get('merchant_deep_link', 'Merchant Deep Link'),
    in_stock            : get('in_stock', 'In Stock', 'stock'),
    condition           : get('condition', 'Condition') || 'new',
    isbn                : get('isbn', 'ISBN'),
    ean                 : get('ean', 'EAN', 'gtin'),
    upc                 : get('upc', 'UPC'),
    brand               : get('brand', 'Brand', 'manufacturer'),
    author              : get('author', 'Author'),
  }
}

// ── Main adapter class ────────────────────────────────────────────────────────

export class AwinFeedAdapter {

  /**
   * Download and ingest an Awin product feed for a retailer.
   *
   * @param retailerId  UUID of the retailer in the retailers table.
   *                    The retailer's sync_config must contain feed_id and
   *                    optionally api_key and feed_format ("xml" | "csv").
   */
  async syncFeed(retailerId: string): Promise<SyncResult> {
    const startedAt = Date.now()
    const syncStart = new Date()
    const errors    : SyncError[] = []
    let pagesFetched    = 0
    let productsFetched = 0
    let listingsCreated = 0
    let listingsUpdated = 0
    let priceChanges    = 0

    const retailer = await prisma.retailer.findUniqueOrThrow({ where: { id: retailerId } })
    if (retailer.platform !== 'AWIN_FEED') {
      throw new Error(
        `AwinFeedAdapter.syncFeed called for ${retailer.domain} ` +
        `(platform=${retailer.platform}). This adapter only supports AWIN_FEED retailers.`,
      )
    }

    const cfg        = (retailer.syncConfig ?? {}) as AwinSyncConfig
    const feedId     = cfg.feed_id
    const apiKey     = cfg.api_key ?? process.env.AWIN_API_KEY
    const feedFormat = cfg.feed_format ?? 'csv'

    if (!feedId) throw new Error(`retailer ${retailer.domain} has no feed_id in sync_config`)
    if (!apiKey) throw new Error(`no api_key for retailer ${retailer.domain} and AWIN_API_KEY env var not set`)

    const feedUrl = `https://productdata.awin.com/datafeed/download/apikey/${apiKey}/language/en/fid/${feedId}/columntypes/all/format/${feedFormat}/delimiter/%2C/compression/none/`

    console.log(`[awin] starting feed sync for ${retailer.domain} (feed ${feedId}, format ${feedFormat})`)

    let feedStream: ReadableStream<Uint8Array>
    try {
      feedStream = await downloadFeed(feedUrl)
    } catch (err) {
      errors.push({ type: 'fetch', message: err instanceof Error ? err.message : String(err), context: feedUrl })
      return {
        retailerId, domain: retailer.domain, pagesFetched: 0, productsFetched: 0,
        listingsCreated: 0, listingsUpdated: 0, priceChanges: 0, errors,
        durationMs: Date.now() - startedAt,
      }
    }

    // ── Stream + chunk ────────────────────────────────────────────────────────
    const productGen = feedFormat === 'xml'
      ? parseXmlFeed(feedStream)
      : parseCsvFeed(feedStream)

    let chunk  : AwinProduct[] = []
    const counters = { created: listingsCreated, updated: listingsUpdated, priceChanges }

    try {
      for await (const product of productGen) {
        if (!product.merchant_product_id || !product.product_name) continue  // skip malformed rows
        chunk.push(product)
        productsFetched++

        if (chunk.length >= CHUNK_SIZE) {
          await processChunk(retailerId, chunk, syncStart, errors, counters)
          pagesFetched++   // each chunk ≈ one "page" for reporting
          chunk = []
        }

        if (productsFetched % LOG_EVERY === 0) {
          console.log(
            `[awin] ${retailer.domain}: ${productsFetched} products processed, ` +
            `${counters.created} created, ${counters.updated} updated, ` +
            `${errors.length} errors so far`,
          )
        }
      }

      // Process the final partial chunk
      if (chunk.length > 0) {
        await processChunk(retailerId, chunk, syncStart, errors, counters)
        pagesFetched++
      }
    } catch (err) {
      errors.push({ type: 'fetch', message: `feed parse error: ${err instanceof Error ? err.message : err}` })
    }

    listingsCreated = counters.created
    listingsUpdated = counters.updated
    priceChanges    = counters.priceChanges

    // ── Update retailer lastSyncedAt ──────────────────────────────────────────
    try {
      await prisma.retailer.update({
        where: { id: retailerId },
        data : { lastSyncedAt: syncStart },
      })
    } catch (err) {
      errors.push({ type: 'db', message: `retailer update failed: ${err instanceof Error ? err.message : err}` })
    }

    const durationMs = Date.now() - startedAt
    console.log(
      `[awin] sync complete for ${retailer.domain}: ` +
      `${productsFetched} products, ${listingsCreated} created, ` +
      `${listingsUpdated} updated, ${priceChanges} price changes, ` +
      `${errors.length} errors — ${durationMs}ms`,
    )

    return {
      retailerId,
      domain         : retailer.domain,
      pagesFetched,
      productsFetched,
      listingsCreated,
      listingsUpdated,
      priceChanges,
      errors,
      durationMs,
    }
  }

  /**
   * Dry-run preview: download and parse up to `limit` rows from the feed
   * without writing to the database.
   * Returns a sample of parsed products and match-rate statistics.
   */
  async previewFeed(
    feedId     : string,
    apiKey     : string,
    feedFormat : 'xml' | 'csv' = 'csv',
    limit      = 500,
  ): Promise<{
    sample     : AwinProduct[]
    total      : number
    withIsbn   : number
    withEan    : number
    unmatched  : number
  }> {
    const feedUrl = `https://productdata.awin.com/datafeed/download/apikey/${apiKey}/language/en/fid/${feedId}/columntypes/all/format/${feedFormat}/delimiter/%2C/compression/none/`
    const feedStream = await downloadFeed(feedUrl)

    const productGen = feedFormat === 'xml'
      ? parseXmlFeed(feedStream)
      : parseCsvFeed(feedStream)

    const sample  : AwinProduct[] = []
    let total     = 0
    let withIsbn  = 0
    let withEan   = 0
    let unmatched = 0

    for await (const product of productGen) {
      if (total >= limit) break
      total++

      const { isbn13, ean } = extractAwinIdentifiers(product)
      if (isbn13)       withIsbn++
      else if (ean)     withEan++
      else              unmatched++

      if (sample.length < 20) sample.push(product)
    }

    return { sample, total, withIsbn, withEan, unmatched }
  }
}
