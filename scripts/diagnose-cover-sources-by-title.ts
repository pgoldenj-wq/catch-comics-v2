/** READ-ONLY: trace PRODUCT → stored cover → every exact-identity source.
 *
 * For each product whose title matches the pattern(s), prints the stored R2
 * cover's real dimensions, then measures every candidate source that is keyed
 * to the SAME product identity (its own retailer listings, Open Library and
 * Google Books by its own ISBN-13, its ComicVine issue image). No writes.
 *
 *   npx dotenv -e .env.local -- tsx scripts/diagnose-cover-sources-by-title.ts "blade runner%" "saga%"
 */
import sharp from 'sharp'
import { prisma } from '../lib/prisma'

const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }

async function dims(u: string): Promise<string> {
  try {
    const r = await fetch(u, { signal: AbortSignal.timeout(15000), headers: UA, redirect: 'follow' })
    if (!r.ok) return `HTTP${r.status}`
    const b = Buffer.from(await r.arrayBuffer())
    const m = await sharp(b).metadata()
    return `${m.width}x${m.height} ${(b.byteLength / 1024).toFixed(0)}KB`
  } catch { return 'err' }
}

async function main() {
  const pats = process.argv.slice(2)
  if (!pats.length) throw new Error('pass one or more ILIKE title patterns')
  for (const pat of pats) {
    const rows = await prisma.$queryRawUnsafe<{ id: string; title: string; isbn_13: string | null; format: string; cover_image_url: string | null; cv: unknown }[]>(
      `SELECT id, title, isbn_13, format::text AS format, cover_image_url, cv_metadata AS cv
         FROM canonical_products WHERE deleted_at IS NULL AND title ILIKE $1 ORDER BY title LIMIT 12`, pat)
    console.log(`\n══ ${pat} — ${rows.length} products ══`)
    for (const p of rows) {
      console.log(`\n• ${p.title}  [${p.format}]  isbn=${p.isbn_13 ?? '-'}  id=${p.id.slice(0, 8)}`)
      console.log(`    stored   ${p.cover_image_url ? await dims(p.cover_image_url) : '(none)'}  ${p.cover_image_url?.split('/').pop()}`)
      const listings = await prisma.$queryRawUnsafe<{ image_url: string | null; name: string; isbn_13: string | null }[]>(
        `SELECT l.image_url, r.name, l.isbn_13 FROM retailer_listings l JOIN retailers r ON r.id = l.retailer_id
          WHERE l.canonical_product_id = $1::uuid AND l.deleted_at IS NULL`, p.id)
      for (const l of listings) {
        if (!l.image_url) continue
        console.log(`    listing  ${(await dims(l.image_url)).padEnd(18)} ${l.name} isbn=${l.isbn_13 ?? '-'}  ${l.image_url.slice(0, 110)}`)
      }
      if (p.isbn_13) {
        console.log(`    OL -L    ${await dims(`https://covers.openlibrary.org/b/isbn/${p.isbn_13}-L.jpg?default=false`)}`)
        console.log(`    GB z=0   ${await dims(`https://books.google.com/books/content?vid=ISBN${p.isbn_13}&printsec=frontcover&img=1&zoom=0`)}`)
        console.log(`    GB z=1   ${await dims(`https://books.google.com/books/content?vid=ISBN${p.isbn_13}&printsec=frontcover&img=1&zoom=1`)}`)
      }
      const cv = p.cv as Record<string, unknown> | null
      if (cv) console.log(`    cv keys  ${Object.keys(cv).join(',').slice(0, 160)}`)
    }
  }
  await prisma.$disconnect()
}
main().catch(e => { console.error('ERR', e); process.exit(1) }).finally(() => prisma.$disconnect())
