/**
 * repair-tier2 — Fix all 4 Tier 2 series (Hellsing, Void Rivals, Sengoku Youko, Under Ninja)
 *
 * Audit findings (2026-06-08):
 *
 * HELLSING (cv:20494, Dark Horse)
 *   Vol 8: title="Hellsing" (bare), volume_number=NULL → fix to "Hellsing Volume 8 (Second Edition)" + vol=8
 *   Vols 1-7, 9-10: already correct TPB format + volume_number
 *   Deluxe vols (cv:NULL, format=OTHER): left as-is (won't appear on series page, different product line)
 *
 * VOID RIVALS (cv:151301, Image Comics)
 *   Vol 4 (isbn 9781534329539): format=OTHER, vol=NULL, cv=NULL → fix
 *   Vol 5 (isbn 9781534332515): format=OTHER, vol=NULL, cv=NULL → fix
 *   Deluxe Ed. Book 1 (format=DELUXE, cv=151301): vol=NULL → will appear at page end (acceptable)
 *
 * SENGOKU YOUKO (cv:149906, Tokyopop)
 *   Vol 3 (isbn 9781427874184): format=OTHER, vol=NULL, cv=NULL → fix to TPB + vol=3
 *   Vol 6 (isbn 9781427875358): format=OTHER, vol=NULL, cv=NULL → fix to TPB + vol=6
 *   Vol 5: MISSING from DB → research via Google Books + insert if found
 *
 * UNDER NINJA (cv:152175, DENPA)
 *   Vol 4 (isbn 9781634428637): format=OTHER, vol=NULL, cv=NULL → fix
 *   Vol 7 (isbn 9781634428873): format=OTHER, vol=NULL, cv=NULL → fix
 *   Vol 8 (isbn 9781634427111): format=OTHER, vol=NULL, cv=NULL → fix
 *   Vols 5 and 6: MISSING from DB → research via Google Books + insert if found
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/repair-tier2.ts --dry-run
 *   npx tsx --env-file=.env.local scripts/repair-tier2.ts
 */
import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'crypto'

const prisma   = new PrismaClient()
const DRY_RUN  = process.argv.includes('--dry-run')
const API_KEY  = process.env.GOOGLE_BOOKS_API_KEY

// ── Known repairs ──────────────────────────────────────────────────────────────

const REPAIRS = [
  // Hellsing
  { isbn: '9781506738574', title: 'Hellsing Volume 8 (Second Edition)', format: 'TPB', vol: 8, cvId: '20494', seriesName: 'Hellsing' },

  // Void Rivals
  { isbn: '9781534329539', title: 'Void Rivals Volume 4',               format: 'TPB', vol: 4, cvId: '151301', seriesName: 'Void Rivals' },
  { isbn: '9781534332515', title: 'Void Rivals Volume 5',               format: 'TPB', vol: 5, cvId: '151301', seriesName: 'Void Rivals' },

  // Sengoku Youko
  { isbn: '9781427874184', title: 'Sengoku Youko, Volume 3',            format: 'TPB', vol: 3, cvId: '149906', seriesName: 'Sengoku Youko' },
  { isbn: '9781427875358', title: 'Sengoku Youko, Volume 6',            format: 'TPB', vol: 6, cvId: '149906', seriesName: 'Sengoku Youko' },

  // Under Ninja
  { isbn: '9781634428637', title: 'Under Ninja, Volume 4',              format: 'TPB', vol: 4, cvId: '152175', seriesName: 'Under Ninja' },
  { isbn: '9781634428873', title: 'Under Ninja, Volume 7',              format: 'TPB', vol: 7, cvId: '152175', seriesName: 'Under Ninja' },
  { isbn: '9781634427111', title: 'Under Ninja, Volume 8',              format: 'TPB', vol: 8, cvId: '152175', seriesName: 'Under Ninja' },
] as const

// ── Missing volumes to research + insert ──────────────────────────────────────

