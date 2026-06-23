/**
 * recover-remaining-comic.ts — last safe drops for comic-relevant missing covers:
 *   - SINGLE_ISSUE w/ comicvine_id → CV ISSUE image (edition-correct)
 *   - everything comic-relevant w/ ISBN → OL→GB fallback (edition-correct, guarded)
 * Skips volume-default CV (wrong-volume). Guard rejects placeholders. Reversible (log).
 *
 *   npx dotenv -e .env.local -- tsx scripts/recover-remaining-comic.ts --execute
 */
import fs from 'fs'
import path from 'path'
import { prisma } from '../lib/prisma'
import { classifyText } from '../lib/search/isLikelyComic'
import { downloadAndStoreCoverWithFallback } from '../lib/images/download'

const EXECUTE = process.argv.includes('--execute')
const CONC = 12
const ALWAYS_COMIC_FORMATS = new Set(['SINGLE_ISSUE','TPB','HARDCOVER','OMNIBUS','DELUXE','COMPENDIUM','MANGA_VOLUME','ABSOLUTE'])
const CV = process.env.COMIC_VINE_API_KEY

async function cvIssueImage(issueId: string): Promise<string | null> {
  try {
    const u = `https://comicvine.gamespot.com/api/issue/4000-${issueId}/?api_key=${CV}&format=json&field_list=image`
    const r = await fetch(u, { headers: { 'User-Agent': 'CatchComics/1.0' }, signal: AbortSignal.timeout(12000) })
    const j = await r.json() as { results?: { image?: { super_url?: string; original_url?: string } } }
    const url = j.results?.image?.super_url ?? j.results?.image?.original_url ?? null
    return url && !/no_image|\/uploads\/[^/]+\/0\/\d+\//.test(url) ? url : null
  } catch { return null }
}

async function main() {
  const rows = await prisma.canonicalProduct.findMany({
    where: { deletedAt: null, coverImageUrl: null, isbn13: { not: null } },
    select: { id: true, title: true, publisher: true, format: true, isbn13: true, comicvineId: true },
  })
  const targets = rows.filter(r => ALWAYS_COMIC_FORMATS.has(r.format) || classifyText(`${r.title} ${r.publisher ?? ''}`) === 'comic')
  console.log(`Comic-relevant missing (w/ ISBN): ${targets.length.toLocaleString()}  [${EXECUTE ? 'EXECUTE' : 'DRY RUN'}]`)
  if (!EXECUTE) { await prisma.$disconnect(); return }

  const logPath = path.join(__dirname, `.cover-remaining-recovery-log-${Date.now()}.json`)
  const recoveredIds: string[] = []
  let recovered = 0, failed = 0, done = 0
  for (let i = 0; i < targets.length; i += CONC) {
    const batch = targets.slice(i, i + CONC)
    const res = await Promise.all(batch.map(async p => {
      let cvUrl: string | null = null
      if (p.format === 'SINGLE_ISSUE' && p.comicvineId) cvUrl = await cvIssueImage(p.comicvineId)
      return downloadAndStoreCoverWithFallback(p.id, { cvUrl, isbn13: p.isbn13 }).catch(() => null)
    }))
    res.forEach((r, j) => { if (r) { recovered++; recoveredIds.push(batch[j].id) } else failed++ })
    done += batch.length
    if (done % 600 < CONC) console.log(`  …${done}/${targets.length}  recovered ${recovered}`)
  }
  fs.writeFileSync(logPath, JSON.stringify(recoveredIds, null, 2))
  console.log(`\n✅ Recovered ${recovered}  · none-available ${failed}`)
  const live = await prisma.canonicalProduct.count({ where: { deletedAt: null } })
  const withCover = await prisma.canonicalProduct.count({ where: { deletedAt: null, coverImageUrl: { not: null } } })
  console.log(`Cover coverage now: ${withCover.toLocaleString()}/${live.toLocaleString()} (${(withCover/live*100).toFixed(1)}%)`)
  console.log(`Reversible: ${path.basename(logPath)}`)
  await prisma.$disconnect()
}
main().catch(e => { console.error('ERR', e); process.exit(1) }).finally(() => prisma.$disconnect())
