#!/usr/bin/env tsx
/**
 * backfill-volume-creators.ts — CC-016 (creators data coverage, 2026-07-03)
 *
 * CV volume-level `people` carry NO roles (roles only exist on issue
 * person_credits), so the product-page creators block — which groups by
 * role — rendered nothing even for products with 100+ stored names.
 *
 * This backfill replaces role-less volume people with the ROLED credits of
 * the volume's first issue (cover_date asc): for a collected edition that's
 * the founding creative team — exactly what a collector expects to see.
 * One CV call per product. Products whose first issue has no credits are
 * left untouched (the UI's capped role-less fallback covers them).
 *
 * Priority order: products with the most live offers first.
 *
 * Usage:
 *   npx dotenv -e .env.local -- tsx scripts/backfill-volume-creators.ts                     dry-run, limit 40
 *   npx dotenv -e .env.local -- tsx scripts/backfill-volume-creators.ts --execute           write, limit 40
 *   npx dotenv -e .env.local -- tsx scripts/backfill-volume-creators.ts --execute --limit 100
 */

import { prisma } from '../lib/prisma'

const EXECUTE = process.argv.includes('--execute')
const limIdx  = process.argv.indexOf('--limit')
const LIMIT   = limIdx !== -1 ? parseInt(process.argv[limIdx + 1] ?? '40', 10) : 40
const cIdx    = process.argv.indexOf('--contains')
const CONTAINS = cIdx !== -1 ? (process.argv[cIdx + 1] ?? '') : ''   // targeted flagship runs
const RATE_MS = 3_000            // polite: shared CV quota with the enrichment task
const MAX_420_RETRIES = 3
const RETRY_BACKOFF_MS = 60_000

const CV_BASE = 'https://comicvine.gamespot.com/api'
const CV_KEY  = process.env.COMIC_VINE_API_KEY
if (!CV_KEY) { console.error('COMIC_VINE_API_KEY not set'); process.exit(1) }

async function cvFetch<T>(path: string): Promise<T | null> {
  const sep = path.includes('?') ? '&' : '?'
  const url = `${CV_BASE}${path}${sep}api_key=${CV_KEY}&format=json`
  for (let attempt = 0; attempt <= MAX_420_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        signal:  AbortSignal.timeout(30_000),
        headers: { 'User-Agent': 'CatchComics/1.0 creators-backfill' },
      })
      if (res.status === 420 || res.status === 429) {
        if (attempt < MAX_420_RETRIES) {
          console.warn(`  [cv] ${res.status} — backing off ${RETRY_BACKOFF_MS / 1000}s`)
          await new Promise(r => setTimeout(r, RETRY_BACKOFF_MS))
          continue
        }
        return null
      }
      if (!res.ok) { console.warn(`  [cv] ${res.status} for ${path.slice(0, 70)}`); return null }
      const json = await res.json()
      if (json.status_code && json.status_code !== 1) { console.warn(`  [cv] status_code=${json.status_code}`); return null }
      return json.results as T
    } catch (e) {
      console.warn(`  [cv] fetch error: ${e instanceof Error ? e.message : e}`)
      return null
    }
  }
  return null
}

interface CVIssueLite {
  id: number
  issue_number: string | null
  person_credits?: Array<{ id: number; name: string; role: string }>
}

async function main() {
  // Candidates: volume-format products whose creators are missing or role-less,
  // not yet backfilled, ordered by live-offer count (collector traffic proxy).
  const candidates = await prisma.$queryRaw<{ id: string; title: string; cv_id: string; offers: number }[]>`
    SELECT cp.id, cp.title, cp.comicvine_id AS cv_id,
           (SELECT COUNT(*)::int FROM retailer_listings l
             WHERE l.canonical_product_id = cp.id AND l.deleted_at IS NULL AND l.price_amount > 0) AS offers
    FROM canonical_products cp
    WHERE cp.deleted_at IS NULL
      AND cp.comicvine_id IS NOT NULL
      AND cp.format::text <> 'SINGLE_ISSUE'
      AND cp.cv_metadata IS NOT NULL
      AND cp.cv_metadata->>'creators_source' IS NULL
      -- Never touch products whose CV match is flagged wrong (classic volume
      -- matched to a modern title) — backfilling those displays wrong-era
      -- creators. Fix the match first, then clear the flag.
      AND cp.cv_metadata->>'cv_match_suspect' IS NULL
      AND (
        jsonb_array_length(coalesce(cp.cv_metadata->'creators','[]'::jsonb)) = 0
        OR NOT (cp.cv_metadata->'creators'->0 ? 'role')
      )
      AND (${CONTAINS} = '' OR cp.title ILIKE '%' || ${CONTAINS} || '%')
    ORDER BY 4 DESC
    LIMIT ${LIMIT}`

  console.log(`Candidates (limit ${LIMIT}): ${candidates.length}${EXECUTE ? '' : '  [DRY RUN]'}`)

  let written = 0, skipped = 0
  for (const c of candidates) {
    // Two calls per product: CV's /issues/ LIST endpoint silently omits
    // person_credits even when requested in field_list — the field only
    // exists on the issue DETAIL endpoint (verified 03 Jul against volume
    // 160294: list returns id+issue_number only, detail returns full credits).
    const issues = await cvFetch<CVIssueLite[]>(
      `/issues/?filter=volume:${c.cv_id}&sort=cover_date:asc&limit=1&field_list=id,issue_number`
    )
    const firstIssueId = issues?.[0]?.id
    let credits: CVIssueLite['person_credits'] = undefined
    if (firstIssueId) {
      await new Promise(r => setTimeout(r, RATE_MS))
      const detail = await cvFetch<CVIssueLite>(
        `/issue/4000-${firstIssueId}/?field_list=id,person_credits`
      )
      credits = detail?.person_credits
    }
    if (!credits || credits.length === 0) {
      console.log(`  – ${c.title.slice(0, 50)} — first issue has no credits, skipped`)
      skipped++
      await new Promise(r => setTimeout(r, RATE_MS))
      continue
    }

    const creators = credits.map(p => ({ id: p.id, name: p.name, role: p.role || 'creator' }))
    console.log(`  ${EXECUTE ? '✓' : '·'} ${c.title.slice(0, 50)} (${c.offers} offers) ← ${creators.length} roled credits (${creators.slice(0, 3).map(x => x.name).join(', ')}…)`)

    if (EXECUTE) {
      // Read-modify-write keeps every other cv_metadata key intact.
      const row = await prisma.canonicalProduct.findUnique({ where: { id: c.id }, select: { cvMetadata: true } })
      const meta = (row?.cvMetadata ?? {}) as Record<string, unknown>
      await prisma.canonicalProduct.update({
        where: { id: c.id },
        data: {
          cvMetadata: {
            ...meta,
            creators: creators,
            creators_source: 'issue_credits',
            creators_backfilled_at: new Date().toISOString(),
          },
        },
      })
      written++
    }
    await new Promise(r => setTimeout(r, RATE_MS))
  }

  console.log(`\n${EXECUTE ? `Written: ${written}` : `Would write: ${candidates.length - skipped}`} · skipped (no credits): ${skipped}`)
  if (!EXECUTE) console.log('Re-run with --execute to write.')
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
