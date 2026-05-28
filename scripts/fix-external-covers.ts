/**
 * fix-external-covers.ts
 *
 * Targeted one-shot script to migrate the remaining external (non-OL) covers:
 *   - 1  ComicVine URL  → direct download
 *   - 280 Bookshop.org → try OL by ISBN first (no 403 risk), fall back to direct
 *
 * Run: npm run fix:ext-covers
 */

import { prisma }                from '../lib/prisma'
import { downloadAndStoreCover } from '../lib/images/download'

const WRITE = process.argv.includes('--write')
const DELAY_MS = 1200   // 1.2s between requests

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}

/** Extract ISBN-13 from a bookshop.org image URL */
function extractIsbn(url: string): string | null {
  const m = url.match(/\/(\d{13})\.jpg/)
  return m ? m[1] : null
}

/** Try Open Library cover by ISBN-13. Returns URL if image exists, null otherwise. */
async function tryOlCover(isbn: string): Promise<string | null> {
  const olUrl = `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`
  try {
    const res = await fetch(olUrl, { signal: AbortSignal.timeout(8_000) })
    if (res.ok && (res.headers.get('content-type') ?? '').startsWith('image/')) {
      return olUrl
    }
  } catch {}
  return null
}

async function main() {
  // Fetch all non-R2, non-OL, non-Google external covers
  const products = await prisma.$queryRaw<
    Array<{ id: string; title: string; cover_image_url: string }>
  >`
    SELECT id, title, cover_image_url
    FROM canonical_products
    WHERE cover_image_url IS NOT NULL
      AND cover_image_url NOT LIKE '%r2.dev%'
      AND cover_image_url NOT LIKE '%cloudflarestorage%'
      AND cover_image_url NOT LIKE '%openlibrary%'
      AND cover_image_url NOT LIKE '%books.google%'
      AND deleted_at IS NULL
    ORDER BY updated_at DESC
  `

  console.log(`\nTargeting ${products.length} external covers (CV + Bookshop.org)`)
  console.log(`Mode: ${WRITE ? 'WRITE' : 'DRY RUN'}\n`)

  let success = 0, failed = 0, skippedDry = 0

  for (const p of products) {
    const url = p.cover_image_url
    const isBookshop = url.includes('bookshop.org')
    const isCv       = url.includes('comicvine')

    let sourceToUse: string | null = url

    // For bookshop.org: try OL first (avoids 403)
    if (isBookshop) {
      const isbn = extractIsbn(url)
      if (isbn) {
        const olUrl = await tryOlCover(isbn)
        if (olUrl) {
          sourceToUse = olUrl
          console.log(`  ✓ OL cover found for ISBN ${isbn}: ${p.title.slice(0, 50)}`)
        } else {
          // Fall back to direct bookshop.org download
          sourceToUse = url
        }
      }
    }

    if (!WRITE) {
      skippedDry++
      console.log(`  [dry] ${isCv ? 'CV' : 'Bookshop'} → ${p.title.slice(0, 60)}`)
      await sleep(DELAY_MS)
      continue
    }

    const r2Url = await downloadAndStoreCover(p.id, sourceToUse!)
    if (r2Url) {
      success++
      console.log(`  ✓ ${p.title.slice(0, 60)}`)
    } else {
      failed++
      console.log(`  ✗ ${p.title.slice(0, 60)}`)
    }
    await sleep(DELAY_MS)
  }

  console.log(`\n── Result ───────────────────────────────────`)
  if (WRITE) {
    console.log(`  Success : ${success}`)
    console.log(`  Failed  : ${failed}`)
  } else {
    console.log(`  Would process : ${skippedDry} (run with --write)`)
  }
  await prisma.$disconnect()
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
