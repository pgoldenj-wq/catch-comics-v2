#!/usr/bin/env tsx
/**
 * scripts/test-awin-feed.ts
 *
 * Dry-run parser for an Awin affiliate feed.
 * Downloads and parses the first 500 rows WITHOUT writing to the database.
 * Shows match rate breakdown and a sample of matched vs unmatched products.
 *
 * Usage:
 *   npm run test:awin-feed -- --feed-id 12345
 *   npm run test:awin-feed -- --feed-id 12345 --format xml
 *   npm run test:awin-feed -- --feed-id 12345 --api-key MY_KEY --limit 200
 *
 * Env vars:
 *   AWIN_DATAFEED_KEY — used if --api-key is not passed (distinct from AWIN_API_KEY Publisher key)
 */

import { AwinFeedAdapter } from '../lib/adapters/awin-feed'

// ── CLI args ──────────────────────────────────────────────────────────────────

function arg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag)
  return idx !== -1 ? process.argv[idx + 1] : undefined
}

const feedId     = arg('--feed-id')
const apiKey     = arg('--api-key') ?? process.env.AWIN_DATAFEED_KEY
const feedFormat = (arg('--format') ?? 'csv') as 'xml' | 'csv'
const limit      = parseInt(arg('--limit') ?? '500', 10)

if (!feedId) {
  console.error('Error: --feed-id is required')
  console.error('Usage: npm run test:awin-feed -- --feed-id 12345')
  process.exit(1)
}

if (!apiKey) {
  console.error('Error: no API key — pass --api-key or set AWIN_DATAFEED_KEY env var')
  process.exit(1)
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${'═'.repeat(60)}`)
  console.log(` Awin Feed Dry-Run Test`)
  console.log(` Feed ID : ${feedId}`)
  console.log(` Format  : ${feedFormat}`)
  console.log(` Limit   : ${limit} rows`)
  console.log(`${'═'.repeat(60)}\n`)

  const adapter = new AwinFeedAdapter()

  console.log('Downloading and parsing feed...\n')
  const start = Date.now()

  let preview: Awaited<ReturnType<typeof adapter.previewFeed>>
  try {
    preview = await adapter.previewFeed(feedId!, apiKey!, feedFormat, limit)
  } catch (err) {
    console.error('Feed parse failed:', err)
    process.exit(1)
  }

  const elapsed    = ((Date.now() - start) / 1000).toFixed(1)
  const matchRate  = preview.total > 0
    ? Math.round(((preview.withIsbn + preview.withEan) / preview.total) * 100)
    : 0

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`Parsed ${preview.total} rows in ${elapsed}s\n`)
  console.log(`Match breakdown:`)
  console.log(`  ISBN-13 : ${preview.withIsbn.toLocaleString()} (${preview.total > 0 ? Math.round(preview.withIsbn / preview.total * 100) : 0}%)`)
  console.log(`  EAN     : ${preview.withEan.toLocaleString()} (${preview.total > 0 ? Math.round(preview.withEan / preview.total * 100) : 0}%)`)
  console.log(`  No ID   : ${preview.unmatched.toLocaleString()} (${preview.total > 0 ? Math.round(preview.unmatched / preview.total * 100) : 0}%)`)
  console.log(`  Overall match rate: ${matchRate}%\n`)

  // ── Sample products ───────────────────────────────────────────────────────
  if (preview.sample.length > 0) {
    console.log(`Sample products (first ${Math.min(preview.sample.length, 10)}):\n`)
    const table = preview.sample.slice(0, 10).map(p => ({
      ID     : p.merchant_product_id.slice(0, 20),
      Name   : p.product_name.slice(0, 40),
      Price  : `${p.currency} ${p.search_price}`,
      Stock  : p.in_stock === '1' ? '✓' : '✗',
      ISBN   : p.isbn || '—',
      EAN    : p.ean  || '—',
    }))

    // Simple table output
    const keys = Object.keys(table[0]) as Array<keyof typeof table[0]>
    const widths = keys.map(k => Math.max(k.length, ...table.map(r => String(r[k]).length)))

    const header = keys.map((k, i) => k.padEnd(widths[i])).join('  ')
    const divider = widths.map(w => '─'.repeat(w)).join('  ')
    console.log(header)
    console.log(divider)
    for (const row of table) {
      console.log(keys.map((k, i) => String(row[k]).padEnd(widths[i])).join('  '))
    }
  }

  console.log()

  if (matchRate < 50) {
    console.log('⚠ Match rate below 50% — consider checking:')
    console.log('  • Are ISBNs present in the feed? (isbn / ean columns)')
    console.log('  • Is this a comic/book retailer feed?')
    console.log('  • Is the correct feed_format (xml/csv) specified?')
  } else {
    console.log(`✓ Feed looks healthy — ${matchRate}% of products have ISBN/EAN identifiers`)
  }
  console.log()
}

main().catch(err => { console.error(err); process.exit(1) })
