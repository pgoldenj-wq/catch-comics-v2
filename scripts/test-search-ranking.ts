/** Unit test for the search ranking scorer (project tsx-script convention).
 *  Pure-function assertions: exact > phrase > fuzzy, Vol-1 preference, off-type
 *  edition demotion, article-insensitive matching, fuzzy-honesty floor.
 *    npx tsx scripts/test-search-ranking.ts   (npm run test:search-ranking)
 */
import { applyScores, titleMatchSignal, STRONG_MATCH_FLOOR } from '../lib/search/score'
import type { CanonicalSearchResult } from '../lib/search/types'

let pass = 0, fail = 0
function ok(name: string, cond: boolean) { if (cond) pass++; else { fail++; console.log(`  ✗ ${name}`) } }

// Minimal CanonicalSearchResult factory
let n = 0
function mk(title: string, o: Partial<CanonicalSearchResult> = {}): CanonicalSearchResult {
  return {
    type: 'canonical', id: `id${n++}`, title, seriesName: o.seriesName ?? null,
    publisher: o.publisher ?? 'Image Comics', format: o.format ?? 'TPB',
    isbn13: null, coverImageUrl: 'https://images.catchcomics.com/x.webp', canonicalSlug: `s${n}`,
    volumeNumber: o.volumeNumber ?? null, releaseDate: o.releaseDate ?? '2020-01-01',
    offers: o.offers ?? [], totalOffers: o.totalOffers ?? 0, score: o.score ?? 0.05,
  }
}
const top = (q: string, rs: CanonicalSearchResult[]) => applyScores(rs, q)[0].title

// 1. Exact/phrase beats fuzzy: "dark knight returns"
ok('exact phrase beats fuzzy partial', top('dark knight returns', [
  mk('Dark Knights of Steel: The Deluxe Edition', { releaseDate: '2024-01-01', volumeNumber: 1, totalOffers: 8 }),
  mk('Batman: The Dark Knight Returns DC Compact Comics Edition', { releaseDate: '2016-01-01' }),
]) === 'Batman: The Dark Knight Returns DC Compact Comics Edition')

// 2. Vol-1 preference for a bare series query, even when later vols are newer/priced
ok('vol 1 beats vol 110', top('one piece', [
  mk('One Piece Volume 110', { seriesName: 'One Piece', volumeNumber: 110, releaseDate: '2026-01-01', totalOffers: 12 }),
  mk('One Piece Volume 1',   { seriesName: 'One Piece', volumeNumber: 1,   releaseDate: '2010-01-01', totalOffers: 3 }),
]) === 'One Piece Volume 1')

// 3. Off-type edition demoted below mainline manga
ok('colouring book demoted below vol 1', top('witch hat atelier', [
  mk('Witch Hat Atelier Colouring Book', { seriesName: 'Witch Hat Atelier', releaseDate: '2024-01-01', totalOffers: 10 }),
  mk('Witch Hat Atelier Volume 1',       { seriesName: 'Witch Hat Atelier', volumeNumber: 1 }),
]) === 'Witch Hat Atelier Volume 1')

// 4. Art-of/guide demoted
ok('art-of demoted below vol 1', top('berserk', [
  mk('The Art of Berserk', { seriesName: 'Berserk', releaseDate: '2025-01-01' }),
  mk('Berserk, Vol. 1',    { seriesName: 'Berserk', volumeNumber: 1 }),
]) === 'Berserk, Vol. 1')

// 5. Explicit off-type query is NOT penalised (user asked for it)
ok('explicit colouring-book query keeps it on top', top('witch hat atelier colouring book', [
  mk('Witch Hat Atelier Colouring Book', { seriesName: 'Witch Hat Atelier' }),
  mk('Witch Hat Atelier Volume 1',       { seriesName: 'Witch Hat Atelier', volumeNumber: 1 }),
]) === 'Witch Hat Atelier Colouring Book')

// 6. Lowest volume wins among same series
ok('vol 1 beats vol 5 and vol 12', top('saga', [
  mk('Saga Volume 5',  { seriesName: 'Saga', volumeNumber: 5,  releaseDate: '2022-01-01' }),
  mk('Saga Volume 12', { seriesName: 'Saga', volumeNumber: 12, releaseDate: '2026-01-01', totalOffers: 9 }),
  mk('Saga Volume 1',  { seriesName: 'Saga', volumeNumber: 1,  releaseDate: '2012-01-01' }),
]) === 'Saga Volume 1')

// 7. titleMatchSignal — exact/prefix/phrase/article/none
ok('exact core match = 1.0', titleMatchSignal('saga', mk('Saga Volume 1', { seriesName: 'Saga' })) === 1.0)
ok('article-insensitive (sandman ~ The Sandman)', titleMatchSignal('sandman', mk('The Sandman Volume 1', { seriesName: 'The Sandman' })) >= 0.9)
ok('phrase match >= 0.75', titleMatchSignal('dark knight returns', mk('Batman: The Dark Knight Returns')) >= 0.75)
ok('weak: maus vs Di Di Mau below floor', titleMatchSignal('maus', mk('Di Di Mau')) < STRONG_MATCH_FLOOR)
ok('weak: blade vs Blood Blade below floor (token-partial)', titleMatchSignal('blade', mk('Blood Blade Volume 2')) < STRONG_MATCH_FLOOR)
ok('strong: exact one-word series at/above floor', titleMatchSignal('watchmen', mk('Watchmen: DC Compact Comics Edition')) >= STRONG_MATCH_FLOOR)

console.log(`\n${fail === 0 ? '✓ ALL PASS' : '✗ FAILURES'}  (${pass} passed, ${fail} failed)`)
process.exit(fail === 0 ? 0 : 1)
