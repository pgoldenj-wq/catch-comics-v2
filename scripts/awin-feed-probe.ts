/**
 * awin-feed-probe.ts — READ-ONLY. Proves that an entitled Awin feed actually
 * yields comic prices, rather than merely that we are allowed to download it.
 *
 * Uses AwinFeedAdapter.previewFeed, which streams and breaks after `limit`
 * rows, so a 150k-product feed costs a few hundred rows, not 200MB. Zero
 * database writes. The datafeed key is never printed and is redacted from any
 * error before it reaches stdout.
 *
 *   npx dotenv -e <main>/.env.local -- npx tsx scripts/awin-feed-probe.ts
 */
import { AwinFeedAdapter } from '@/lib/adapters/awin-feed'

const KEY = process.env.AWIN_DATAFEED_KEY
const LIMIT = 400

const redact = (s: string) => (KEY ? s.split(KEY).join('<AWIN_DATAFEED_KEY>') : s)

/** Entitled, active feeds confirmed by scripts/awin-entitlements.ts. */
const FEEDS: { label: string; feedId: string; format: 'csv' | 'xml' }[] = [
  { label: 'Waterstones',       feedId: '3787',   format: 'csv' },
  { label: 'Lets Buy Books',    feedId: '112530', format: 'csv' },
  { label: 'Bookshop.org - UK', feedId: '99173',  format: 'csv' },
  { label: 'Scholastic',        feedId: '2957',   format: 'csv' },
]

async function main() {
  if (!KEY) { console.log('AWIN_DATAFEED_KEY not set — nothing to probe.'); return }

  const adapter = new AwinFeedAdapter()

  for (const f of FEEDS) {
    console.log(`\n═══ ${f.label} — feed ${f.feedId} (${f.format}) ═══`)
    const t0 = Date.now()
    try {
      const p = await adapter.previewFeed(f.feedId, KEY, f.format, LIMIT)
      const identified = p.withIsbn + p.withEan
      const pct = p.total ? Math.round((identified / p.total) * 100) : 0
      console.log(`  rows sampled ${p.total} in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
      console.log(`  identifiers: ISBN ${p.withIsbn} · EAN ${p.withEan} · none ${p.unmatched} → ${pct}% matchable`)

      const priced = p.sample.filter(s => Number(s.search_price) > 0)
      console.log(`  priced rows in sample: ${priced.length}/${p.sample.length}`)
      const currencies = [...new Set(p.sample.map(s => s.currency).filter(Boolean))]
      console.log(`  currencies: ${currencies.join(', ') || '—'}`)
      const stock = [...new Set(p.sample.map(s => String((s as unknown as Record<string, unknown>).in_stock ?? '')).filter(Boolean))]
      console.log(`  in_stock values: ${stock.join(', ') || '—'}`)

      for (const s of p.sample.slice(0, 4)) {
        const r = s as unknown as Record<string, unknown>
        console.log(`    "${String(s.product_name).slice(0, 52)}"`)
        console.log(`      ${s.currency} ${s.search_price} · isbn ${String(r.isbn ?? '—')} · ean ${String(r.ean ?? '—')} · stock ${String(r.in_stock ?? '—')} · cond ${String(r.condition ?? '—')}`)
        console.log(`      deep link host: ${(() => { try { return new URL(String(s.aw_deep_link || s.merchant_deep_link)).host } catch { return 'unparseable' } })()}`)
      }

      // Does this feed carry anything that looks like a graphic novel at all?
      const comicish = p.sample.filter(s =>
        /manga|comic|graphic novel|omnibus|marvel|dc |batman|vol\.|volume/i.test(
          `${s.product_name} ${(s as unknown as Record<string, unknown>).merchant_category ?? ''}`))
      console.log(`  comic-looking rows in sample: ${comicish.length}/${p.sample.length}`)
      if (comicish[0]) console.log(`    e.g. "${String(comicish[0].product_name).slice(0, 60)}" at ${comicish[0].currency} ${comicish[0].search_price}`)
    } catch (e) {
      console.log(`  FAILED: ${redact(e instanceof Error ? e.message : String(e))}`)
    }
  }
}

main().catch(e => { console.error(redact(e instanceof Error ? (e.stack ?? e.message) : String(e))); process.exit(1) })
