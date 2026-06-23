/**
 * fix-placeholder-covers.ts — null cover_image_url for products whose R2 file is
 * a known stored placeholder graphic (detected by cover-r2-fullscan.ts).
 *
 * Reversible: writes id→old_url log; the R2 objects are NOT deleted. After this,
 * affected products render the designed "no cover" fallback instead of an
 * "image not available" graphic, and drop out of cover-required surfaces.
 *
 * Safety: before mutating, re-hashes a random sample of candidates and aborts
 * unless every sampled file matches a known placeholder hash.
 *
 *   npx dotenv -e .env.local -- tsx scripts/fix-placeholder-covers.ts            # dry-run
 *   npx dotenv -e .env.local -- tsx scripts/fix-placeholder-covers.ts --execute  # apply
 */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { prisma } from '../lib/prisma'

const EXECUTE = process.argv.includes('--execute')
const KNOWN = new Set(['06661fd690879985', '2cafc2b0f16dfe03', '307a2fbbc46139a8', 'b3165c10e262603d'])

async function hash16(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) })
    if (!r.ok) return null
    const buf = Buffer.from(await r.arrayBuffer())
    return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16)
  } catch { return null }
}

async function main() {
  const jsonPath = path.join(__dirname, '.cover-placeholder-ids.json')
  const { ids } = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as { ids: string[] }
  console.log(`Candidate placeholder products: ${ids.length.toLocaleString()}  [${EXECUTE ? 'EXECUTE' : 'DRY RUN'}]`)

  // Pull current rows (only those still pointing at R2, not already null)
  const rows = await prisma.canonicalProduct.findMany({
    where: { id: { in: ids }, coverImageUrl: { not: null } },
    select: { id: true, coverImageUrl: true },
  })
  console.log(`Still-live candidates with a cover: ${rows.length.toLocaleString()}`)

  // ── Safety: re-hash a random sample; every one must be a known placeholder ──
  const sample = [...rows].sort(() => Math.random() - 0.5).slice(0, 40)
  let confirmed = 0, mismatch = 0
  for (const r of sample) {
    const h = await hash16(r.coverImageUrl!)
    if (h && KNOWN.has(h)) confirmed++
    else { mismatch++; console.log(`  ⚠ sample NOT a known placeholder: ${h} ${r.coverImageUrl}`) }
  }
  console.log(`Safety re-hash: ${confirmed}/${sample.length} confirmed placeholders, ${mismatch} mismatches`)
  if (mismatch > 0) { console.log('ABORT — sample contained non-placeholder files. Investigate before nulling.'); return }

  if (!EXECUTE) {
    console.log('\nDRY RUN — would null cover_image_url for the above. Pass --execute to apply.')
    return
  }

  // ── Reversible log ──
  const logPath = path.join(__dirname, `.cover-placeholder-null-log-${Date.now()}.json`)
  fs.writeFileSync(logPath, JSON.stringify(rows.map(r => ({ id: r.id, oldUrl: r.coverImageUrl })), null, 2))
  console.log(`Wrote reversible log (${rows.length}) → ${logPath}`)

  // ── Null in chunks ──
  let nulled = 0
  const idList = rows.map(r => r.id)
  for (let i = 0; i < idList.length; i += 1000) {
    const chunk = idList.slice(i, i + 1000)
    const res = await prisma.canonicalProduct.updateMany({
      where: { id: { in: chunk }, coverImageUrl: { not: null } },
      data: { coverImageUrl: null, updatedAt: new Date() },
    })
    nulled += res.count
  }
  console.log(`✅ Nulled ${nulled.toLocaleString()} placeholder covers.`)

  const live = await prisma.canonicalProduct.count({ where: { deletedAt: null } })
  const withCover = await prisma.canonicalProduct.count({ where: { deletedAt: null, coverImageUrl: { not: null } } })
  console.log(`Cover coverage now: ${withCover.toLocaleString()}/${live.toLocaleString()} (${((withCover / live) * 100).toFixed(1)}%) — honest real-cover number`)
  console.log(`Reverse with: set cover_image_url = oldUrl for ids in ${path.basename(logPath)}`)
}
main().catch(e => { console.error('ERR', e); process.exit(1) }).finally(() => prisma.$disconnect())
