/**
 * One-shot diagnostic: fetch page 1 from a domain, report barcode coverage
 * and show any products that carry condition-style variant titles.
 * Usage: npm run test:shopify -- <domain> (not this script directly)
 * This script is invoked via: dotenv -e .env.local -- tsx scripts/probe-barcodes.ts <domain>
 */
import { ShopifyAdapter } from '../lib/adapters/shopify'

const domain = process.argv[2]
if (!domain) { console.error('Usage: probe-barcodes.ts <domain>'); process.exit(1) }

async function main() {
  const adapter  = new ShopifyAdapter()
  const listings = await adapter.previewRetailer(domain, 'GBP', 1)

  console.log(`\n📦  ${domain} — barcode + variant diagnostic (${listings.length} listings on page 1)\n`)

  const withIsbn  = listings.filter(l => l.isbn13)
  const withEan   = listings.filter(l => l.ean)
  const splitVars = listings.filter(l => l.retailerSku.includes('-'))
  const condVars  = listings.filter(l => l.conditionDetail)

  console.log(`  ISBN-13 found      : ${withIsbn.length}`)
  console.log(`  EAN found          : ${withEan.length}`)
  console.log(`  Split variants     : ${splitVars.length}`)
  console.log(`  Condition variants : ${condVars.length}`)

  // Sample barcode raw data
  const barcodeExamples = listings
    .flatMap(l => l.rawData.variants.map(v => ({ title: l.title, barcode: v.barcode, variantTitle: v.title })))
    .filter(x => x.barcode)
    .slice(0, 5)

  if (barcodeExamples.length > 0) {
    console.log('\n  ── Barcode examples ──')
    for (const ex of barcodeExamples) {
      console.log(`    "${ex.title}" | variant="${ex.variantTitle}" | barcode=${ex.barcode}`)
    }
  } else {
    console.log('\n  ⚠  No barcodes found in any variant on page 1 (store does not populate barcode field)')
  }

  // Sample condition-style variant titles
  const condExamples = listings
    .flatMap(l => l.rawData.variants.map(v => ({ title: l.title, variantTitle: v.title })))
    .filter(x => x.variantTitle && x.variantTitle.toLowerCase() !== 'default title')
    .slice(0, 8)

  if (condExamples.length > 0) {
    console.log('\n  ── Non-default variant titles (condition/edition candidates) ──')
    for (const ex of condExamples) {
      console.log(`    "${ex.title}" → variant: "${ex.variantTitle}"`)
    }
  }
}

main().catch(err => { console.error(err); process.exit(1) })
