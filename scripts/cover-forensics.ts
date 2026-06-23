/** READ-ONLY: Phase 4 forensics — classify every remaining missing cover by exact cause. */
import { prisma } from '../lib/prisma'
import { classifyText } from '../lib/search/isLikelyComic'

const ALWAYS_COMIC_FORMATS = new Set(['SINGLE_ISSUE','TPB','HARDCOVER','OMNIBUS','DELUXE','COMPENDIUM','MANGA_VOLUME','ABSOLUTE'])

async function main() {
  const rows = await prisma.$queryRawUnsafe<Array<{
    id: string; title: string; publisher: string|null; fmt: string; missing: boolean; has_cv: boolean; has_ri: boolean
  }>>(`
    SELECT cp.id, cp.title, cp.publisher, cp.format::text AS fmt,
           (cp.cover_image_url IS NULL) AS missing,
           (cp.comicvine_id IS NOT NULL) AS has_cv,
           EXISTS(SELECT 1 FROM retailer_listings rl WHERE rl.canonical_product_id=cp.id AND rl.deleted_at IS NULL
                   AND rl.image_url IS NOT NULL AND rl.image_url<>'') AS has_ri
      FROM canonical_products cp WHERE cp.deleted_at IS NULL
  `)
  const isComic = (r: {fmt:string;title:string;publisher:string|null}) =>
    ALWAYS_COMIC_FORMATS.has(r.fmt) || classifyText(`${r.title} ${r.publisher ?? ''}`) === 'comic'

  let comicTotal=0, comicCov=0, nonTotal=0, nonCov=0
  // remaining-missing cause buckets
  let c_genuine=0, c_wrongEdition=0, c_residualRI=0   // comic missing
  let nc_hasRI=0, nc_none=0                            // non-comic missing
  for (const r of rows) {
    const comic = isComic(r)
    if (comic) { comicTotal++; if(!r.missing) comicCov++ }
    else { nonTotal++; if(!r.missing) nonCov++ }
    if (!r.missing) continue
    if (comic) {
      if (r.has_ri) c_residualRI++           // had retailer image but rejected (dup/broken) or not yet
      else if (r.has_cv) c_wrongEdition++     // only CV volume-default available (wrong-volume risk)
      else c_genuine++                        // no free source anywhere
    } else {
      if (r.has_ri) nc_hasRI++                // source exists but withheld (non-comic — cleanup, not cover)
      else nc_none++
    }
  }
  const live = rows.length, cov = comicCov + nonCov, missing = live - cov
  console.log('═══ COVER FORENSICS (post-recovery) ═══')
  console.log(`Live products        : ${live.toLocaleString()}`)
  console.log(`Covered (raw)        : ${cov.toLocaleString()} (${(cov/live*100).toFixed(1)}%)`)
  console.log(`Missing (raw)        : ${missing.toLocaleString()}`)
  console.log('\n── By comic-relevance ──')
  console.log(`  COMIC products     : ${comicTotal.toLocaleString()}  covered ${comicCov.toLocaleString()} = ${(comicCov/comicTotal*100).toFixed(1)}%  ← the metric that matters`)
  console.log(`  non-comic products : ${nonTotal.toLocaleString()}  covered ${nonCov.toLocaleString()} = ${(nonCov/Math.max(nonTotal,1)*100).toFixed(1)}%`)
  console.log('\n── Remaining COMIC missing — by cause ──')
  console.log(`  genuinely unavailable (no free source)      : ${c_genuine.toLocaleString()}`)
  console.log(`  source exists but WRONG EDITION (CV vol-only): ${c_wrongEdition.toLocaleString()}`)
  console.log(`  residual (retailer img dup/broken)          : ${c_residualRI.toLocaleString()}`)
  console.log('\n── Remaining NON-COMIC missing — by cause ──')
  console.log(`  source exists but WITHHELD (retailer img; non-comic → cleanup, not cover): ${nc_hasRI.toLocaleString()}`)
  console.log(`  no source (non-comic)                                                   : ${nc_none.toLocaleString()}`)
  await prisma.$disconnect()
}
main().catch(e => { console.error('ERR', e); process.exit(1) })
