#!/usr/bin/env tsx
/**
 * repair-flagship-vol1.ts — CC-019 (flagship Vol-1 gaps, 2026-07-03)
 *
 * Two failure modes found in diagnosis:
 *   1. JJK Vol 1 is absent entirely (never in any retailer feed).
 *   2. One Piece Vol 1 exists but is metadata-poor (seriesName/volumeNumber
 *      NULL, format OTHER) so ranking and the volume suggester pass it over.
 *
 * Repairs both honestly — every written field comes from Google Books /
 * Open Library metadata verified against the expected series name, or is
 * left untouched. No fake data: if enrichment can't verify an ISBN, the
 * target is skipped with a warning.
 *
 * Usage:
 *   npx dotenv -e .env.local -- tsx scripts/repair-flagship-vol1.ts             dry-run
 *   npx dotenv -e .env.local -- tsx scripts/repair-flagship-vol1.ts --execute   write
 *
 * Also prints the Vol-1 gap audit: title cohorts holding volume 2+ but no
 * volume 1 (report only — feeds the ingestion backlog).
 */

import { prisma }                           from '../lib/prisma'
import { enrichByIsbn }                     from '../lib/enrichment/isbn'
import { downloadAndStoreCoverWithFallback } from '../lib/images/download'
import { isBadCoverUrl }                    from '../lib/images/url-filters'

const EXECUTE = process.argv.includes('--execute')

interface Target {
  isbn13:     string
  series:     string   // sanity gate: enriched title must contain this
  volume:     number
  format:     'MANGA_VOLUME'
}

const TARGETS: Target[] = [
  { isbn13: '9781974710027', series: 'Jujutsu Kaisen', volume: 1, format: 'MANGA_VOLUME' },
  { isbn13: '9781569319017', series: 'One Piece',      volume: 1, format: 'MANGA_VOLUME' },
]

function makeSlug(title: string, isbn13: string): string {
  return title.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-')
    .slice(0, 80) + '-' + isbn13
}

async function repairTarget(t: Target) {
  console.log(`\n── ${t.series} Vol ${t.volume} (${t.isbn13}) ──`)

  // 1. Verified external metadata — the trust gate.
  const meta = await enrichByIsbn(t.isbn13)
  if (meta.source === 'none' || !meta.title) {
    console.log(`  ✗ SKIPPED — no GB/OL metadata for this ISBN; refusing to write unverified data`)
    return
  }
  if (!meta.title.toLowerCase().includes(t.series.toLowerCase())) {
    console.log(`  ✗ SKIPPED — enriched title "${meta.title}" does not contain "${t.series}"; ISBN may be wrong`)
    return
  }
  console.log(`  verified via ${meta.source}: "${meta.title}"`)

  const existing = await prisma.canonicalProduct.findFirst({
    where: { isbn13: t.isbn13 },
    select: { id: true, title: true, deletedAt: true, seriesName: true, volumeNumber: true, format: true, publisher: true, description: true, coverImageUrl: true },
  })

  if (!EXECUTE) {
    console.log(existing
      ? `  DRY RUN — would update ${existing.id} (fill seriesName/volumeNumber/format${existing.deletedAt ? ', undelete' : ''})`
      : `  DRY RUN — would create canonical "${meta.title}"`)
    return
  }

  let id: string
  if (existing) {
    // Fill-only update: never overwrite non-null values with enrichment.
    await prisma.canonicalProduct.update({
      where: { id: existing.id },
      data: {
        deletedAt:    null,
        seriesName:   existing.seriesName   ?? t.series,
        volumeNumber: existing.volumeNumber ?? t.volume,
        format:       existing.format === 'OTHER' ? t.format : existing.format,
        publisher:    existing.publisher    ?? meta.publisher,
        description:  (existing.description && existing.description.length > 20)
                        ? existing.description : (meta.description ?? existing.description),
      },
    })
    id = existing.id
    console.log(`  ✓ updated ${id}`)
  } else {
    const created = await prisma.canonicalProduct.create({
      data: {
        isbn13:        t.isbn13,
        title:         meta.title,
        canonicalSlug: makeSlug(meta.title, t.isbn13),
        seriesName:    t.series,
        volumeNumber:  t.volume,
        format:        t.format,
        publisher:     meta.publisher,
        description:   meta.description,
        releaseDate:   meta.releaseDate,
        coverImageUrl: null,   // set below via validated R2 download only
      },
      select: { id: true },
    })
    id = created.id
    console.log(`  ✓ created ${id}`)
  }

  // 2. Cover — only via the validated R2 pipeline (sharp ≥50×50, WebP).
  const row = await prisma.canonicalProduct.findUnique({ where: { id }, select: { coverImageUrl: true } })
  if (!row?.coverImageUrl || isBadCoverUrl(row.coverImageUrl)) {
    const r2 = await downloadAndStoreCoverWithFallback(id, { isbn13: t.isbn13 })
    if (r2) {
      await prisma.canonicalProduct.update({ where: { id }, data: { coverImageUrl: r2 } })
      console.log(`  ✓ cover stored → ${r2}`)
    } else {
      console.log(`  – no valid cover found (OL/GB); leaving NULL — honest fallback renders`)
    }
  } else {
    console.log(`  – cover already present, untouched`)
  }
}

async function vol1GapAudit() {
  // Cohorts by title prefix before the volume token, holding vol 2+ but no
  // vol 1. Approximate by design — report only.
  const rows = await prisma.$queryRaw<{ series: string; vols: number; minvol: number }[]>`
    WITH parsed AS (
      SELECT
        trim(regexp_replace(substring(title from '^(.*?)[,:]?\\s*vol(?:ume)?\\.?\\s*\\d'), '[,:]$', '')) AS series,
        (regexp_match(title, 'vol(?:ume)?\\.?\\s*0*(\\d+)', 'i'))[1]::int AS vol
      FROM canonical_products
      WHERE deleted_at IS NULL AND title ~* 'vol(?:ume)?\\.?\\s*\\d' AND format::text <> 'SINGLE_ISSUE'
    )
    SELECT series, COUNT(DISTINCT vol)::int AS vols, MIN(vol)::int AS minvol
    FROM parsed
    WHERE series IS NOT NULL AND length(series) BETWEEN 3 AND 60
    GROUP BY series
    HAVING COUNT(DISTINCT vol) >= 3 AND MIN(vol) > 1
    ORDER BY COUNT(DISTINCT vol) DESC
    LIMIT 25`
  console.log(`\n── Vol-1 gap audit: cohorts with 3+ volumes but no Vol 1 (top 25) ──`)
  for (const r of rows) console.log(`  ${String(r.vols).padStart(3)} vols, starts at v${r.minvol}  ${r.series}`)
  console.log(`  (${rows.length} cohorts shown — ingestion backlog input, report only)`)
}

async function main() {
  for (const t of TARGETS) await repairTarget(t)
  await vol1GapAudit()
  if (!EXECUTE) console.log('\nDRY RUN — re-run with --execute to write.')
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
