/**
 * One-shot: identify the mystery "Saga" product with ISBN 9781534323346.
 * Checks DB details + listing count, then fetches Open Library metadata.
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  // ── DB details ─────────────────────────────────────────────────────────────
  const rows = await prisma.$queryRaw<Array<{
    id: string
    title: string
    isbn_13: string | null
    format: string
    series_name: string | null
    volume_number: number | null
    publisher: string | null
    description: string | null
    cover_image_url: string | null
    created_at: Date
    listing_count: bigint
    listing_titles: string | null
  }>>`
    SELECT
      cp.id, cp.title, cp.isbn_13, cp.format::text, cp.series_name,
      cp.volume_number, cp.publisher, cp.description,
      cp.cover_image_url, cp.created_at,
      COUNT(rl.id)                                       AS listing_count,
      STRING_AGG(DISTINCT rl.title, ' | ') AS listing_titles
    FROM canonical_products cp
    LEFT JOIN retailer_listings rl
      ON rl.canonical_product_id = cp.id AND rl.deleted_at IS NULL
    WHERE cp.isbn_13 = '9781534323346'
    GROUP BY cp.id
  `

  console.log('\n=== Mystery product — DB record ===')
  if (rows.length === 0) {
    console.log('  Not found in DB')
  } else {
    for (const r of rows) {
      console.log(`  id:              ${r.id}`)
      console.log(`  title:           ${r.title}`)
      console.log(`  isbn_13:         ${r.isbn_13 ?? 'NULL'}`)
      console.log(`  format:          ${r.format}`)
      console.log(`  series_name:     ${r.series_name ?? 'NULL'}`)
      console.log(`  volume_number:   ${r.volume_number ?? 'NULL'}`)
      console.log(`  publisher:       ${r.publisher ?? 'NULL'}`)
      console.log(`  cover_image_url: ${r.cover_image_url ?? 'NULL'}`)
      console.log(`  created_at:      ${r.created_at.toISOString()}`)
      console.log(`  listing_count:   ${r.listing_count}`)
      if (r.listing_titles) {
        console.log(`  listing_titles:  ${r.listing_titles}`)
      }
      if (r.description) {
        console.log(`  description[0:200]: ${r.description.slice(0, 200)}`)
      }
    }
  }

  // ── Open Library lookup ────────────────────────────────────────────────────
  console.log('\n=== Open Library metadata for ISBN 9781534323346 ===')
  try {
    const res = await fetch(
      'https://openlibrary.org/api/books?bibkeys=ISBN:9781534323346&format=json&jscmd=data',
      { signal: AbortSignal.timeout(10_000) }
    )
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = await res.json() as Record<string, unknown>
    const entry = json['ISBN:9781534323346'] as Record<string, unknown> | undefined
    if (!entry) {
      console.log('  No Open Library record found for this ISBN.')
    } else {
      console.log(`  title:      ${entry.title ?? 'N/A'}`)
      console.log(`  subtitle:   ${(entry as Record<string, unknown>).subtitle ?? 'N/A'}`)
      const authors = (entry.authors as Array<{name: string}> | undefined)?.map(a => a.name).join(', ')
      console.log(`  authors:    ${authors ?? 'N/A'}`)
      const pubs = (entry.publishers as Array<{name: string}> | undefined)?.map(p => p.name).join(', ')
      console.log(`  publishers: ${pubs ?? 'N/A'}`)
      console.log(`  publish_date: ${(entry as Record<string, unknown>).publish_date ?? 'N/A'}`)
      console.log(`  number_of_pages: ${(entry as Record<string, unknown>).number_of_pages ?? 'N/A'}`)
      const subjects = (entry.subjects as Array<{name: string}> | undefined)?.slice(0, 5).map(s => s.name).join(', ')
      console.log(`  subjects:   ${subjects ?? 'N/A'}`)
    }
  } catch (e) {
    console.log(`  OL fetch error: ${e}`)
  }

  // ── Google Books lookup ────────────────────────────────────────────────────
  console.log('\n=== Google Books metadata for ISBN 9781534323346 ===')
  try {
    const res = await fetch(
      'https://www.googleapis.com/books/v1/volumes?q=isbn:9781534323346',
      { signal: AbortSignal.timeout(10_000) }
    )
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = await res.json() as { totalItems: number; items?: Array<{ volumeInfo: Record<string, unknown> }> }
    if (!json.totalItems || !json.items?.length) {
      console.log('  No Google Books record found.')
    } else {
      const vi = json.items[0].volumeInfo
      console.log(`  title:        ${vi.title ?? 'N/A'}`)
      console.log(`  subtitle:     ${vi.subtitle ?? 'N/A'}`)
      const authors = (vi.authors as string[] | undefined)?.join(', ')
      console.log(`  authors:      ${authors ?? 'N/A'}`)
      console.log(`  publisher:    ${vi.publisher ?? 'N/A'}`)
      console.log(`  publishedDate:${vi.publishedDate ?? 'N/A'}`)
      console.log(`  pageCount:    ${vi.pageCount ?? 'N/A'}`)
      console.log(`  description:  ${String(vi.description ?? '').slice(0, 250)}`)
    }
  } catch (e) {
    console.log(`  GB fetch error: ${e}`)
  }
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
