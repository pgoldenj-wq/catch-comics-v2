/**
 * resolve-ouran-google-books — Try Google Books API to identify bare-titled Ouran volumes.
 *
 * The 10 unresolvable Ouran ISBNs (bare-titled "Ouran High School Host Club")
 * returned no volume number from Open Library. This script tries Google Books.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/resolve-ouran-google-books.ts --dry-run
 *   npx tsx --env-file=.env.local scripts/resolve-ouran-google-books.ts
 */
import { PrismaClient } from '@prisma/client'

const prisma   = new PrismaClient()
const DRY_RUN  = process.argv.includes('--dry-run')
const API_KEY  = process.env.GOOGLE_BOOKS_API_KEY
const OURAN_CV = '26278'

if (!API_KEY) {
  console.error('GOOGLE_BOOKS_API_KEY not set')
  process.exit(1)
}

// ── Google Books lookup ───────────────────────────────────────────────────────

interface GBVolumeInfo {
  title?: string
  subtitle?: string
  authors?: string[]
  publishedDate?: string
  pageCount?: number
  industryIdentifiers?: Array<{ type: string; identifier: string }>
}

interface GBItem {
  id: string
  volumeInfo: GBVolumeInfo
}

interface GBResponse {
  totalItems: number
  items?: GBItem[]
}

async function fetchGoogleBooks(isbn: string): Promise<GBItem | null> {
  try {
    const url = `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}&key=${API_KEY}`
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
    if (!res.ok) {
      console.log(`    GB: HTTP ${res.status}`)
      return null
    }
    const json = await res.json() as GBResponse
    if (!json.items || json.items.length === 0) return null
    return json.items[0]
  } catch (e) {
    console.log(`    GB: error — ${e}`)
    return null
  }
}

// ── Volume number extraction ───────────────────────────────────────────────────

const WRITTEN: Record<string, number> = {
  one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8,
  nine:9, ten:10, eleven:11, twelve:12, thirteen:13, fourteen:14,
  fifteen:15, sixteen:16, seventeen:17, eighteen:18,
}

