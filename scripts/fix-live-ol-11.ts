/** Phase 2 tail: the 11 surviving *live* OL covers. To apply the OL-as-bad
 *  safeguard with zero regression, R2-ify each (download the working OL image →
 *  R2 via the guarded pipeline). Any that fail validation are nulled. After this,
 *  no bare-OL URL remains in cover_image_url. Reversible logged.
 *
 *   npx dotenv -e .env.local -- tsx scripts/fix-live-ol-11.ts --execute
 */
import fs from 'fs'
import path from 'path'
import { prisma } from '../lib/prisma'
import { downloadAndStoreCover } from '../lib/images/download'

const EXECUTE = process.argv.includes('--execute')
const log: { id: string; title: string; oldCover: string | null; action: string; newCover: string | null }[] = []

async function main() {
  const ol = await prisma.canonicalProduct.findMany({
    where: { deletedAt: null, coverImageUrl: { contains: 'openlibrary.org' } },
    select: { id: true, title: true, coverImageUrl: true },
  })
  console.log(`Live OL covers: ${ol.length}  [${EXECUTE ? 'EXECUTE' : 'DRY'}]`)
  let r2 = 0, nulled = 0
  for (const p of ol) {
    if (!p.coverImageUrl) continue
    if (!EXECUTE) { console.log(`  • ${p.title.slice(0, 44)}`); continue }
    const stored = await downloadAndStoreCover(p.id, p.coverImageUrl)
    if (stored) { log.push({ id: p.id, title: p.title, oldCover: p.coverImageUrl, action: 'r2ify', newCover: stored }); r2++; console.log(`  ✓ R2   ${p.title.slice(0, 44)}`) }
    else {
      await prisma.canonicalProduct.update({ where: { id: p.id }, data: { coverImageUrl: null, updatedAt: new Date() } })
      log.push({ id: p.id, title: p.title, oldCover: p.coverImageUrl, action: 'null', newCover: null }); nulled++; console.log(`  ○ null ${p.title.slice(0, 44)} (OL image failed validation)`)
    }
  }
  if (EXECUTE) {
    console.log(`\nR2-ified ${r2}, nulled ${nulled}`)
    if (log.length) { const lp = path.join(__dirname, `.cover-live-ol-11-log-${Date.now()}.json`); fs.writeFileSync(lp, JSON.stringify(log, null, 2)); console.log(`log: ${path.basename(lp)}`) }
  }
  await prisma.$disconnect()
}
main().catch(e => { console.error('ERR', e); process.exit(1) }).finally(() => prisma.$disconnect())
