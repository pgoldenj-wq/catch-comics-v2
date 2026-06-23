/**
 * recover-launch-series.ts — recover missing covers for the launch series ONLY,
 * using ISBN → Open Library / Google Books (edition-specific = correct cover),
 * guard-protected (no placeholders, no wrong-volume art). Writes to R2 + DB on
 * genuine success; leaves a clean fallback where no real cover exists.
 *
 *   npx dotenv -e .env.local -- tsx scripts/recover-launch-series.ts            # dry-run
 *   npx dotenv -e .env.local -- tsx scripts/recover-launch-series.ts --execute
 */
import { prisma } from '../lib/prisma'
import { SERIES_REGISTRY } from '../lib/series/registry'
import { downloadAndStoreCoverWithFallback } from '../lib/images/download'

const EXECUTE = process.argv.includes('--execute')

async function main() {
  console.log(`Launch-series cover recovery (ISBN→OL/GB, edition-correct)  [${EXECUTE ? 'EXECUTE' : 'DRY RUN'}]\n`)
  let recovered = 0, stillMissing = 0, total = 0
  for (const [slug, entry] of Object.entries(SERIES_REGISTRY)) {
    const missing = await prisma.canonicalProduct.findMany({
      where: { comicvineId: entry.cvVolumeId, deletedAt: null, coverImageUrl: null },
      select: { id: true, title: true, isbn13: true },
    })
    if (missing.length === 0) continue
    console.log(`── ${slug} (${missing.length} missing) ──`)
    for (const p of missing) {
      total++
      if (!p.isbn13) { console.log(`   ✗ ${p.title.slice(0,44)} — no ISBN`); stillMissing++; continue }
      if (!EXECUTE) { console.log(`   • ${p.title.slice(0,44)} — would try ISBN ${p.isbn13}`); continue }
      const url = await downloadAndStoreCoverWithFallback(p.id, { isbn13: p.isbn13 })
      if (url) { console.log(`   ✓ ${p.title.slice(0,44)} → ${url.split('/').pop()}`); recovered++ }
      else { console.log(`   ✗ ${p.title.slice(0,44)} — no real cover on OL/GB (unrecoverable free)`); stillMissing++ }
    }
  }
  console.log(`\n  ${EXECUTE ? 'Recovered' : 'Candidates'}: ${EXECUTE ? recovered : total}  ·  still missing: ${stillMissing}/${total}`)
  await prisma.$disconnect()
}
main().catch(e => { console.error('ERR', e); process.exit(1) })
