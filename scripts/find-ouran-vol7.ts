/**
 * find-ouran-vol7 — Search Google Books for Ouran High School Host Club Vol. 7 ISBN.
 */
const API_KEY = process.env.GOOGLE_BOOKS_API_KEY

async function search(q: string): Promise<void> {
  const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&key=${API_KEY}&maxResults=10`
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
  const json = await res.json() as { totalItems: number; items?: Array<{
    volumeInfo: {
      title?: string
      subtitle?: string
      publishedDate?: string
      publisher?: string
      industryIdentifiers?: Array<{ type: string; identifier: string }>
    }
  }> }

  console.log(`\nQuery: "${q}" → ${json.totalItems} total results`)
  if (!json.items) { console.log('  (no items)'); return }

  for (const item of json.items) {
    const vi = item.volumeInfo
    const isbn13 = (vi.industryIdentifiers ?? []).find(x => x.type === 'ISBN_13')?.identifier
    const isbn10 = (vi.industryIdentifiers ?? []).find(x => x.type === 'ISBN_10')?.identifier
    console.log(`  title:     ${vi.title}`)
    if (vi.subtitle) console.log(`  subtitle:  ${vi.subtitle}`)
    console.log(`  isbn-13:   ${isbn13 ?? 'none'}`)
    console.log(`  isbn-10:   ${isbn10 ?? 'none'}`)
    console.log(`  published: ${vi.publishedDate ?? '?'}  publisher: ${vi.publisher ?? '?'}`)
    console.log()
  }
}

async function main() {
  if (!API_KEY) { console.error('GOOGLE_BOOKS_API_KEY not set'); process.exit(1) }

  // Multiple search strategies
  await search('Ouran High School Host Club vol 7 Bisco Hatori')
  await new Promise(r => setTimeout(r, 400))
  await search('ouran host club volume 7 viz manga')
  await new Promise(r => setTimeout(r, 400))
  // Also check if vol 7's ISBN might already be in OL
  const olRes = await fetch(
    'https://openlibrary.org/search.json?q=ouran+high+school+host+club+vol+7&limit=5',
    { signal: AbortSignal.timeout(15_000) }
  )
  const olJson = await olRes.json() as { docs?: Array<{ title?: string; isbn?: string[]; first_publish_year?: number }> }
  console.log('\nOpen Library search for "ouran high school host club vol 7":')
  if (olJson.docs) {
    for (const doc of olJson.docs.slice(0, 5)) {
      console.log(`  "${doc.title}" isbns: ${(doc.isbn ?? []).join(', ')}`)
    }
  }
}

main().catch(e => { console.error(e); process.exit(1) })
