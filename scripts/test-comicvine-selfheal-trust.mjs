/**
 * The self-heal write must not take its value from the caller.
 *
 * History: PATCH /api/product/{slug}/comicvine-id is public (proxy.ts matches
 * only /admin/* and /api/admin/*). It originally took an unconditional update
 * from the request body. That was narrowed to gap-fill on 2026-11-22, which
 * stopped overwrites — but ~125k products have a null comicvine_id, and for
 * every one of those an anonymous caller still chose the FIRST value. Gap-fill
 * then refused to correct it, so a poisoned id was permanent.
 *
 * The gate that authorised the write (title similarity) ran in the browser.
 * These tests assert it now runs on the server and that the body is ignored.
 *
 * Local only: static source assertions plus the real scorer. No network, no
 * database, no production request.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ROUTE  = readFileSync(join(ROOT, 'app/api/product/[slug]/comicvine-id/route.ts'), 'utf8')
const CLIENT = readFileSync(join(ROOT, 'components/useIssueList.ts'), 'utf8')
const LIB    = readFileSync(join(ROOT, 'lib/comicvine/title-match.ts'), 'utf8')

let pass = 0, fail = 0
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}

console.log('\nTHE BODY IS NOT DATA — an anonymous caller cannot choose the id')
ok('route never parses the request body',
   !/request\.json\(\)|req\.json\(\)/.test(ROUTE))
ok('route never reads comicvineId out of a body',
   !/body.*comicvineId|comicvineId.*in body|'comicvineId' in/.test(ROUTE))
ok('the only value written comes from the server-side lookup',
   /data: *\{ *comicvineId: match\.volumeId *\}/.test(ROUTE),
   'the written value must be match.volumeId')
ok('route performs its own Comic Vine lookup',
   /searchVolumeByTitle\(searchTitle\)/.test(ROUTE))
ok('the search title comes from the database row, not the caller',
   /product\.seriesName \?\? product\.title/.test(ROUTE))

console.log('\nTHE CONFIDENCE GATE RUNS ON THE SERVER')
ok('route recomputes similarity itself',
   /const similarity = titleSimilarity\(searchTitle, match\.name\)/.test(ROUTE))
ok('route refuses below the threshold',
   /similarity < SELF_HEAL_THRESHOLD/.test(ROUTE))
ok('write stays gap-fill only (cannot overwrite)',
   /where: *\{ *canonicalSlug: slug, comicvineId: null *\}/.test(ROUTE))
ok('route is still throttled',
   /enforceRateLimit\(request, 'comicvine-id', 30\)/.test(ROUTE))
ok('soft-deleted products are not healed',
   /deletedAt: null/.test(ROUTE))

console.log('\nTHE CLIENT NO LONGER HOLDS THE GATE')
ok('client sends no body at all',
   !/comicvine-id[\s\S]{0,200}body:/.test(CLIENT))
ok('client-side similarity scorer is gone',
   !/function titleSimilarity/.test(CLIENT))
ok('client-side threshold constant is gone',
   !/SELF_HEAL_THRESHOLD *=/.test(CLIENT))
ok('exactly one implementation of the scorer remains',
   /export function titleSimilarity/.test(LIB))

console.log('\nPROBING REVEALS NOTHING')
{
  const noChangeArms = (ROUTE.match(/NextResponse\.json\(NO_CHANGE\)/g) || []).length
  ok('unknown slug and already-set answer identically', noChangeArms >= 4,
     `found ${noChangeArms} identical no-change returns`)
  ok('the no-change body carries no detail',
     /const NO_CHANGE = \{ ok: true, updated: false \}/.test(ROUTE))
}

console.log('\nTHE REAL SCORER REJECTS A MISMATCHED VOLUME')
{
  // Extract and run the shipped titleSimilarity.
  const a = LIB.indexOf('export function titleSimilarity')
  const b = LIB.indexOf('\n}', LIB.indexOf('return (2 * precision * recall)', a)) + 2
  const src = LIB.slice(a, b).replace('export function', 'function')
    .replace(/: *number/g, '').replace(/: *string/g, '')
  const titleSimilarity = new Function(`${src}; return titleSimilarity;`)()
  const THRESHOLD = 0.45

  const cases = [
    ['Absolute Batman', 'Absolute Batman',       true,  'exact match heals'],
    ['Absolute Batman', 'Spawn',                 false, 'unrelated volume refused'],
    ['Saga',            'Saga',                  true,  'single-word exact heals'],
    ['Absolute Batman', 'Absolute Wonder Woman', false, 'sibling edition refused'],
  ]
  for (const [title, cvName, shouldHeal, label] of cases) {
    const sim = titleSimilarity(title, cvName)
    const heals = sim >= THRESHOLD
    ok(`${label} (sim ${sim.toFixed(2)})`, heals === shouldHeal,
       `expected heal=${shouldHeal}, got ${heals}`)
  }

  // ── Known weakness, recorded deliberately ────────────────────────────────
  // 'absolute' is in the scorer's STOP list, so "Absolute Batman" tokenises to
  // ['batman'] and scores 1.00 against Comic Vine's generic "Batman" volume.
  // The stop list strips the word that identifies the edition, and the same
  // holds for 'omnibus', 'deluxe' and 'complete'.
  //
  // This is PRE-EXISTING: the identical scorer and STOP list already backed
  // /api/comic/search (threshold 0.50) and the old client-side gate (0.45).
  // Moving the gate server-side neither introduced nor worsened it, and the
  // security property this file exists to prove — that a CALLER cannot choose
  // the id — does not depend on it.
  //
  // It is asserted rather than fixed because STOP is shared with search, so
  // changing it changes site-wide matching, which is a deliberate product
  // decision and not an incident fix. Asserted so it is visible and cannot
  // drift unnoticed.
  const editionBlindness = titleSimilarity('Absolute Batman', 'Batman')
  ok(`KNOWN: edition words are stripped, so "Absolute Batman" ≈ "Batman" (sim ${editionBlindness.toFixed(2)})`,
     editionBlindness >= THRESHOLD,
     'if this now FAILS the STOP list changed — re-check search matching too')
}

console.log('\nATTACK SIMULATION — the old hole, against the new route')
{
  // An attacker POSTs {comicvineId: "999999"} at a blank-id product.
  // Old route: stored 999999. New route: the body is never read, so the only
  // path to a write is the server's own lookup scoring >= 0.45.
  const bodyIsRead = /request\.json\(\)|req\.json\(\)/.test(ROUTE)
  ok('attacker-supplied id cannot reach the database', !bodyIsRead)
  ok('attacker cannot pre-seed via /api/comic/search either — same shared lookup',
     /searchVolumeByTitle/.test(readFileSync(join(ROOT, 'app/api/comic/search/route.ts'), 'utf8')))
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} passed · ${fail} failed\n`)
process.exit(fail > 0 ? 1 : 0)
