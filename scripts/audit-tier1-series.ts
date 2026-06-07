/**
 * audit-tier1-series — Phase 1 audit for the four Tier 1 series candidates.
 *
 * For each series, reports:
 *   - Expected volumes (from ComicVine)
 *   - DB volumes found (by volume_number)
 *   - Missing volumes
 *   - Misfiled products (wrong format, wrong series_name, no CV id)
 *   - Unnumbered products (volume_number IS NULL)
 *   - CV coverage %
 *   - Cover coverage %
 *   - Vol.1 pricing (cheapest in-stock listing)
 *   - Retailer count
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/audit-tier1-series.ts
 *   npx tsx --env-file=.env.local scripts/audit-tier1-series.ts --skip-cv   (no CV API calls)
 */

import { PrismaClient } from '@prisma/client'

const prisma   = new PrismaClient()
const SKIP_CV  = process.argv.includes('--skip-cv')
const CV_BASE  = 'https://comicvine.gamespot.com/api'
const CV_KEY   = process.env.COMIC_VINE_API_KEY

// ── Series definitions ────────────────────────────────────────────────────────

interface SeriesDef {
  name:         string   // canonical display name
  searchTerms:  string[] // DB ILIKE patterns for series_name / title
  cvSearch:     string   // term to send to CV /search
  formatHints:  string[] // expected ProductFormat values
  publisher:    string
}

const SERIES: SeriesDef[] = [
  {
    name:        'Witch Hat Atelier',
    searchTerms: ['Witch Hat Atelier', 'Witch Hat'],
    cvSearch:    'Witch Hat Atelier',
    formatHints: ['MANGA_VOLUME'],
    publisher:   'Kodansha',
  },
  {
    name:        'Laid-Back Camp',
    searchTerms: ['Laid-Back Camp', 'Yuru Camp'],
    cvSearch:    'Laid-Back Camp',
    formatHints: ['MANGA_VOLUME'],
    publisher:   'Yen Press',
  },
  {
    name:        'Trigun Maximum Deluxe',
    searchTerms: ['Trigun Maximum Deluxe', 'Trigun Deluxe'],
    cvSearch:    'Trigun Maximum Deluxe Edition',
    formatHints: ['MANGA_VOLUME', 'DELUXE'],
    publisher:   'Dark Horse Comics',
  },
  {
    name:        'Ouran High School Host Club',
    searchTerms: ['Ouran High School Host Club', 'Ouran Host Club'],
    cvSearch:    'Ouran High School Host Club',
    formatHints: ['MANGA_VOLUME'],
    publisher:   'Viz Media',
  },
]

// ── CV API ────────────────────────────────────────────────────────────────────

interface CVVolume {
  id:             number
  name:           string
  start_year:     string | null
  count_of_issues: number
  publisher:      { name: string } | null
}

