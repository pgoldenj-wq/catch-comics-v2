/**
 * investigate-saga-vols — one-shot diagnostic for missing Saga Vol.7 and Vol.10.
 *
 * Checks three things:
 *  1. Products with the target ISBNs (any format/series_name/comicvine_id)
 *  2. All non-SINGLE_ISSUE Saga products with comicvine_id='46568'
 *  3. Any Saga-titled TPB products regardless of comicvine_id
 *
 * Usage: npx tsx --env-file=.env.local scripts/investigate-saga-vols.ts
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const TARGET_ISBNS = ['9781632152701', '9781534300354']
const SAGA_CV_ID  = '46568'

async function main() {
  // ── 1. Direct ISBN lookup ──────────────────────────────────────────────────
  console.log('\n=== 1. Products with target ISBNs ===')
  const byIsbn = await prisma.$queryRaw<Array<{
    id: string; title: string; isbn_13: string | null; format: string;
    comicvine_id: string | null; series_name: string | null;
    volume_number: number | null; deleted_at: Date | null;
  }>>`
    SELECT id, title, isbn_13, format::text, comicvine_id, series_name, volume_number, deleted_at
    FROM canonical_products
    WHERE isbn_13 IN ('9781632152701', '9781534300354')
    ORDER BY isbn_13
  `
  if (byIsbn.length === 0) {
    console.log('  → No products found with these ISBNs.')
  } else {
    for (const r of byIsbn) {
      console.log(`\n  ISBN ${r.isbn_13}`)
      console.log(`    title:        ${r.title}`)
      console.log(`    format:       ${r.format}`)
      console.log(`    comicvine_id: ${r.comicvine_id ?? 'NULL'}`)
      console.log(`    series_name:  ${r.series_name ?? 'NULL'}`)
      console.log(`    volume_number:${r.volume_number ?? 'NULL'}`)
      console.log(`    deleted_at:   ${r.deleted_at ?? 'NULL (live)'}`)
    }
  }

  // ── 2. All non-SINGLE_ISSUE products with comicvine_id='46568' ────────────
  console.log('\n=== 2. Non-SINGLE_ISSUE products with comicvine_id=46568 ===')
  const byCV = await prisma.$queryRaw<Array<{
    id: string; title: string; isbn_13: string | null; format: string;
    volume_number: number | null; deleted_at: Date | null;
  }>>`
    SELECT id, title, isbn_13, format::text, volume_number, deleted_at
    FROM canonical_products
    WHERE comicvine_id = '46568'
      AND format != 'SINGLE_ISSUE'
    ORDER BY volume_number ASC NULLS LAST, title
  `
  if (byCV.length === 0) {
    console.log('  → No collected-edition products linked to CV volume 46568.')
  } else {
    console.log(`  → ${byCV.length} product(s) found:`)
    for (const r of byCV) {
      const status = r.deleted_at ? '[DELETED]' : '[LIVE]'
      console.log(`  ${status} Vol.${r.volume_number ?? '?'} | ${r.format} | ${r.title}`)
      console.log(`           ISBN: ${r.isbn_13 ?? 'NULL'} | id: ${r.id}`)
    }
    const liveNums = byCV.filter(r => !r.deleted_at).map(r => r.volume_number).sort((a,b) => (a??999)-(b??999))
    console.log(`\n  Live volume numbers: ${liveNums.join(', ')}`)
    const expected = [1,2,3,4,5,6,7,8,9,10,11]
    const missing  = expected.filter(n => !liveNums.includes(n))
    console.log(`  Missing from expected 1-11: ${missing.join(', ')}`)
  }

  // ── 3. Any Saga-titled collected-edition products (any comicvine_id) ───────
  console.log('\n=== 3. Saga-titled collected-edition products (any comicvine_id) ===')
  const bySeries = await prisma.$queryRaw<Array<{
    id: string; title: string; isbn_13: string | null; format: string;
    comicvine_id: string | null; series_name: string | null;
    volume_number: number | null; deleted_at: Date | null;
  }>>`
    SELECT id, title, isbn_13, format::text, comicvine_id, series_name, volume_number, deleted_at
    FROM canonical_products
    WHERE (series_name ILIKE 'saga' OR title ILIKE 'saga, vol%' OR title ILIKE 'saga vol%')
      AND format != 'SINGLE_ISSUE'
    ORDER BY volume_number ASC NULLS LAST, title
  `
  if (bySeries.length === 0) {
    console.log('  → No Saga-titled collected editions found.')
  } else {
    console.log(`  → ${bySeries.length} product(s) found:`)
    for (const r of bySeries) {
      const status = r.deleted_at ? '[DELETED]' : '[LIVE]'
      console.log(`  ${status} Vol.${r.volume_number ?? '?'} | ${r.format} | cv:${r.comicvine_id ?? 'NULL'}`)
      console.log(`    title:       ${r.title}`)
      console.log(`    series_name: ${r.series_name ?? 'NULL'}`)
      console.log(`    ISBN:        ${r.isbn_13 ?? 'NULL'} | id: ${r.id}`)
    }
  }
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