function extractVolumeFromText(text: string): number | null {
  // "Vol. 6", "Vol 6", "Volume 6", "v. 6"
  let m = text.match(/[Vv]ol(?:ume)?\.?\s*(\d+)/)
  if (m) return parseInt(m[1], 10)
  // "#6"
  m = text.match(/#\s*(\d+)/)
  if (m) return parseInt(m[1], 10)
  // Written: "Volume Six", "Six"
  const lower = text.toLowerCase()
  for (const [word, num] of Object.entries(WRITTEN)) {
    // Check for word boundary to avoid "sixteen" matching "six"
    const regex = new RegExp(`\\b${word}\\b`)
    if (regex.test(lower)) return num
  }
  return null
}

function extractVolumeFromGB(item: GBItem): { volNum: number | null; fromField: string } {
  const vi = item.volumeInfo
  // Try subtitle first
  if (vi.subtitle) {
    const v = extractVolumeFromText(vi.subtitle)
    if (v !== null) return { volNum: v, fromField: `subtitle: "${vi.subtitle}"` }
  }
  // Try full title
  if (vi.title) {
    const v = extractVolumeFromText(vi.title)
    if (v !== null) return { volNum: v, fromField: `title: "${vi.title}"` }
  }
  return { volNum: null, fromField: 'no match' }
}

// ── Main ──────────────────────────────────────────────────────────────────────

interface ProductRow {
  id:            string
  title:         string
  isbn_13:       string | null
  format:        string
  volume_number: number | null
  comicvine_id:  string | null
}

async function main() {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`  resolve-ouran-google-books${DRY_RUN ? ' [DRY-RUN]' : ''}`)
  console.log('='.repeat(60))

  // Fetch all Ouran products with NULL volume_number (excluding box set)
  const unresolved = await prisma.$queryRaw<ProductRow[]>`
    SELECT id, title, isbn_13, format::text, volume_number, comicvine_id
    FROM canonical_products
    WHERE deleted_at IS NULL
      AND volume_number IS NULL
      AND isbn_13 != '9781421550787'
      AND (series_name ILIKE '%Ouran%' OR title ILIKE 'Ouran%')
    ORDER BY isbn_13
  `

  console.log(`\nFound ${unresolved.length} Ouran products with NULL volume_number.\n`)

  if (unresolved.length === 0) {
    console.log('  Nothing to resolve — all products have volume numbers.')
    return
  }

  // Look up each ISBN in Google Books
  const results: Array<{
    product: ProductRow
    volNum:  number | null
    fromField: string
    gbTitle: string
  }> = []

  for (const p of unresolved) {
    const isbn = p.isbn_13
    if (!isbn) {
      console.log(`  ✗ No ISBN for "${p.title}" — skip`)
      results.push({ product: p, volNum: null, fromField: 'no-isbn', gbTitle: '' })
      continue
    }

    console.log(`  ISBN ${isbn} ("${p.title.slice(0,40)}")…`)
    const item = await fetchGoogleBooks(isbn)
    if (!item) {
      console.log(`    GB: no result`)
      results.push({ product: p, volNum: null, fromField: 'not-found', gbTitle: '' })
    } else {
      const vi = item.volumeInfo
      const gbTitle = [vi.title, vi.subtitle].filter(Boolean).join(' — ')
      const { volNum, fromField } = extractVolumeFromGB(item)
      console.log(`    GB: title="${vi.title}" subtitle="${vi.subtitle ?? ''}"`)
      console.log(`    → ${volNum !== null ? `Vol.${volNum} (from ${fromField})` : 'no volume found'}`)
      results.push({ product: p, volNum, fromField, gbTitle })
    }

    // Polite rate limit
    await new Promise(r => setTimeout(r, 300))
  }

  // Summary
  const resolved   = results.filter(r => r.volNum !== null)
  const unresolvable = results.filter(r => r.volNum === null)

  console.log(`\n${'─'.repeat(60)}`)
  console.log(`  Resolution summary: ${resolved.length} resolved, ${unresolvable.length} still unknown`)
  console.log('─'.repeat(60))

  if (resolved.length > 0) {
    console.log('\n  WILL FIX:')
    for (const r of resolved.sort((a,b) => (a.volNum??0)-(b.volNum??0))) {
      console.log(`    Vol.${r.volNum} isbn=${r.product.isbn_13} [${r.fromField}]`)
    }
  }

  if (unresolvable.length > 0) {
    console.log('\n  STILL UNKNOWN:')
    for (const r of unresolvable) {
      console.log(`    isbn=${r.product.isbn_13 ?? 'NULL'} "${r.product.title}" [${r.fromField}]`)
    }
  }

  if (DRY_RUN) {
    console.log('\n  Dry-run complete — no changes made.')
    return
  }

  if (resolved.length === 0) {
    console.log('\n  Nothing to update.')
    return
  }

  // Check for duplicates — ensure no conflict with existing volume numbers
  const existingVols = await prisma.$queryRaw<Array<{ volume_number: number }>>`
    SELECT volume_number FROM canonical_products
    WHERE deleted_at IS NULL
      AND comicvine_id = ${OURAN_CV}
      AND volume_number IS NOT NULL
  `
  const existingSet = new Set(existingVols.map(r => r.volume_number))
  const conflicts = resolved.filter(r => existingSet.has(r.volNum!))
  if (conflicts.length > 0) {
    console.log('\n  ⚠ CONFLICTS (vol number already exists in DB):')
    conflicts.forEach(r => console.log(`    Vol.${r.volNum} isbn=${r.product.isbn_13} — SKIP`))
  }

  // Apply updates
  console.log('\n  Applying updates…')
  let fixed = 0; let skipped = 0; let errors = 0

  for (const r of resolved) {
    if (existingSet.has(r.volNum!)) {
      skipped++
      continue
    }
    try {
      await prisma.$executeRaw`
        UPDATE canonical_products SET
          volume_number = ${r.volNum},
          format        = 'MANGA_VOLUME'::"ProductFormat",
          comicvine_id  = COALESCE(comicvine_id, ${OURAN_CV}),
          series_name   = 'Ouran High School Host Club',
          updated_at    = NOW()
        WHERE id = ${r.product.id}::uuid
      `
      console.log(`  ✓ Vol.${r.volNum} isbn=${r.product.isbn_13}`)
      fixed++
    } catch (e) {
      console.error(`  ✗ Error: ${e}`)
      errors++
    }
  }

  console.log(`\n${'='.repeat(60)}`)
  console.log(`  Fixed: ${fixed}  Skipped: ${skipped}  Errors: ${errors}`)
  console.log(`  Still unknown: ${unresolvable.length}`)
}

main()
  .catch(e => { console.error('\nScript failed:', e); process.exit(1) })
  .finally(() => prisma.$disconnect())
