/**
 * READ-ONLY: measure the REAL recovery rate for missing covers from free
 * sources (Open Library, Google Books) + ComicVine. No DB/R2 writes.
 *
 * For a random sample of missing-cover products, fetch the candidate cover,
 * run the same validity checks the pipeline uses (sharp >=50px) PLUS placeholder
 * detection (known hashes + repeated-hash-across-products = new placeholder),
 * and report how many yield a GENUINE cover.
 */
import crypto from 'crypto'
import sharp from 'sharp'
import { prisma } from '../lib/prisma'

const ISBN_SAMPLE = Number(process.argv[2] ?? 250)
const CONC = 15
const KNOWN_PLACEHOLDER = new Set(['06661fd690879985', '2cafc2b0f16dfe03', '307a2fbbc46139a8', 'b3165c10e262603d'])

interface Probe { source: 'OL' | 'GB' | null; hash?: string; w?: number; h?: number; reason?: string }

async function tryFetch(url: string): Promise<{ buf: Buffer } | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (!r.ok) return null
    const ct = r.headers.get('content-type') ?? ''
    if (!ct.startsWith('image/') && ct !== 'application/octet-stream') return null
    return { buf: Buffer.from(await r.arrayBuffer()) }
  } catch { return null }
}

async function validate(buf: Buffer): Promise<{ ok: boolean; hash: string; w: number; h: number }> {
  const hash = crypto.createHash('sha256').update(
    await sharp(buf).resize(400, undefined, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toBuffer()
  ).digest('hex').slice(0, 16)
  const meta = await sharp(buf).metadata()
  const w = meta.width ?? 0, h = meta.height ?? 0
  return { ok: w >= 50 && h >= 50 && !KNOWN_PLACEHOLDER.has(hash), hash, w, h }
}

async function probeOne(isbn: string): Promise<Probe> {
  // OL with default=false (404 if no cover)
  const ol = await tryFetch(`https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`)
  if (ol) { const v = await validate(ol.buf); if (v.ok) return { source: 'OL', hash: v.hash, w: v.w, h: v.h } }
  // GB
  const gb = await tryFetch(`https://books.google.com/books/content?vid=ISBN${isbn}&printsec=frontcover&img=1&zoom=2&edge=curl`)
  if (gb) { const v = await validate(gb.buf); if (v.ok) return { source: 'GB', hash: v.hash, w: v.w, h: v.h } }
  return { source: null, reason: 'no real cover from OL/GB' }
}

async function main() {
  const rows = await prisma.$queryRawUnsafe<Array<{ isbn_13: string }>>(`
    SELECT isbn_13 FROM canonical_products
    WHERE deleted_at IS NULL AND cover_image_url IS NULL AND isbn_13 IS NOT NULL
    ORDER BY random() LIMIT ${ISBN_SAMPLE}
  `)
  console.log(`Probing ${rows.length} random missing-cover ISBNs against OL + GB…\n`)

  const probes: Probe[] = []
  for (let i = 0; i < rows.length; i += CONC) {
    probes.push(...await Promise.all(rows.slice(i, i + CONC).map(r => probeOne(r.isbn_13))))
  }

  // Repeated-hash detection (a hash seen on 2+ products = placeholder, not a real unique cover)
  const hashCount = new Map<string, number>()
  for (const p of probes) if (p.hash) hashCount.set(p.hash, (hashCount.get(p.hash) ?? 0) + 1)
  const repeated = new Set([...hashCount.entries()].filter(([, c]) => c >= 2).map(([h]) => h))

  let ol = 0, gb = 0, none = 0, suspectNew = 0
  for (const p of probes) {
    if (!p.source) { none++; continue }
    if (repeated.has(p.hash!)) { suspectNew++; none++; continue }  // looks recoverable but is a repeated (placeholder) image
    if (p.source === 'OL') ol++; else gb++
  }
  const recoverable = ol + gb
  console.log('── REAL recovery rate (sample) ──')
  console.log(`  Sample size          : ${rows.length}`)
  console.log(`  Recoverable via OL   : ${ol} (${(ol/rows.length*100).toFixed(1)}%)`)
  console.log(`  Recoverable via GB   : ${gb} (${(gb/rows.length*100).toFixed(1)}%)`)
  console.log(`  GENUINE recoverable  : ${recoverable} (${(recoverable/rows.length*100).toFixed(1)}%)`)
  console.log(`  Unrecoverable        : ${none} (${(none/rows.length*100).toFixed(1)}%)`)
  console.log(`  ⚠ repeated-hash (NEW placeholder variants caught): ${suspectNew}`)
  if (repeated.size) {
    console.log('  Repeated hashes (candidate new placeholder signatures):')
    for (const [h, c] of [...hashCount.entries()].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1])) console.log(`     ${h}  ×${c}`)
  }

  // CV probe (small) — sample CV-linked missing-cover products
  const cvRows = await prisma.$queryRawUnsafe<Array<{ comicvine_id: string }>>(`
    SELECT comicvine_id FROM canonical_products
    WHERE deleted_at IS NULL AND cover_image_url IS NULL AND comicvine_id IS NOT NULL
    ORDER BY random() LIMIT 25
  `)
  let cvOk = 0
  for (const r of cvRows) {
    try {
      const u = `https://comicvine.gamespot.com/api/issue/4000-${r.comicvine_id}/?api_key=${process.env.COMIC_VINE_API_KEY}&format=json&field_list=image`
      const res = await fetch(u, { headers: { 'User-Agent': 'CatchComics/1.0' }, signal: AbortSignal.timeout(15000) })
      const j = await res.json() as { results?: { image?: { original_url?: string } } }
      if (j.results?.image?.original_url && !j.results.image.original_url.includes('img/no_image')) cvOk++
    } catch { /* ignore */ }
    await new Promise(r => setTimeout(r, 350)) // polite to CV rate limit
  }
  console.log(`\n── ComicVine probe ── ${cvOk}/${cvRows.length} CV-linked products return a real image (${cvRows.length ? (cvOk/cvRows.length*100).toFixed(0) : 0}%)`)
  await prisma.$disconnect()
}
main().catch(e => { console.error('ERR', e); process.exit(1) })
