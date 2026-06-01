import { PrismaClient } from '@prisma/client'
const p = new PrismaClient()

async function main() {
  const series = ['The Walking Dead', 'Fullmetal Alchemist', 'Invincible', 'Claymore', 'Overlord']
  for (const s of series) {
    const rows = await p.$queryRaw<Array<{
      series_name: string; format: string; cnt: bigint;
      cv_cnt: bigint; vn_cnt: bigint; modal_cv_id: string | null
    }>>`
      SELECT series_name, format::text, COUNT(*) cnt,
             COUNT(comicvine_id) cv_cnt,
             COUNT(volume_number) vn_cnt,
             MODE() WITHIN GROUP (ORDER BY comicvine_id) AS modal_cv_id
      FROM canonical_products
      WHERE LOWER(series_name) = LOWER(${s})
        AND deleted_at IS NULL
      GROUP BY series_name, format
      ORDER BY cnt DESC
    `
    console.log('\n' + s + ':')
    rows.forEach(r => console.log(`  ${r.series_name} [${r.format}] count:${r.cnt} cv:${r.cv_cnt} vn:${r.vn_cnt} modal_cv_id:${r.modal_cv_id}`))
    if (rows.length === 0) console.log('  (no results)')
  }
}

main().catch(console.error).finally(() => p.$disconnect())
