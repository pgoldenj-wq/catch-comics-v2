/** READ-ONLY: launch-prioritise the remaining comic products with missing covers.
 *  Exports CSV + prints A/B/C buckets. No recovery, no writes. */
import fs from 'fs'
import path from 'path'
import { prisma } from '../lib/prisma'
import { classifyText } from '../lib/search/isLikelyComic'
import { SERIES_REGISTRY } from '../lib/series/registry'

const ALWAYS_COMIC_FORMATS = new Set(['SINGLE_ISSUE','TPB','HARDCOVER','OMNIBUS','DELUXE','COMPENDIUM','MANGA_VOLUME','ABSOLUTE'])
const TIER1_CV = new Map(Object.entries(SERIES_REGISTRY).map(([slug, e]) => [e.cvVolumeId, slug]))
const HIGH_TRAFFIC = ['marvel','dc comics','dc black label','image comics','dark horse','viz','kodansha','idw','boom','yen press','dynamite','titan','valiant','oni press','fantagraphics','seven seas','square enix','vertical','dark horse manga']

interface Row {
  id: string; title: string; series_name: string|null; publisher: string|null; format: string
  isbn_13: string|null; yr: number|null; comicvine_id: string|null; retailers: bigint; has_ri: boolean
}
const n = (v: unknown) => Number(v as bigint)

function isHighTraffic(pub: string|null) { const p=(pub??'').toLowerCase(); return HIGH_TRAFFIC.some(h=>p.includes(h)) }
function reason(r: Row) {
  if (r.has_ri) return 'retailer image rejected (dup/broken)'
  if (r.comicvine_id) return 'CV volume-only (wrong-edition risk)'
  return 'genuinely unavailable (no free source)'
}

async function main() {
  const rows = await prisma.$queryRawUnsafe<Row[]>(`
    SELECT cp.id, cp.title, cp.series_name, cp.publisher, cp.format::text AS format, cp.isbn_13,
           EXTRACT(YEAR FROM cp.release_date)::int AS yr, cp.comicvine_id,
           COUNT(rl.id) FILTER (WHERE rl.deleted_at IS NULL) AS retailers,
           EXISTS(SELECT 1 FROM retailer_listings r2 WHERE r2.canonical_product_id=cp.id AND r2.deleted_at IS NULL
                   AND r2.image_url IS NOT NULL AND r2.image_url<>'') AS has_ri
      FROM canonical_products cp
      LEFT JOIN retailer_listings rl ON rl.canonical_product_id=cp.id
     WHERE cp.deleted_at IS NULL AND cp.cover_image_url IS NULL
     GROUP BY cp.id
  `)
  const comics = rows.filter(r => ALWAYS_COMIC_FORMATS.has(r.format) || classifyText(`${r.title} ${r.publisher ?? ''}`) === 'comic')
  console.log(`Comic products missing covers: ${comics.length.toLocaleString()}\n`)

  const scored = comics.map(r => {
    const tier1 = TIER1_CV.get(r.comicvine_id ?? '')
    const ht = isHighTraffic(r.publisher)
    const typed = ALWAYS_COMIC_FORMATS.has(r.format)
    const rc = n(r.retailers)
    const score = (tier1?1000:0) + (ht?200:0) + rc*15 + (typed?50:0) + ((r.yr??0)>=2023?40:0)
    return { ...r, rc, tier1, ht, typed, score, reason: reason(r) }
  }).sort((a,b)=>b.score-a.score)

  // Export CSV
  const csv = ['title,series,format,publisher,isbn13,year,retailers,tier1_series,high_traffic_pub,score,failure_reason']
  for (const s of scored) csv.push([
    JSON.stringify(s.title.slice(0,80)), JSON.stringify(s.series_name??''), s.format, JSON.stringify(s.publisher??''),
    s.isbn_13??'', s.yr??'', s.rc, s.tier1??'', s.ht?'yes':'', s.score, JSON.stringify(s.reason)
  ].join(','))
  const out = path.join(__dirname, 'cover-gap-comics.csv')
  fs.writeFileSync(out, csv.join('\n'))
  console.log(`Exported ${scored.length} rows → ${out}\n`)

  // Breakdowns
  const byPub = new Map<string,number>(); const byFmt = new Map<string,number>()
  let visible=0, withRetailers2=0, ht=0, tier1=0, recent=0
  for (const s of scored) {
    byPub.set(s.publisher??'(none)', (byPub.get(s.publisher??'(none)')??0)+1)
    byFmt.set(s.format, (byFmt.get(s.format)??0)+1)
    if (s.rc>0) visible++; if (s.rc>=2) withRetailers2++; if (s.ht) ht++; if (s.tier1) tier1++; if((s.yr??0)>=2023) recent++
  }
  console.log(`Visible (>=1 listing): ${visible}  ·  >=2 retailers: ${withRetailers2}  ·  high-traffic pub: ${ht}  ·  Tier1-series: ${tier1}  ·  released >=2023: ${recent}`)
  console.log('\n── by format ──'); for (const [f,c] of [...byFmt].sort((a,b)=>b[1]-a[1])) console.log(`  ${f.padEnd(14)} ${c}`)
  console.log('\n── top 15 publishers (missing) ──'); for (const [p,c] of [...byPub].sort((a,b)=>b[1]-a[1]).slice(0,15)) console.log(`  ${String(c).padStart(4)} ${p.slice(0,40)}`)

  // Tier1 series gaps
  console.log('\n── TIER 1 LAUNCH SERIES gaps ──')
  const t1 = scored.filter(s=>s.tier1)
  if (!t1.length) console.log('  none')
  for (const s of t1) console.log(`  [${s.tier1}] ${s.title.slice(0,50)} (${s.format}, ${s.rc} retailers) — ${s.reason}`)

  // High-traffic publisher, visible — Priority A candidates
  console.log('\n── HIGH-TRAFFIC PUBLISHER, visible (>=2 retailers) — top 30 ──')
  const a = scored.filter(s=>s.ht && s.rc>=2)
  console.log(`  (total: ${a.length})`)
  for (const s of a.slice(0,30)) console.log(`  ${String(s.score).padStart(4)} [${(s.publisher??'').slice(0,16).padEnd(16)}] ${s.title.slice(0,46)} (${s.format}, ${s.rc}r, ${s.yr??'?'})`)

  // A/B/C buckets
  const A = scored.filter(s => s.tier1 || (s.ht && s.rc>=2))
  const B = scored.filter(s => !A.includes(s) && (s.ht || (s.typed && s.rc>=2)))
  const C = scored.filter(s => !A.includes(s) && !B.includes(s))
  console.log('\n══ PRIORITY BUCKETS ══')
  console.log(`  A (must fix before launch): ${A.length}`)
  console.log(`  B (nice to have)          : ${B.length}`)
  console.log(`  C (post-launch long tail) : ${C.length}`)
  await prisma.$disconnect()
}
main().catch(e => { console.error('ERR', e); process.exit(1) })
