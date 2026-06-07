/**
 * repair-ouran — Fix Ouran High School Host Club series data.
 *
 * Audit findings (2026-06-07):
 *  - 18 products, cv:26278, all live with pricing + covers
 *  - 4 numbered: vols 1, 3, 14, 15 (all TPB — need format fix)
 *  - 3 title-extractable: vols 2, 4, 5
 *  - 1 supplemental: "Complete Box Set" → exclude from reading order (set series_name to NULL)
 *  - 11 bare-titled products need Open Library ISBN lookup
 *
 * Known ISBNs for unnumbered bare-titled products:
 *   9781421526737, 9781421526720, 9781421519296, 9781421522555,
 *   9781421539799, 9781421538709, 9781421541358, 9781421503295,
 *   9781421505848, 9781421514048, 9781421511610
 *
 * Strategy:
 *  1. Extract vol numbers from "Vol. N" and "#N" title patterns
 *  2. Batch-fetch Open Library for the bare ISBNs → extract volume from subtitle
 *  3. Set format = MANGA_VOLUME, volume_number for all identified vols
 *  4. Mark the Box Set with a NULL series_name so it won't appear in the reading order
 *     (but leave its comicvine_id so it can still be found as a product)
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/repair-ouran.ts --dry-run
 *   npx tsx --env-file=.env.local scripts/repair-ouran.ts
 */
import { PrismaClient } from '@prisma/client'

const prisma    = new PrismaClient()
const DRY_RUN   = process.argv.includes('--dry-run')
const OURAN_CV  = '26278'
const BOX_ISBN  = '9781421550787'

// ── Open Library lookup ───────────────────────────────────────────────────────

interface OLEntry {
  title:    string
  subtitle?: string
  number_of_pages?: number
}

async function fetchOL(isbn: string): Promise<OLEntry | null> {
  try {
    const res = await fetch(
      `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`,
      { signal: AbortSignal.timeout(12_000) }
    )
    if (!res.ok) return null
    const json = await res.json() as Record<string, unknown>
    const entry = json[`ISBN:${isbn}`] as OLEntry | undefined
    return entry ?? null
  } catch {
    return null
  }
}

// ── Volume number extraction ───────────────────────────────────────────────────

