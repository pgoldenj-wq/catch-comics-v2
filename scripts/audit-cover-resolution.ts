/** READ-ONLY: census of STORED cover pixel dimensions across the live catalogue.
 *
 * Reads only the first 64 bytes of each R2 WebP (HTTP Range) and parses the
 * VP8 / VP8L / VP8X header for width x height — no full downloads, no DB writes.
 * Answers: how many covers are genuinely low-resolution at the source, and in
 * which formats / shapes (e.g. 200x200 letterboxed retailer thumbnails).
 *
 *   npx dotenv -e .env.local -- tsx scripts/audit-cover-resolution.ts            # full census
 *   npx dotenv -e .env.local -- tsx scripts/audit-cover-resolution.ts --sample 2000
 *   ... --out scripts/.cover-resolution-census.json   (writes id,w,h rows for follow-up)
 */
import fs from 'fs'
import { prisma } from '../lib/prisma'
import { webpDims, effectiveCoverWidth } from '../lib/images/webp-dims'

const CONCURRENCY = 48
const argv = process.argv.slice(2)
const sampleIdx = argv.indexOf('--sample')
const SAMPLE = sampleIdx >= 0 ? parseInt(argv[sampleIdx + 1], 10) : 0
const outIdx = argv.indexOf('--out')
const OUT = outIdx >= 0 ? argv[outIdx + 1] : null

async function headerDims(url: string): Promise<{ w: number; h: number } | 'err'> {
  try {
    const r = await fetch(url, { headers: { Range: 'bytes=0-63' }, signal: AbortSignal.timeout(15000) })
    if (!r.ok) return 'err'
    return webpDims(Buffer.from(await r.arrayBuffer())) ?? 'err'
  } catch { return 'err' }
}

const bucket = (w: number) => w < 150 ? '<150' : w < 250 ? '150-249' : w < 350 ? '250-349' : w < 500 ? '350-499' : w < 800 ? '500-799' : '800+'

async function main() {
  const rows = await prisma.$queryRawUnsafe<{ id: string; url: string; format: string }[]>(`
    SELECT id, cover_image_url AS url, format::text AS format FROM canonical_products
     WHERE deleted_at IS NULL AND cover_image_url LIKE 'https://images.catchcomics.com/covers/%'
     ${SAMPLE ? `ORDER BY random() LIMIT ${SAMPLE}` : ''}`)
  console.log(`Measuring ${rows.length.toLocaleString()} stored R2 covers (64-byte header reads)…`)

  const results: { id: string; format: string; w: number; h: number }[] = []
  let errs = 0, i = 0
  async function worker() {
    while (i < rows.length) {
      const r = rows[i++]
      const d = await headerDims(r.url)
      if (d === 'err') { errs++; continue }
      results.push({ id: r.id, format: r.format, w: d.w, h: d.h })
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))

  const byBucket = new Map<string, number>()
  const byFormat = new Map<string, { n: number; low: number }>()
  let square = 0, sq200 = 0
  for (const r of results) {
    byBucket.set(bucket(r.w), (byBucket.get(bucket(r.w)) ?? 0) + 1)
    const f = byFormat.get(r.format) ?? { n: 0, low: 0 }
    f.n++; if (r.w < 300) f.low++
    byFormat.set(r.format, f)
    if (Math.abs(r.h / r.w - 1) < 0.05) { square++; if (r.w <= 200) sq200++ }
  }
  const n = results.length
  const eff = results.map(r => effectiveCoverWidth(r.w, r.h))
  console.log(`\nMeasured ${n.toLocaleString()}  (unreadable: ${errs})`)
  // A search/product thumbnail is ~100 CSS px wide: DPR 2 needs 200px of real
  // artwork, DPR 3 needs 300px.
  const under200 = eff.filter(x => x < 200).length, under300 = eff.filter(x => x < 300).length
  console.log(`\nArtwork width < 200px (soft at DPR 2): ${under200.toLocaleString()}  ${((under200 / n) * 100).toFixed(1)}%`)
  console.log(`Artwork width < 300px (soft at DPR 3): ${under300.toLocaleString()}  ${((under300 / n) * 100).toFixed(1)}%`)
  console.log(`\nStored width buckets:`)
  for (const k of ['<150', '150-249', '250-349', '350-499', '500-799', '800+'])
    console.log(`  ${k.padEnd(8)} ${String(byBucket.get(k) ?? 0).padStart(7)}  ${(((byBucket.get(k) ?? 0) / n) * 100).toFixed(1)}%`)
  console.log(`\nSquare (letterboxed) covers: ${square}  (of which <=200px: ${sq200})`)
  console.log(`\nBy format (n / stored width <300px):`)
  for (const [k, v] of [...byFormat].sort((a, b) => b[1].n - a[1].n))
    console.log(`  ${k.padEnd(14)} ${String(v.n).padStart(7)}  low ${String(v.low).padStart(6)}  ${((v.low / v.n) * 100).toFixed(0)}%`)
  if (OUT) { fs.writeFileSync(OUT, JSON.stringify(results)); console.log(`\nwrote ${OUT}`) }
  await prisma.$disconnect()
}
main().catch(e => { console.error('ERR', e); process.exit(1) }).finally(() => prisma.$disconnect())
