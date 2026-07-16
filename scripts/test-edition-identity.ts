/**
 * test-edition-identity.ts — proves unsafe edition matches are REJECTED
 * (Wave 4 Phase 4 mandatory negative tests) and safe ones behave.
 *
 * Run: npm run test:identity   (pure functions — no DB, no network)
 */

import {
  normalizeIsbn13, isbn10To13, normalizeAnyIsbn,
  detectEditionSignals, editionMatchVerdict,
} from '../lib/identity/edition'
import { displayPublisher, isNonCreativePublisher } from '../lib/identity/publisher'
import { classifyCanonicalComicShape, isRefreshableComicCanonical } from '../lib/identity/comicShape'

let failures = 0
function check(label: string, ok: boolean, detail = '') {
  if (ok) console.log(`✓ ${label}`)
  else { failures++; console.error(`✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}

// ── ISBN normalisation ────────────────────────────────────────────────────────
check('valid ISBN-13 accepted', normalizeIsbn13('978-1-79950-751-2') === '9781799507512')
check('ISBN-13 bad checksum rejected', normalizeIsbn13('9781799507513') === null)
check('garbage rejected', normalizeIsbn13('notanisbn') === null)
check('valid ISBN-10 → 13 (X check digit)', isbn10To13('097522980X') === '9780975229804')
check('ISBN-10 bad checksum rejected', isbn10To13('0975229801') === null)
check('normalizeAnyIsbn handles both', normalizeAnyIsbn('1-4215-1021-9') === '9781421510217')

// ── Signal detection ──────────────────────────────────────────────────────────
const sigBox = detectEditionSignals('Saga Box Set Volumes 1-3')
check('box set detected', sigBox.boxSet === true)
const sigDig = detectEditionSignals('Watchmen (Kindle Edition)')
check('digital detected', sigDig.digital === true)
const sigIssue = detectEditionSignals('Absolute Batman #1 — The Zoo, Part One')
check('issue number detected (#1)', sigIssue.issueNumber === 1 && sigIssue.volumeNumber === null)
const sigVol = detectEditionSignals('Absolute Batman Vol. 1: The Zoo')
check('volume number detected (Vol. 1)', sigVol.volumeNumber === 1)

// ── MANDATORY NEGATIVES — every one of these must REJECT ─────────────────────
const rejects: Array<[string, Parameters<typeof editionMatchVerdict>]> = [
  ['same title, different ISBN', [
    { title: 'Saga Volume 1', isbn13: '9781607066019' },
    { title: 'Saga Volume 1', isbn13: '9781534313743' }]],
  ['hardcover vs paperback', [
    { title: 'Saga Book One', format: 'HARDCOVER' },
    { title: 'Saga Book One', format: 'TPB' }]],
  ['volume 1 vs issue 1', [
    { title: 'Absolute Batman Vol. 1' },
    { title: 'Absolute Batman #1' }]],
  ['box set vs individual volume', [
    { title: 'One Piece Box Set 1: Volumes 1-23' },
    { title: 'One Piece Volume 1' }]],
  ['digital vs physical', [
    { title: 'Watchmen Kindle Edition' },
    { title: 'Watchmen' }]],
  ['omnibus vs standard volume', [
    { title: 'Hellboy Omnibus Volume 1', format: 'OMNIBUS' },
    { title: 'Hellboy Volume 1', format: 'TPB' }]],
  ['different volume numbers', [
    { title: 'Naruto Vol. 2' },
    { title: 'Naruto Vol. 3' }]],
  ['weak title-only pair', [
    { title: 'Batman: The Long Halloween' },
    { title: 'Batman: The Long Halloween Special' }]],
]
for (const [label, [a, b]] of rejects) {
  const v = editionMatchVerdict(a, b)
  check(`REJECT: ${label}`, v.verdict === 'reject', `got ${v.verdict} (${v.reason})`)
}

// ── Positives and caps ────────────────────────────────────────────────────────
const isbnMatch = editionMatchVerdict(
  { title: 'Saga Volume 1', isbn13: '978-1-60706-601-9' },
  { title: 'Saga Vol. 1 (Image)', isbn10: '1607066017' })
check('same book via ISBN-13 and ISBN-10 → match', isbnMatch.verdict === 'match', isbnMatch.reason)

const noIsbn = editionMatchVerdict(
  { title: 'Saga Volume 3', format: 'TPB', publisher: 'Image Comics' },
  { title: 'Saga Volume 3', format: 'TPB', publisher: 'Image Comics' })
check('structured agreement WITHOUT ISBN caps at uncertain (never match)',
  noIsbn.verdict === 'uncertain', `got ${noIsbn.verdict}`)

// ── Publisher / distributor mapping (Phase 6) ────────────────────────────────
check('distributor omitted: Penguin Random House NZ', displayPublisher('Penguin Random House NZ') === null)
check('distributor omitted: Melia Publishing Services', displayPublisher('Melia Publishing Services Limited') === null)
check('retailer omitted: World of Books', displayPublisher('World of Books') === null)
check('real publisher kept: DC Comics', displayPublisher('DC Comics') === 'DC Comics')
check('real publisher kept: Image Comics', displayPublisher('Image Comics') === 'Image Comics')
check('blank → null', displayPublisher('   ') === null)
check('isNonCreativePublisher flags distributor', isNonCreativePublisher('Ingram Book Company') === true)
check('isNonCreativePublisher passes real publisher', isNonCreativePublisher('Viz Media') === false)

// ── Comics-only refresh gate (Bookshop full-sync trust gate) ─────────────────
// The gate classifies the CANONICAL, never the feed row. 'uncertain' and
// 'non-comic' must both be rejected — pollution freshness is never extended.
// The format ENUM is NOT evidence (proven contaminated on first run).
check('gate: ComicVine id → comic',
  classifyCanonicalComicShape({ format: 'OTHER', comicvineId: '12345', title: 'Obscure Title' }) === 'comic')
check('gate: exact comics publisher (Viz Media) → comic',
  classifyCanonicalComicShape({ format: 'OTHER', publisher: 'Viz Media', title: 'Some Series 3' }) === 'comic')
check('gate: word-bounded "graphic novel" in title → comic',
  classifyCanonicalComicShape({ format: 'OTHER', publisher: 'Unknown Press', title: 'Persepolis: A Graphic Novel' }) === 'comic')
check('gate: word-bounded "manga" in title → comic',
  classifyCanonicalComicShape({ format: 'OTHER', publisher: null, title: 'Spy x Family Manga Box Set' }) === 'comic')
check('gate: health book (self-help flag) → non-comic REJECTED',
  classifyCanonicalComicShape({ format: 'OTHER', publisher: 'Hay House', title: 'The Self-Help Guide to Healing' }) === 'non-comic')
check('gate: cookbook → non-comic REJECTED',
  classifyCanonicalComicShape({ format: 'OTHER', publisher: null, title: 'The Mediterranean Cookbook' }) === 'non-comic')
check('gate: generic novel, no signals → uncertain REJECTED (never guessed)',
  classifyCanonicalComicShape({ format: 'OTHER', publisher: 'Faber & Faber', title: 'The Quiet House' }) === 'uncertain')
// Real-world regressions from the first full-sync run — format enum lied:
check('gate REGRESSION: cookbook mislabelled HARDCOVER → non-comic (format is not evidence)',
  classifyCanonicalComicShape({ format: 'HARDCOVER', publisher: 'Bloomsbury', title: "Poppy Cooks: The Food You Need Poppy O'Toole Cookbook" }) === 'non-comic')
check('gate REGRESSION: music book mislabelled DELUXE → uncertain REJECTED',
  classifyCanonicalComicShape({ format: 'DELUXE', publisher: null, title: 'Iron Maiden: Piece Of Mind - Deluxe Edition' }) === 'uncertain')
check('gate REGRESSION: "Mangal" cookbook mislabelled MANGA_VOLUME → uncertain REJECTED (\\b beats substring)',
  classifyCanonicalComicShape({ format: 'MANGA_VOLUME', publisher: 'Quadrille', title: 'Mangal II: Stories and Recipes' }) === 'uncertain')
check('gate: comic format enum ALONE is not enough → uncertain',
  classifyCanonicalComicShape({ format: 'TPB', publisher: 'Somewhere Press', title: 'Anything At All' }) === 'uncertain')
check('gate predicate: comic → refreshable',
  isRefreshableComicCanonical({ format: 'OTHER', comicvineId: '9', title: 'X' }) === true)
check('gate predicate: uncertain → NOT refreshable',
  isRefreshableComicCanonical({ format: 'OTHER', publisher: 'Faber & Faber', title: 'The Quiet House' }) === false)
check('gate predicate: non-comic → NOT refreshable',
  isRefreshableComicCanonical({ format: 'OTHER', title: 'GCSE Maths Study Guide' }) === false)

console.log(failures === 0 ? '\nEDITION IDENTITY: PASS' : `\nEDITION IDENTITY: FAIL — ${failures} failure(s)`)
process.exit(failures === 0 ? 0 : 1)
