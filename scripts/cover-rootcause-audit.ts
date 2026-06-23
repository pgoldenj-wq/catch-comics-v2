/**
 * READ-ONLY: root-cause breakdown of WHY each missing cover is missing.
 * Distinguishes SOURCE ceiling (no cover exists anywhere free) from PIPELINE
 * ceiling (a cover exists in a source we never query). No writes.
 *
 * Untapped sources investigated:
 *   - retailer_listings.image_url  (feed cover thumbnails — pipeline never used these)
 *   - retailer_listings.raw_data   (full feed JSON — may hold more image fields)
 *   - cv_metadata                  (cached CV image?)
 *   - ComicVine id already present  (528 — issue=correct, volume=wrong-vol)
 *   - ISBN-10 vs ISBN-13           (OL may have the cover under the other ISBN)
 */
import crypto from 'crypto'
import sharp from 'sharp'
import { prisma } from '../lib/prisma'

const KNOWN_PLACEHOLDER = new Set(['06661fd690879985', '2cafc2b0f16dfe03', '307a2fbbc46139a8', 'b3165c10e262603d'])
const n = (v: unknown) => Number(v as bigint)

async function realRate(urls: string[]): Promise<{ real: number; placeholder: number; dead: number; newPlaceholders: string[] }> {
  const hashes = new Map<string, number>()
  const recs: Array<{ ok: boolean; hash?: string }> = []
  const CONC = 15
  for (let i = 0; i < urls.length; i += CONC) {
    const batch = urls.slice(i, i + CONC)
    const res = await Promise.all(batch.map(async u => {
      try {
        const r = await fetch(u, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Mozilla/5.0' } })
        if (!r.ok) return { ok: false }
        const ct = r.headers.get('content-type') ?? ''
        if (!ct.startsWith('image/') && ct !== 'application/octet-stream') return { ok: false }
        const buf = Buffer.from(await r.arrayBuffer())
        const meta = await sharp(buf).metadata()
        if ((meta.width ?? 0) < 50 || (meta.height ?? 0) < 50) return { ok: false }
        const hash = crypto.createHash('sha256').update(
          await sharp(buf).resize(400, undefined, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toBuffer()
        ).digest('hex').slice(0, 16)
        return { ok: true, hash }
      } catch { return { ok: false } }
    }))
    recs.push(...res)
    for (const r of res) if (r.hash) hashes.set(r.hash, (hashes.get(r.hash) ?? 0) + 1)
  }
  const repeated = new Set([...hashes.entries()].filter(([, c]) => c >= 3).map(([h]) => h))
  let real = 0, placeholder = 0, dead = 0
  for (const r of recs) {
    if (!r.ok) dead++
    else if (KNOWN_PLACEHOLDER.has(r.hash!) || repeated.has(r.hash!)) placeholder++
    else real++
  }
  return { real, placeholder, dead, newPlaceholders: [...repeated] }
}

async function main() {
  const missing = await prisma.canonicalProduct.count({ where: { deletedAt: null, coverImageUrl: null } })
  console.log(`═══ ROOT-CAUSE AUDIT of ${missing.toLocaleString()} missing covers ═══\n`)

  // ── Untapped-source availability counts ──
  const [c] = await prisma.$queryRawUnsafe<Array<Record<string, bigint>>>(`
    WITH miss AS (SELECT id, comicvine_id, isbn_10, isbn_13, format::text AS fmt, cv_metadata
                    FROM canonical_products WHERE deleted_at IS NULL AND cover_image_url IS NULL)
    SELECT
      (SELECT COUNT(DISTINCT m.id) FROM miss m
         JOIN retailer_listings rl ON rl.canonical_product_id=m.id
        WHERE rl.deleted_at IS NULL AND rl.image_url IS NOT NULL AND rl.image_url <> '') AS has_retailer_img,
      (SELECT COUNT(*) FROM miss WHERE comicvine_id IS NOT NULL) AS has_cv,
      (SELECT COUNT(*) FROM miss WHERE fmt <> 'OTHER') AS typed,
      (SELECT COUNT(*) FROM miss WHERE isbn_10 IS NOT NULL) AS has_isbn10,
      (SELECT COUNT(*) FROM miss WHERE cv_metadata IS NOT NULL) AS has_cvmeta
  `)
  console.log('── Untapped-source availability among missing covers ──')
  console.log(`  has retailer image_url (in our DB!) : ${n(c.has_retailer_img).toLocaleString()}`)
  console.log(`  has comicvine_id                    : ${n(c.has_cv).toLocaleString()}`)
  console.log(`  typed format (CV-matchable)         : ${n(c.typed).toLocaleString()}`)
  console.log(`  has ISBN-10 (OL alt-ISBN retry)     : ${n(c.has_isbn10).toLocaleString()}`)
  console.log(`  has cv_metadata                     : ${n(c.has_cvmeta).toLocaleString()}`)

  // ── retailer image host distribution ──
  const hosts = await prisma.$queryRawUnsafe<Array<{ host: string; c: bigint }>>(`
    SELECT split_part(regexp_replace(rl.image_url,'^https?://',''),'/',1) AS host, COUNT(DISTINCT m.id) AS c
      FROM (SELECT id FROM canonical_products WHERE deleted_at IS NULL AND cover_image_url IS NULL) m
      JOIN retailer_listings rl ON rl.canonical_product_id=m.id
     WHERE rl.deleted_at IS NULL AND rl.image_url IS NOT NULL AND rl.image_url <> ''
     GROUP BY 1 ORDER BY COUNT(DISTINCT m.id) DESC LIMIT 12
  `)
  console.log('\n── retailer image_url hosts (missing-cover products) ──')
  for (const h of hosts) console.log(`  ${n(h.c).toLocaleString().padStart(7)}  ${h.host}`)

  // ── PROBE 1: real-rate of retailer images ──
  const ri = await prisma.$queryRawUnsafe<Array<{ image_url: string }>>(`
    SELECT DISTINCT ON (m.id) rl.image_url
      FROM (SELECT id FROM canonical_products WHERE deleted_at IS NULL AND cover_image_url IS NULL) m
      JOIN retailer_listings rl ON rl.canonical_product_id=m.id
     WHERE rl.deleted_at IS NULL AND rl.image_url IS NOT NULL AND rl.image_url <> ''
     ORDER BY m.id, rl.image_url
     LIMIT 200
  `)
  console.log(`\n── PROBE retailer images (sample ${ri.length}) ──`)
  const rr = await realRate(ri.map(r => r.image_url))
  console.log(`  REAL: ${rr.real} (${(rr.real/ri.length*100).toFixed(1)}%)  placeholder: ${rr.placeholder}  dead/404: ${rr.dead}`)
  if (rr.newPlaceholders.length) console.log(`  new placeholder hashes: ${rr.newPlaceholders.join(', ')}`)

  // ── PROBE 2: ISBN-10 OL retry (incremental over ISBN-13) ──
  const i10 = await prisma.$queryRawUnsafe<Array<{ isbn_10: string }>>(`
    SELECT isbn_10 FROM canonical_products
     WHERE deleted_at IS NULL AND cover_image_url IS NULL AND isbn_10 IS NOT NULL
     ORDER BY random() LIMIT 150
  `)
  const ol10 = await realRate(i10.map(r => `https://covers.openlibrary.org/b/isbn/${r.isbn_10}-L.jpg?default=false`))
  console.log(`\n── PROBE Open Library by ISBN-10 (sample ${i10.length}) ──`)
  console.log(`  REAL: ${ol10.real} (${(ol10.real/i10.length*100).toFixed(1)}%)`)

  await prisma.$disconnect()
}
main().catch(e => { console.error('ERR', e); process.exit(1) })
