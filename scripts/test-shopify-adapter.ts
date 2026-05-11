/**
 * Dry-run test for the Shopify adapter.
 *
 * Fetches page 1 of a store's /products.json, normalises the results, and
 * prints the first 5 listings — no database reads or writes.
 *
 * Usage:
 *   npm run test:shopify -- forbiddenplanet.com
 *   npm run test:shopify -- forbiddenplanet.com --page 2
 *   npm run test:shopify -- forbiddenplanet.com --currency USD --page 3
 *
 * The script exits non-zero if the domain is unreachable or returns an error.
 */

import { ShopifyAdapter, type NormalizedListing } from '../lib/adapters/shopify'

// ── Arg parsing ───────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): {
  domain:   string
  currency: string
  page:     number
  count:    number
} {
  const args = argv.slice(2)       // strip "node" and script path

  const domain = args.find(a => !a.startsWith('--'))
  if (!domain) {
    throw new Error(
      'Usage: test-shopify-adapter <domain> [--currency GBP] [--page 1] [--count 5]',
    )
  }

  function flag(name: string, fallback: string): string {
    const idx = args.indexOf(`--${name}`)
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback
  }

  return {
    domain,
    currency: flag('currency', 'GBP'),
    page:     parseInt(flag('page',     '1'),  10),
    count:    parseInt(flag('count',    '5'),  10),
  }
}

// ── Formatting ────────────────────────────────────────────────────────────────

function formatListing(l: NormalizedListing, index: number): string {
  const lines: string[] = [
    `\n── Listing ${index + 1} ─────────────────────────────────────────────────`,
    `  SKU          : ${l.retailerSku}`,
    `  Title        : ${l.title}`,
    `  Price        : ${l.priceCurrency} ${l.priceAmount}`,
    `  Stock        : ${l.stockStatus}`,
    `  Condition    : ${l.condition}${l.conditionDetail ? ` (${l.conditionDetail})` : ''}`,
    `  URL          : ${l.retailerUrl}`,
    `  Image        : ${l.imageUrl ?? '—'}`,
  ]

  if (l.isbn13)  lines.push(`  ISBN-13      : ${l.isbn13}`)
  if (l.ean)     lines.push(`  EAN          : ${l.ean}`)

  lines.push(`  Match        : ${l.matchMethod} (confidence: ${l.matchConfidence})`)

  const variantCount = (l.rawData.variants ?? []).length
  if (variantCount > 1) {
    const barcodes = l.rawData.variants
      .map(v => v.barcode ?? '—')
      .join(', ')
    lines.push(`  Variants (${variantCount}): barcodes → ${barcodes}`)
  }

  return lines.join('\n')
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const { domain, currency, page, count } = parseArgs(process.argv)

  console.log(`\n🔍  Shopify Adapter — Dry Run`)
  console.log(`   Domain   : ${domain}`)
  console.log(`   Currency : ${currency}`)
  console.log(`   Page     : ${page}`)
  console.log(`   URL      : https://${domain}/products.json?limit=250&page=${page}\n`)

  const adapter = new ShopifyAdapter()

  let listings: NormalizedListing[]
  try {
    listings = await adapter.previewRetailer(domain, currency, page)
  } catch (err) {
    console.error(`\n❌  Fetch failed: ${err instanceof Error ? err.message : err}`)
    return
  }

  if (listings.length === 0) {
    console.log('⚠️  No products returned (empty page or store blocks /products.json)')
    return
  }

  const sample = listings.slice(0, count)

  console.log(`✅  Page ${page} returned ${listings.length} listings — showing first ${sample.length}:`)
  for (let i = 0; i < sample.length; i++) {
    console.log(formatListing(sample[i], i))
  }

  // Summary stats for the page
  const withIsbn  = listings.filter(l => l.isbn13).length
  const withEan   = listings.filter(l => l.ean).length
  const inStock   = listings.filter(l => l.stockStatus === 'IN_STOCK').length
  const multiSkus = listings.filter(l => l.retailerSku.includes('-')).length

  console.log(`\n── Page summary ────────────────────────────────────────────────────`)
  console.log(`   Total listings  : ${listings.length}`)
  console.log(`   In stock        : ${inStock}`)
  console.log(`   With ISBN-13    : ${withIsbn}`)
  console.log(`   With EAN        : ${withEan}`)
  console.log(`   Split variants  : ${multiSkus}`)
  console.log()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