const MISSING_TO_RESEARCH = [
  { seriesName: 'Sengoku Youko', vol: 5, cvId: '149906', slugPrefix: 'sengoku-youko-volume',
    publisher: 'Tokyopop', searchQuery: 'Sengoku Youko volume 5 Tokyopop manga' },
  { seriesName: 'Under Ninja',   vol: 5, cvId: '152175', slugPrefix: 'under-ninja-volume',
    publisher: 'DENPA',     searchQuery: 'Under Ninja volume 5 DENPA manga' },
  { seriesName: 'Under Ninja',   vol: 6, cvId: '152175', slugPrefix: 'under-ninja-volume',
    publisher: 'DENPA',     searchQuery: 'Under Ninja volume 6 DENPA manga' },
]

// ── Google Books lookup ─────────────────────────────────────────────────────────

interface GBResult { isbn13: string | null; title: string; subtitle: string; published: string; publisher: string }

async function searchGoogleBooks(query: string): Promise<GBResult | null> {
  if (!API_KEY) return null
  try {
    const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&key=${API_KEY}&maxResults=5`
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
    if (!res.ok) return null
    const json = await res.json() as { items?: Array<{ volumeInfo: {
      title?: string; subtitle?: string; publishedDate?: string; publisher?: string;
      industryIdentifiers?: Array<{ type: string; identifier: string }>
    }}>}
    if (!json.items?.length) return null
    // Find first result that has an ISBN-13 and looks like the right series
    for (const item of json.items) {
      const vi = item.volumeInfo
      const isbn13 = (vi.industryIdentifiers ?? []).find(x => x.type === 'ISBN_13')?.identifier ?? null
      if (isbn13) {
        return {
          isbn13,
          title:     vi.title ?? '',
          subtitle:  vi.subtitle ?? '',
          published: vi.publishedDate ?? '',
          publisher: vi.publisher ?? '',
        }
      }
    }
    return null
  } catch { return null }
}

// ── Main ────────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`  repair-tier2${DRY_RUN ? ' [DRY-RUN]' : ''}`)
  console.log('='.repeat(60))

  let updated = 0; let inserted = 0; let skipped = 0; let errors = 0

  // ── Part A: Apply known repairs ──────────────────────────────────────────
  console.log('\n  Part A — Known repairs:')

  for (const r of REPAIRS) {
    const product = await prisma.$queryRaw<Array<{ id: string; title: string; format: string; volume_number: number | null }>>`
      SELECT id, title, format::text, volume_number FROM canonical_products
      WHERE isbn_13 = ${r.isbn} AND deleted_at IS NULL
    `
    if (product.length === 0) {
      console.log(`  ⚠ isbn=${r.isbn} not found — skip`)
      skipped++
      continue
    }
    const p = product[0]
    const changes: string[] = []
    if (p.volume_number !== r.vol)    changes.push(`vol → ${r.vol}`)
    if (p.format !== r.format)        changes.push(`fmt → ${r.format}`)
    if (p.title !== r.title)          changes.push(`title fix`)

    if (changes.length === 0) {
      console.log(`  ✓ "${r.title}" — already ok`)
      skipped++
      continue
    }

    console.log(`  ${r.seriesName} Vol.${r.vol} isbn=${r.isbn} — ${changes.join(', ')}`)
    if (DRY_RUN) continue

    try {
      await prisma.$executeRaw`
        UPDATE canonical_products SET
          title         = ${r.title},
          volume_number = ${r.vol},
          format        = ${r.format}::"ProductFormat",
          comicvine_id  = COALESCE(comicvine_id, ${r.cvId}),
          series_name   = COALESCE(series_name, ${r.seriesName}),
          updated_at    = NOW()
        WHERE id = ${p.id}::uuid
      `
      updated++
    } catch (e) {
      console.error(`  ✗ Error: ${e}`)
      errors++
    }
  }

  // ── Part B: Research + insert missing volumes ────────────────────────────
  console.log('\n  Part B — Research missing volumes via Google Books:')

  for (const mv of MISSING_TO_RESEARCH) {
    const slug = `${mv.slugPrefix}-${mv.vol}`

    // Skip if already exists
    const existing = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM canonical_products
      WHERE canonical_slug = ${slug} AND deleted_at IS NULL
    `
    if (existing.length > 0) {
      console.log(`  ✓ ${mv.seriesName} Vol.${mv.vol} already exists — skip`)
      skipped++
      continue
    }

    console.log(`  Searching: "${mv.searchQuery}"`)
    const gb = await searchGoogleBooks(mv.searchQuery)

    if (!gb?.isbn13) {
      console.log(`  ✗ ${mv.seriesName} Vol.${mv.vol} — no ISBN found in Google Books`)
      skipped++
      await new Promise(r => setTimeout(r, 400))
      continue
    }

    // Verify ISBN not already in DB
    const isbnCheck = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM canonical_products WHERE isbn_13 = ${gb.isbn13} AND deleted_at IS NULL
    `
    if (isbnCheck.length > 0) {
      console.log(`  ⚠ ${mv.seriesName} Vol.${mv.vol} isbn=${gb.isbn13} already in DB — check manually`)
      skipped++
      continue
    }

    const titleStr = `${mv.seriesName}, Volume ${mv.vol}`
    console.log(`  → ISBN: ${gb.isbn13}  title: "${gb.title}"  pub: ${gb.published}  publisher: ${gb.publisher}`)
    console.log(`  → Will insert: "${titleStr}"`)

    if (DRY_RUN) { await new Promise(r => setTimeout(r, 400)); continue }

    const newId = randomUUID()
    try {
      await prisma.$executeRaw`
        INSERT INTO canonical_products (
          id, title, isbn_13, format, volume_number,
          comicvine_id, series_name, canonical_slug,
          cv_metadata, created_at, updated_at
        ) VALUES (
          ${newId}::uuid,
          ${titleStr},
          ${gb.isbn13},
          'TPB'::"ProductFormat",
          ${mv.vol},
          ${mv.cvId},
          ${mv.seriesName},
          ${slug},
          ${{ publisher: mv.publisher, publishedDate: gb.published, source: 'google-books' }}::jsonb,
          NOW(),
          NOW()
        )
        ON CONFLICT (canonical_slug) DO NOTHING
      `

      // Download cover
      console.log(`  → Fetching cover…`)
      try {
        const { downloadAndStoreCoverWithFallback } = await import('../lib/images/download')
        const coverUrl = await downloadAndStoreCoverWithFallback(newId, { isbn13: gb.isbn13 })
        console.log(`  ✓ Cover: ${coverUrl ? coverUrl.slice(0,60) : 'not found'}`)
      } catch (e) {
        console.log(`  ⚠ Cover download failed: ${e}`)
      }

      inserted++
    } catch (e) {
      console.error(`  ✗ INSERT failed: ${e}`)
      errors++
    }

    await new Promise(r => setTimeout(r, 400))
  }

  // ── Summary ─────────────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(60))
  console.log(`  Updated: ${updated}  Inserted: ${inserted}  Skipped: ${skipped}  Errors: ${errors}`)

  if (!DRY_RUN) {
    // Quick state check per series
    const checks = [
      { name: 'Hellsing',        cvId: '20494', expectedVols: [1,2,3,4,5,6,7,8,9,10] },
      { name: 'Void Rivals',     cvId: '151301', expectedVols: [1,2,3,4,5] },
      { name: 'Sengoku Youko',   cvId: '149906', expectedVols: [1,2,3,4,5,6] },
      { name: 'Under Ninja',     cvId: '152175', expectedVols: [1,2,3,4,5,6,7,8] },
    ]

    console.log('\n  Volume state after repair:')
    for (const c of checks) {
      const rows = await prisma.$queryRaw<Array<{ volume_number: number | null }>>`
        SELECT volume_number FROM canonical_products
        WHERE deleted_at IS NULL AND comicvine_id = ${c.cvId} AND format::text != 'SINGLE_ISSUE'
        ORDER BY volume_number ASC NULLS LAST
      `
      const vols    = rows.map(r => r.volume_number).filter(v => v !== null) as number[]
      const missing = c.expectedVols.filter(v => !vols.includes(v))
      const status  = missing.length === 0 ? '✅ READY' : `⚠ MISSING: [${missing.join(',')}]`
      console.log(`  ${c.name.padEnd(18)} vols=[${vols.join(',')}] ${status}`)
    }
  }
}

main()
  .catch(e => { console.error('\nScript failed:', e); process.exit(1) })
  .finally(() => prisma.$disconnect())