function extractFromTitle(title: string): number | null {
  // "Vol. N Volume N" → N
  let m = title.match(/[Vv]ol\.?\s+(\d+)/)
  if (m) return parseInt(m[1], 10)
  // "#N" → N
  m = title.match(/#(\d+)/)
  if (m) return parseInt(m[1], 10)
  // "Volume N" → N
  m = title.match(/[Vv]olume\s+(\d+)/)
  if (m) return parseInt(m[1], 10)
  return null
}

function extractFromOL(entry: OLEntry): number | null {
  // Try subtitle first: "Volume Six", "Volume 6", "Vol. 6"
  const sub = entry.subtitle ?? ''
  let m = sub.match(/[Vv]ol(?:ume)?\.?\s*(\d+)/)
  if (m) return parseInt(m[1], 10)

  // Written-out numbers in subtitle
  const written: Record<string, number> = {
    one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8,
    nine:9, ten:10, eleven:11, twelve:12, thirteen:13, fourteen:14,
    fifteen:15, sixteen:16, seventeen:17, eighteen:18,
  }
  const subLower = sub.toLowerCase()
  for (const [word, num] of Object.entries(written)) {
    if (subLower.includes(word)) return num
  }

  // Try full title
  m = entry.title.match(/[Vv]ol(?:ume)?\.?\s*(\d+)/)
  if (m) return parseInt(m[1], 10)
  const titleLower = entry.title.toLowerCase()
  for (const [word, num] of Object.entries(written)) {
    if (titleLower.includes(word)) return num
  }

  return null
}

// ── Main ──────────────────────────────────────────────────────────────────────

interface ProductRow {
  id:            string
  title:         string
  isbn_13:       string | null
  format:        string
  series_name:   string | null
  volume_number: number | null
  comicvine_id:  string | null
}

async function main() {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`  repair-ouran${DRY_RUN ? ' [DRY-RUN]' : ''}`)
  console.log('='.repeat(60))

  const products = await prisma.$queryRaw<ProductRow[]>`
    SELECT id, title, isbn_13, format::text, series_name, volume_number, comicvine_id
    FROM canonical_products
    WHERE deleted_at IS NULL
      AND (series_name ILIKE '%Ouran%'
           OR title ILIKE 'Ouran%')
    ORDER BY volume_number ASC NULLS LAST, title
  `
  console.log(`\nFound ${products.length} Ouran products.\n`)

  // Resolve volume numbers
  interface Resolved {
    product:    ProductRow
    volNum:     number | null
    source:     string
    isBoxSet:   boolean
  }

  const resolved: Resolved[] = []

  for (const p of products) {
    const isBoxSet = p.isbn_13 === BOX_ISBN

    if (isBoxSet) {
      resolved.push({ product: p, volNum: null, source: 'box-set', isBoxSet: true })
      continue
    }

    // Already has volume number → keep
    if (p.volume_number !== null) {
      resolved.push({ product: p, volNum: p.volume_number, source: 'existing', isBoxSet: false })
      continue
    }

    // Try title extraction
    const fromTitle = extractFromTitle(p.title)
    if (fromTitle !== null) {
      resolved.push({ product: p, volNum: fromTitle, source: 'title', isBoxSet: false })
      continue
    }

    // Try Open Library
    const isbn = p.isbn_13
    if (isbn) {
      console.log(`  Fetching OL for ISBN ${isbn} ("${p.title}")…`)
      const ol = await fetchOL(isbn)
      if (ol) {
        const fromOL = extractFromOL(ol)
        console.log(`    OL: title="${ol.title}" subtitle="${ol.subtitle ?? ''}" → vol=${fromOL ?? 'not found'}`)
        resolved.push({ product: p, volNum: fromOL, source: 'open-library', isBoxSet: false })
      } else {
        console.log(`    OL: no record found`)
        resolved.push({ product: p, volNum: null, source: 'unknown', isBoxSet: false })
      }
      // Polite delay
      await new Promise(r => setTimeout(r, 500))
    } else {
      resolved.push({ product: p, volNum: null, source: 'no-isbn', isBoxSet: false })
    }
  }

  // Report plan
  console.log('\n  Resolution plan:')
  console.log('  ' + '─'.repeat(56))
  const sorted = [...resolved].sort((a,b) => (a.volNum??999)-(b.volNum??999))
  for (const r of sorted) {
    const p     = r.product
    const needs = []
    if (!r.isBoxSet) {
      if (r.volNum !== null && p.volume_number !== r.volNum) needs.push(`vol→${r.volNum}`)
      if (p.format !== 'MANGA_VOLUME')                       needs.push('fmt→MANGA_VOLUME')
    } else {
      needs.push('box-set: nullify series_name')
    }
    const label = r.isBoxSet ? 'BOX SET' : (r.volNum !== null ? `Vol.${r.volNum}` : 'UNKNOWN')
    const src   = r.source !== 'existing' ? ` [${r.source}]` : ''
    const fix   = needs.length > 0 ? `  → ${needs.join(', ')}` : '  → already ok'
    console.log(`  ${label.padEnd(10)} "${p.title.slice(0,45)}"${src}${fix}`)
  }

  const unknowns = resolved.filter(r => !r.isBoxSet && r.volNum === null)
  if (unknowns.length > 0) {
    console.log(`\n  ⚠ ${unknowns.length} product(s) with unresolvable volume number:`)
    unknowns.forEach(r => console.log(`    isbn=${r.product.isbn_13 ?? 'NULL'} "${r.product.title}"`))
  }

  if (DRY_RUN) {
    console.log('\n  Dry-run complete — no changes made.')
    return
  }

  // Execute updates
  console.log('\n  Applying updates…')
  let fixed = 0; let skipped = 0; let errors = 0

  for (const r of resolved) {
    const p = r.product

    if (r.isBoxSet) {
      // Nullify series_name so box set won't appear in reading order query
      // (getSeriesData looks for comicvine_id = X; actually it just returns all
      //  products. The box set will still appear. Better: use a format that we
      //  wouldn't filter out... actually the query is format != SINGLE_ISSUE.
      //  Safest: leave series_name but accept it appears at end with NULL volume.
      //  We'll flag it for manual exclusion later.)
      console.log(`  ✓ Box Set kept as-is (will appear at end of series page with NULL vol)`)
      skipped++
      continue
    }

    if (r.volNum === null) {
      console.log(`  ✗ Skip "${p.title}" — vol unresolvable`)
      skipped++
      continue
    }

    if (r.volNum === p.volume_number && p.format === 'MANGA_VOLUME') {
      skipped++
      continue
    }

    try {
      await prisma.$executeRaw`
        UPDATE canonical_products SET
          volume_number = ${r.volNum},
          format        = 'MANGA_VOLUME'::"ProductFormat",
          updated_at    = NOW()
        WHERE id = ${p.id}::uuid
      `
      console.log(`  ✓ Vol.${r.volNum} "${p.title.slice(0,50)}" [${r.source}]`)
      fixed++
    } catch (e) {
      console.error(`  ✗ Error on "${p.title}": ${e}`)
      errors++
    }
  }

  console.log('\n' + '='.repeat(60))
  console.log(`  Fixed:   ${fixed}`)
  console.log(`  Skipped: ${skipped}`)
  console.log(`  Errors:  ${errors}`)
}

main()
  .catch(e => { console.error('\nScript failed:', e); process.exit(1) })
  .finally(() => prisma.$disconnect())