async function cvSearch(term: string): Promise<CVVolume[]> {
  if (SKIP_CV || !CV_KEY) return []
  try {
    const url = `${CV_BASE}/search/?resources=volume&query=${encodeURIComponent(term)}&limit=5&format=json&api_key=${CV_KEY}&field_list=id,name,start_year,count_of_issues,publisher`
    const res = await fetch(url, {
      signal:  AbortSignal.timeout(20_000),
      headers: { 'User-Agent': 'CatchComics/1.0 (+https://catchcomics.com) tier1-audit' },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = await res.json() as { status_code: number; results: CVVolume[] }
    if (json.status_code !== 1) throw new Error(`CV error ${json.status_code}`)
    return json.results ?? []
  } catch (e) {
    console.warn(`  [cv] Search failed for "${term}": ${e}`)
    return []
  }
}

// ── DB queries ────────────────────────────────────────────────────────────────

interface DBProduct {
  id:              string
  title:           string
  isbn_13:         string | null
  format:          string
  series_name:     string | null
  volume_number:   number | null
  comicvine_id:    string | null
  cover_image_url: string | null
  publisher:       string | null
  deleted_at:      Date | null
  listing_count:   bigint
  min_price:       string | null
  retailer_count:  bigint
}

async function queryProducts(terms: string[]): Promise<DBProduct[]> {
  // Build OR conditions for each search term (series_name OR title prefix)
  const conditions = terms.map(t =>
    `(cp.series_name ILIKE '%${t.replace(/'/g, "''")}%' OR cp.title ILIKE '${t.replace(/'/g, "''")}%')`
  ).join(' OR ')

  return prisma.$queryRawUnsafe<DBProduct[]>(`
    SELECT
      cp.id,
      cp.title,
      cp.isbn_13,
      cp.format::text,
      cp.series_name,
      cp.volume_number,
      cp.comicvine_id,
      cp.cover_image_url,
      cp.publisher,
      cp.deleted_at,
      COUNT(DISTINCT rl.id)                                           AS listing_count,
      MIN(CASE WHEN rl.stock_status IN ('IN_STOCK','LOW_STOCK','PREORDER')
               THEN rl.price_amount END)::text                       AS min_price,
      COUNT(DISTINCT CASE WHEN rl.stock_status IN ('IN_STOCK','LOW_STOCK','PREORDER')
                          THEN rl.retailer_id END)                   AS retailer_count
    FROM canonical_products cp
    LEFT JOIN retailer_listings rl
      ON rl.canonical_product_id = cp.id AND rl.deleted_at IS NULL
    WHERE (${conditions})
    GROUP BY cp.id
    ORDER BY cp.volume_number ASC NULLS LAST, cp.title
  `)
}

// ── Analysis helpers ──────────────────────────────────────────────────────────

function classify(
  liveCollected:  DBProduct[],
  expectedVols:   number,
  cvBestId:       string | null,
): 'GREEN' | 'AMBER' | 'RED' {
  if (liveCollected.length === 0) return 'RED'

  const numberedLive = liveCollected.filter(p => p.volume_number !== null)
  const withCV       = liveCollected.filter(p => p.comicvine_id === cvBestId && cvBestId)
  const withCover    = liveCollected.filter(p => p.cover_image_url)
  const withPricing  = liveCollected.filter(p => Number(p.listing_count) > 0)
  const unnumbered   = liveCollected.filter(p => p.volume_number === null)

  const covPct   = expectedVols > 0 ? numberedLive.length / expectedVols : 0
  const hasPrices = withPricing.length > 0
  const hasVol1   = liveCollected.some(p => p.volume_number === 1)

  // RED conditions
  if (liveCollected.length === 0)                   return 'RED'
  if (!hasPrices)                                   return 'RED'
  if (!hasVol1 && unnumbered.length === 0)          return 'RED'
  if (covPct < 0.4 && expectedVols > 0)             return 'RED'

  // AMBER conditions
  const hasMisfiled   = liveCollected.some(p => !p.comicvine_id || p.comicvine_id !== cvBestId)
  const hasMisNumbrd  = unnumbered.length > 0
  const missingCount  = expectedVols > 0 ? Math.max(0, expectedVols - numberedLive.length) : 0
  const missingMajor  = missingCount > Math.ceil(expectedVols * 0.25)

  if (hasMisfiled || hasMisNumbrd || missingMajor)  return 'AMBER'

  return 'GREEN'
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function auditSeries(s: SeriesDef) {
  console.log(`\n${'═'.repeat(64)}`)
  console.log(`  ${s.name.toUpperCase()}`)
  console.log('═'.repeat(64))

  // ── DB query ────────────────────────────────────────────────────────────────
  const allProducts = await queryProducts(s.searchTerms)
  const live        = allProducts.filter(p => !p.deleted_at)
  const deleted     = allProducts.filter(p =>  p.deleted_at)
  const liveCollect = live.filter(p => p.format !== 'SINGLE_ISSUE')
  const liveIssues  = live.filter(p => p.format === 'SINGLE_ISSUE')

  console.log(`\n  DB overview:`)
  console.log(`    Live products:         ${live.length} (${liveCollect.length} collected, ${liveIssues.length} single-issue)`)
  console.log(`    Soft-deleted:          ${deleted.length}`)

  if (liveCollect.length === 0) {
    console.log(`  ✗ No collected-edition products found.`)
    console.log(`\n  CLASSIFICATION: RED — no products in DB`)
    return { name: s.name, rating: 'RED' as const, cvBestId: null, products: [], note: 'No products in DB' }
  }

  // ── Volume number breakdown ─────────────────────────────────────────────────
  const numbered   = liveCollect.filter(p => p.volume_number !== null)
  const unnumbered = liveCollect.filter(p => p.volume_number === null)
  const volNums    = numbered.map(p => p.volume_number as number).sort((a,b) => a-b)

  console.log(`\n  Volume breakdown (collected editions):`)
  console.log(`    Numbered volumes:      ${numbered.length} → [${volNums.join(', ')}]`)
  if (unnumbered.length > 0) {
    console.log(`    Unnumbered products:   ${unnumbered.length}`)
    unnumbered.forEach(p => console.log(`      • "${p.title}" isbn=${p.isbn_13 ?? 'NULL'} cv=${p.comicvine_id ?? 'NULL'}`))
  }

  // ── CV IDs in DB ────────────────────────────────────────────────────────────
  const cvIdCounts = new Map<string, number>()
  for (const p of liveCollect) {
    if (p.comicvine_id) {
      cvIdCounts.set(p.comicvine_id, (cvIdCounts.get(p.comicvine_id) ?? 0) + 1)
    }
  }
  const withCV    = liveCollect.filter(p => p.comicvine_id)
  const cvBestDb  = cvIdCounts.size > 0
    ? [...cvIdCounts.entries()].sort((a,b) => b[1]-a[1])[0][0]
    : null
  console.log(`\n  CV coverage:`)
  console.log(`    With comicvine_id:     ${withCV.length}/${liveCollect.length}`)
  if (cvBestDb) console.log(`    Most common CV id:     ${cvBestDb} (×${cvIdCounts.get(cvBestDb)})`)
  if (cvIdCounts.size > 1) {
    console.log(`    ⚠ Multiple CV ids found:`)
    cvIdCounts.forEach((cnt, id) => console.log(`      cv:${id} → ${cnt} products`))
  }

  // ── Cover coverage ──────────────────────────────────────────────────────────
  const withCover = liveCollect.filter(p => p.cover_image_url)
  console.log(`\n  Cover coverage:        ${withCover.length}/${liveCollect.length}`)

  // ── Pricing / retailer coverage ─────────────────────────────────────────────
  const vol1      = liveCollect.find(p => p.volume_number === 1)
  const withPrice = liveCollect.filter(p => Number(p.listing_count) > 0)
  console.log(`\n  Pricing:`)
  console.log(`    Products with listings: ${withPrice.length}/${liveCollect.length}`)
  if (vol1) {
    const v1Price = vol1.min_price ? `£${parseFloat(vol1.min_price).toFixed(2)}` : 'no live price'
    const v1Rtl   = Number(vol1.retailer_count)
    console.log(`    Vol.1 cheapest:        ${v1Price} (${v1Rtl} retailer${v1Rtl !== 1 ? 's' : ''})`)
  } else {
    console.log(`    Vol.1:                 NOT FOUND in DB`)
  }

  // ── ComicVine search ─────────────────────────────────────────────────────────
  let cvBestId      = cvBestDb
  let expectedVols  = 0
  if (!SKIP_CV && CV_KEY) {
    console.log(`\n  ComicVine search for "${s.cvSearch}"…`)
    const cvResults = await cvSearch(s.cvSearch)
    if (cvResults.length > 0) {
      // Score: prefer results whose name contains all query words, then highest issue count
      const qWords = s.cvSearch.toLowerCase().split(/\s+/).filter(w => w.length > 2)
      const scored = cvResults.map(v => ({
        v,
        wordMatch: qWords.filter(w => v.name.toLowerCase().includes(w)).length,
      })).sort((a,b) => b.wordMatch - a.wordMatch || b.v.count_of_issues - a.v.count_of_issues)

      const best = scored[0].v
      expectedVols = best.count_of_issues
      cvBestId     = cvBestId ?? String(best.id)  // prefer DB-seen id if already there

      console.log(`    Best match:  "${best.name}" id=${best.id} pub=${best.publisher?.name ?? '?'} issues=${best.count_of_issues}`)
      if (scored.length > 1) {
        console.log(`    Other hits:  ${scored.slice(1).map(x => `"${x.v.name}" id=${x.v.id}`).join(', ')}`)
      }
      // If DB cv id differs from CV best, flag it
      if (cvBestDb && cvBestDb !== String(best.id)) {
        console.log(`    ⚠ DB uses cv:${cvBestDb} but CV search suggests cv:${best.id}`)
      }
    } else {
      console.log(`    No CV results — using DB cv id if present`)
    }
  }

  // ── Gap analysis ────────────────────────────────────────────────────────────
  if (expectedVols > 0 && volNums.length > 0) {
    const maxVol  = Math.max(...volNums, expectedVols)
    const missing = Array.from({length: maxVol}, (_, i) => i + 1).filter(n => !volNums.includes(n))
    if (missing.length > 0) {
      console.log(`\n  Missing volumes (vs expected 1–${expectedVols}): [${missing.slice(0,20).join(', ')}${missing.length > 20 ? '…' : ''}]`)
    } else {
      console.log(`\n  ✓ All expected volumes present (1–${expectedVols})`)
    }
  }

  // ── Format breakdown ────────────────────────────────────────────────────────
  const fmtCounts = new Map<string, number>()
  for (const p of liveCollect) fmtCounts.set(p.format, (fmtCounts.get(p.format) ?? 0) + 1)
  if (fmtCounts.size > 1 || !fmtCounts.has(s.formatHints[0])) {
    console.log(`\n  Format breakdown:`)
    fmtCounts.forEach((cnt, fmt) => {
      const ok = s.formatHints.includes(fmt)
      console.log(`    ${ok ? '✓' : '⚠'} ${fmt}: ${cnt}`)
    })
  }

  // ── Misfiled detection ──────────────────────────────────────────────────────
  const misfiled = liveCollect.filter(p => {
    const wrongFormat = !s.formatHints.includes(p.format)
    const wrongCV     = cvBestId && p.comicvine_id && p.comicvine_id !== cvBestId
    return wrongFormat || wrongCV
  })
  if (misfiled.length > 0) {
    console.log(`\n  Misfiled products (${misfiled.length}):`)
    misfiled.slice(0, 5).forEach(p =>
      console.log(`    "${p.title}" format=${p.format} cv=${p.comicvine_id ?? 'NULL'}`)
    )
  }

  // ── Slug sample (for registry building) ────────────────────────────────────
  console.log(`\n  Sample product slugs (for registry cross-check):`)
  liveCollect.slice(0, 3).forEach(async p => {
    const slug = await prisma.$queryRaw<Array<{slug: string}>>`
      SELECT canonical_slug AS slug FROM canonical_products WHERE id = ${p.id}::uuid
    `
    console.log(`    Vol.${p.volume_number ?? '?'}: /product/${slug[0]?.slug ?? '?'}`)
  })

  // ── Classification ──────────────────────────────────────────────────────────
  const rating = classify(liveCollect, expectedVols, cvBestId)
  let note     = ''
  if (rating === 'RED')   note = 'Needs investigation before any build'
  if (rating === 'AMBER') note = 'Data repairs needed before build'
  if (rating === 'GREEN') note = 'Ready to build'

  console.log(`\n  ┌─ CLASSIFICATION: ${rating} — ${note}`)
  console.log(`  │  CV volume id:  ${cvBestId ?? 'UNKNOWN'}`)
  console.log(`  │  Expected vols: ${expectedVols || '?'}`)
  console.log(`  │  Found vols:    ${numbered.length}`)
  console.log(`  │  Unnumbered:    ${unnumbered.length}`)
  console.log(`  │  With CV:       ${withCV.length}/${liveCollect.length}`)
  console.log(`  └─ With covers:   ${withCover.length}/${liveCollect.length}`)

  return { name: s.name, rating, cvBestId, expectedVols, products: liveCollect, unnumbered, note }
}

async function main() {
  console.log('\nTier 1 Series Audit')
  console.log(new Date().toISOString())
  if (SKIP_CV) console.log('(CV API calls disabled)')

  const results = []
  for (const s of SERIES) {
    const r = await auditSeries(s)
    results.push(r)
    // Polite delay between CV API calls
    if (!SKIP_CV && CV_KEY) await new Promise(r => setTimeout(r, 2000))
  }

  console.log('\n\n' + '═'.repeat(64))
  console.log('  SUMMARY TABLE')
  console.log('═'.repeat(64))
  console.log('  Series                         Rating  CV id     Found  Expected')
  console.log('  ' + '─'.repeat(62))
  for (const r of results) {
    const pad = (s: string, n: number) => s.slice(0,n).padEnd(n)
    console.log(`  ${pad(r.name, 30)} ${r.rating.padEnd(7)} ${(r.cvBestId ?? 'UNKNOWN').padEnd(9)} ${String('found' in r ? (r as {found?: number}).found ?? r.products?.length ?? 0 : 0).padEnd(6)} ${r.expectedVols ?? '?'}`)
  }

  console.log('\n  GREEN:', results.filter(r => r.rating === 'GREEN').map(r => r.name).join(', ') || 'none')
  console.log('  AMBER:', results.filter(r => r.rating === 'AMBER').map(r => r.name).join(', ') || 'none')
  console.log('  RED:  ', results.filter(r => r.rating === 'RED').map(r => r.name).join(', ') || 'none')
}

main()
  .catch(e => { console.error('\nAudit failed:', e); process.exit(1) })
  .finally(() => prisma.$disconnect())
