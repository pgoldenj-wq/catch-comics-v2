/** Assertion test for lib/images/url-filters (project convention: tsx test script).
 *  Covers the P2-3 safeguard: bare Open Library hotlinks are treated as bad so
 *  they never render directly (OL serves a 1×1 dead GIF when it lacks the cover,
 *  indistinguishable at the URL level) — fallbacks (live-CV hero / letter) engage.
 *
 *   npx tsx scripts/test-url-filters.ts
 */
import { isBadCoverUrl, adjustImgSrc } from '../lib/images/url-filters'

let pass = 0, fail = 0
function eq(name: string, got: unknown, want: unknown) {
  if (got === want) { pass++; }
  else { fail++; console.log(`  ✗ ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`) }
}

// ── P2-3 safeguard: bare OL URLs are bad ──
eq('OL bare -L.jpg is bad',        isBadCoverUrl('https://covers.openlibrary.org/b/isbn/9781302958282-L.jpg'), true)
eq('OL with ?default=false is bad', isBadCoverUrl('https://covers.openlibrary.org/b/isbn/123-L.jpg?default=false'), true)
eq('OL http (any case) is bad',     isBadCoverUrl('HTTP://Covers.OpenLibrary.org/b/id/55-L.jpg'), true)

// ── Existing behaviour must be preserved ──
eq('R2 cover is good',              isBadCoverUrl('https://images.catchcomics.com/covers/abc.webp'), false)
eq('Shopify retailer image good',   isBadCoverUrl('https://cdn.shopify.com/s/files/1/0282/x._SL1500.jpg'), false)
eq('CV scaled cover good',          isBadCoverUrl('https://comicvine.gamespot.com/a/uploads/scale_large/12/121/img.jpg'), false)
eq('CV system placeholder bad',     isBadCoverUrl('https://comicvine.gamespot.com/a/uploads/original/0/12345/x.jpg'), true)
eq('Google Books bad',             isBadCoverUrl('https://books.google.com/books/content?id=x'), true)
eq('no_image marker bad',          isBadCoverUrl('https://x/no_image.jpg'), true)
eq('null is bad',                  isBadCoverUrl(null), true)

// ── adjustImgSrc still appends ?default=false to OL (defence in depth) ──
eq('adjustImgSrc appends default=false', adjustImgSrc('https://covers.openlibrary.org/b/isbn/1-L.jpg'), 'https://covers.openlibrary.org/b/isbn/1-L.jpg?default=false')
eq('adjustImgSrc leaves R2 untouched',   adjustImgSrc('https://images.catchcomics.com/covers/a.webp'), 'https://images.catchcomics.com/covers/a.webp')

console.log(`\n${fail === 0 ? '✓ ALL PASS' : '✗ FAILURES'}  (${pass} passed, ${fail} failed)`)
process.exit(fail === 0 ? 0 : 1)
