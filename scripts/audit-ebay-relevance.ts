/**
 * audit-ebay-relevance.ts — measure the product-page eBay gate against LIVE data.
 *
 * lib/listings/productRelevance decides which title-derived eBay rows may be
 * priced as offers for a product. A gate like that is a claim about real
 * listings, and a claim about real listings has to be checked against real
 * listings before it ships — a unit test only proves it does what its author
 * expected on the strings its author thought of.
 *
 * This asks production for the offers it is serving RIGHT NOW, applies the gate
 * to each row, and prints what would survive. It reports two risks in both
 * directions:
 *   • rows the gate REFUSES that look correct (over-refusal — an empty rail)
 *   • rows the gate KEEPS that look wrong  (under-refusal — the original bug)
 *
 * READ-ONLY. GET requests to our own public API. No database access, no writes,
 * no third-party key. Each product costs one /api/ebay call, which is one live
 * eBay Browse call, so the sample is deliberately small.
 *
 * Run: npm run audit:ebay-relevance
 *      npm run audit:ebay-relevance -- --base http://localhost:3000
 */
import { listingMatchesProduct } from '@/lib/listings/productRelevance'

const argOf = (flag: string, fallback: string) => {
  const i = process.argv.indexOf(flag)
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const BASE = argOf('--base', 'https://www.catchcomics.com').replace(/\/+$/, '')

/** Queries chosen to span the shapes the gate has to survive. */
const QUERIES = [
  'hellboy omnibus',      // generic stored title, volumeNumber null — the bug
  'absolute batman',      // titles that DO name a volume
  'saga volume',          // long-running series, many adjacent volumes
  'chainsaw man',         // manga, numbered volumes
  'watchmen',             // single famous edition, no volume at all
  'sandman omnibus',      // omnibus vs volumes vs box set
  'x-men',                // bare series name stored as a whole TPB title (2026-09-26)
  'invincible volume 3',  // "Invincible Iron Man Volume 3" contains every word
  'star wars vol',        // Darth Vader / Doctor Aphra / Epic Collection "Vol 3"s
  'berserk volume',       // Deluxe hardcovers sold as "Berserk Volume 1"
]
const PER_QUERY = 2       // products sampled per query

type Canon = { title: string; isbn13: string | null }
type Row = { title: string; price: { value: number }; itemWebUrl?: string }

/**
 * Rows from the ISBN search are edition-anchored and the route never gates
 * them. eBay echoes the search keyword back in the item URL as `_skw`, so a
 * row whose `_skw` is our ISBN came from the ISBN search.
 */
const fromIsbnSearch = (l: Row, isbn13: string | null) =>
  !!isbn13 && String(l.itemWebUrl ?? '').includes(`_skw=${isbn13}`)

const money = (n: number) => `£${n.toFixed(2)}`

async function getJson(url: string): Promise<any> {
  const r = await fetch(url, { headers: { 'User-Agent': 'cc-ebay-relevance-audit/1' } })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

async function main() {
  console.log('\n═══ eBay PRODUCT-RELEVANCE GATE — LIVE AUDIT ═══')
  console.log(`base: ${BASE}   (read-only)\n`)

  const products: Canon[] = []
  for (const q of QUERIES) {
    try {
      const j = await getJson(`${BASE}/api/search?q=${encodeURIComponent(q)}`)
      const rows: any[] = j.canonicalResults ?? []
      for (const r of rows.slice(0, PER_QUERY)) {
        if (r?.title) products.push({ title: r.title, isbn13: r.isbn13 ?? null })
      }
    } catch (e) {
      console.log(`  ! search "${q}" failed: ${(e as Error).message}`)
    }
  }

  let totalRows = 0, totalKept = 0, emptied = 0, unchanged = 0, cheapestChanged = 0
  const sampled: string[] = []

  for (const p of products) {
    const params = new URLSearchParams()
    if (p.isbn13) params.set('isbn', p.isbn13)
    params.set('title', p.title)

    let listings: Row[] = []
    try {
      const j = await getJson(`${BASE}/api/ebay?${params.toString()}`)
      listings = j.listings ?? []
    } catch (e) {
      console.log(`\n• ${p.title}\n    ! /api/ebay failed: ${(e as Error).message}`)
      continue
    }
    if (listings.length === 0) continue

    sampled.push(p.title)
    const kept = listings.filter(l => fromIsbnSearch(l, p.isbn13) || listingMatchesProduct(l.title, p.title))
    const dropped = listings.filter(l => !kept.includes(l))
    totalRows += listings.length
    totalKept += kept.length

    const cheapBefore = listings[0]
    const cheapAfter = kept[0]
    if (kept.length === 0) emptied++
    else if (kept.length === listings.length) unchanged++
    if (cheapAfter && cheapBefore && cheapAfter.title !== cheapBefore.title) cheapestChanged++

    console.log(`\n• ${p.title}${p.isbn13 ? `  [${p.isbn13}]` : '  [no ISBN]'}`)
    console.log(`    ${listings.length} served → ${kept.length} kept, ${dropped.length} refused`)
    if (cheapBefore) console.log(`    cheapest served : ${money(cheapBefore.price.value)}  ${cheapBefore.title.slice(0, 62)}`)
    if (cheapAfter)  console.log(`    cheapest kept   : ${money(cheapAfter.price.value)}  ${cheapAfter.title.slice(0, 62)}`)
    else             console.log(`    cheapest kept   : — none survive; the page shows stored retailers only`)
    for (const d of dropped.slice(0, 4)) {
      console.log(`      refused: ${money(d.price.value).padEnd(9)} ${d.title.slice(0, 62)}`)
    }
  }

  console.log('\n─── SUMMARY ───')
  console.log(`  products with eBay rows : ${sampled.length}`)
  console.log(`  rows served             : ${totalRows}`)
  console.log(`  rows kept               : ${totalKept}` +
    (totalRows ? `  (${((totalKept / totalRows) * 100).toFixed(0)}%)` : ''))
  console.log(`  rails emptied entirely  : ${emptied}`)
  console.log(`  rails wholly unchanged  : ${unchanged}`)
  console.log(`  cheapest offer corrected: ${cheapestChanged}`)
  console.log('\n  NOTE: rows served came from the target; "kept" applies THIS checkout\'s')
  console.log('  gate. ISBN-search rows (eBay echoes our ISBN back as _skw) are never')
  console.log('  gated, exactly as in app/api/ebay/route.ts. An emptied rail means every')
  console.log('  row was a title-derived keyword hit the gate could not anchor.\n')
}

main().catch(e => { console.error(e); process.exit(1) })
