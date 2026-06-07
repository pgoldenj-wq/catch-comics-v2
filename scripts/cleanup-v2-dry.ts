/**
 * cleanup-v2-dry — DRY RUN only. Identifies non-comic pollution beyond
 * what cleanup-v1 caught. Read-only against canonical_products. NEVER
 * executes deletes from this file — a separate execute mode (not built
 * here, requires user sign-off + a different script) would do that.
 *
 * Criteria (all conditions must hold for a row to enter the delete pool):
 *
 *   A. format = 'OTHER'
 *   B. comicvine_id IS NULL  (so the running enrichment hasn't claimed it)
 *   C. deleted_at IS NULL
 *   D. NO live priced listings (NOT EXISTS retailer_listings.price_amount > 0)
 *   E. (
 *        publisher matches an academic catch-all
 *          (university press, academic press, academic publishing)
 *        OR
 *        title matches an expanded NON_COMIC_FLAG
 *          ('works of', 'studies in', 'survey of', 'comedies of',
 *           'literary works of', 'translation of', 'a treatise on',
 *           'études sur', 'oeuvres', 'die chroniken',
 *           'illustrations of', 'report of the committee')
 *        OR
 *        title ends with "; Volume N" or ", Volume N" AND has no
 *          other comic signal beyond 'volume '
 *      )
 *   F. title comic-signal guard (from cleanup-v1) excludes anything
 *      whose title hits a real COMIC_SIGNAL (manga, omnibus,
 *      graphic novel, comic publishers, character names, '#N')
 *   G. explicit protect-list — never touches the 5 known-good comics
 *      surfaced in earlier sampling.
 */

import { PrismaClient } from '@prisma/client'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { COMIC_SIGNALS } from '../lib/search/isLikelyComic'

const prisma = new PrismaClient()

// ─────────────────────────────────────────────────────────────────────────────
// NEW expanded non-comic title flags (user-approved set)
// ─────────────────────────────────────────────────────────────────────────────
const V2_NON_COMIC_TITLE_PATTERNS: readonly string[] = [
  'works of',
  'studies in',
  'survey of',
  'comedies of',
  'literary works of',
  'translation of',
  'a treatise on',
  'études sur',
  'etudes sur',
  'oeuvres',
  'die chroniken',
  'illustrations of',
  'report of the committee',
]

// Academic publisher catch-all (case-insensitive substring matches).
const V2_ACADEMIC_PUBLISHER_PATTERNS: readonly string[] = [
  'university press',
  'academic press',
  'academic publishing',
]

// Five real comics from the earlier diagnostic — EXPLICITLY PROTECTED.
// Match on title contains (case-insensitive). If any of these strings appears
// in a product's title, it is never in the delete set.
const PROTECT_TITLE_FRAGMENTS: readonly string[] = [
  'batman hush 2',
  'batman: white knight',
  'white knight dc compact',
  "beast's descent into love",
  'marvel select: wolverine',
  'cat & cat adventures',
]

// Title comic-signal guard (Cleanup v1 final safety net). Re-uses the
// broad COMIC_SIGNALS list from lib/search/isLikelyComic.
function titleHasComicSignal(title: string): boolean {
  const t = title.toLowerCase()
  for (const s of COMIC_SIGNALS) if (t.includes(s)) return true
  return false
}

function titleMatchesV2Pattern(title: string): boolean {
  const t = title.toLowerCase()
  for (const p of V2_NON_COMIC_TITLE_PATTERNS) if (t.includes(p)) return true
  return false
}

function publisherIsAcademic(publisher: string | null): boolean {
  if (!publisher) return false
  const p = publisher.toLowerCase()
  for (const pat of V2_ACADEMIC_PUBLISHER_PATTERNS) if (p.includes(pat)) return true
  return false
}

// "; Volume N" or ", Volume N" near the end of the title, AND no comic
// signal beyond the generic 'volume '. The signal-guard above is more
// permissive (it spares any title with any signal including 'volume ');
// the v2 volume-N rule is specifically "only weak signal is 'volume '".
function titleIsVolumeNonlyPattern(title: string): boolean {
  const t = title.toLowerCase()
  // Match "; volume <digits>" or ", volume <digits>" or "; vol <digits>"
  if (!/[,;]\s*vol(?:ume)?\.?\s*\d+\b/i.test(title)) return false
  // Strip the generic 'volume '/'vol.' signal then check whether anything
  // ELSE in COMIC_SIGNALS matches. If yes -> spare (it's not weak-only).
  const STRIP = ['volume ','volume:','vol.','#1','#2','#3','#4','#5']
  for (const s of COMIC_SIGNALS) {
    if (STRIP.includes(s)) continue
    if (t.includes(s)) return false  // a stronger signal is present
  }
  return true
}

function isProtected(title: string): boolean {
  const t = title.toLowerCase()
  for (const frag of PROTECT_TITLE_FRAGMENTS) if (t.includes(frag)) return true
  return false
}

interface Row { id: string; title: string; publisher: string | null }

async function main() {
  console.log('Cleanup v2 — DRY RUN (no DB writes)\n')

  // Stage 1: pull all candidates that satisfy (A) (B) (C) (D).
  // Pre-filter for one of: academic publisher OR title v2 pattern OR
  // (semicolon/comma + "Volume N"). Title-guard + protect-list applied
  // in JS — cheaper than encoding in SQL given the substring counts.
  const pubLike = V2_ACADEMIC_PUBLISHER_PATTERNS
    .map(p => `LOWER(publisher) LIKE '%${p}%'`)
    .join(' OR ')

  const titleLike = V2_NON_COMIC_TITLE_PATTERNS
    .map(p => `LOWER(title) LIKE '%${p.replace(/'/g, "''")}%'`)
    .join(' OR ')

  // Either-side Volume-N regex match (broader than the JS check — JS will
  // narrow it). \y is Postgres word boundary.
  const volRegex = `LOWER(title) ~ '[,;]\\s*vol(ume)?\\.?\\s*\\d+\\y'`

  const sql = `
    SELECT cp.id, cp.title, cp.publisher
    FROM canonical_products cp
    WHERE cp.format::text = 'OTHER'
      AND cp.comicvine_id IS NULL
      AND cp.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM retailer_listings rl
        JOIN retailers ret ON ret.id = rl.retailer_id
        WHERE rl.canonical_product_id = cp.id
          AND rl.price_amount > 0
          AND rl.deleted_at IS NULL
          AND ret.is_active = true
      )
      AND (
        (${pubLike})
        OR (${titleLike})
        OR (${volRegex})
      )
  `
  const candidates = await prisma.$queryRawUnsafe<Row[]>(sql)
  console.log(`Stage-1 SQL candidates (academic pub / v2 title pattern / Volume-N): ${candidates.length}`)

  // Stage 2: apply the JS guards
  let protectedCount = 0
  let signalSparedCount = 0
  const sparedSamples: Row[] = []
  const toDelete: Row[] = []

  for (const r of candidates) {
    if (isProtected(r.title)) {
      protectedCount++
      sparedSamples.push(r)
      continue
    }
    if (titleHasComicSignal(r.title)) {
      // Special case: if title only has 'volume ' as signal AND matches
      // Volume-N pattern, we still consider it. Otherwise spare.
      if (titleIsVolumeNonlyPattern(r.title)) {
        // The Volume-N path: weak signal only — proceed to delete.
      } else if (titleMatchesV2Pattern(r.title) || publisherIsAcademic(r.publisher)) {
        // Title hits an EXPLICIT v2 pattern OR the academic publisher
        // catch-all — these signals override the broad comic-signal
        // guard (e.g. "Works of Charles Dickens; Volume 1" would
        // false-spare on the 'volume ' signal but the "works of"
        // explicit flag is more authoritative).
      } else {
        signalSparedCount++
        if (sparedSamples.length < 20) sparedSamples.push(r)
        continue
      }
    }
    toDelete.push(r)
  }

  console.log(`  ↳ spared by protect-list (5 known comics):   ${protectedCount}`)
  console.log(`  ↳ spared by title comic-signal guard:        ${signalSparedCount}`)
  console.log(`  ↳ remaining DELETE candidates:               ${toDelete.length}`)

  // ── Sanity: confirm zero comic-signal products in the delete set ─────
  // (Sanity-check: any to-delete row that hits a strong signal would be
  //  a bug. We only allow weak Volume-N-only or explicit v2 overrides.)
  let leakage = 0
  for (const r of toDelete) {
    if (isProtected(r.title)) { leakage++; continue }
    const t = r.title.toLowerCase()
    // Strong signals — narrower than COMIC_SIGNALS broad set
    const STRONG = ['manga','graphic novel','omnibus','tpb',
      'trade paperback','compendium','marvel','dc comics','image comics',
      'dark horse','idw','viz media','kodansha','yen press','seven seas',
      'tokyopop','batman','superman','spider-man','x-men','avengers',
      'deadpool','wolverine','watchmen','sandman','invincible',
      'walking dead','sin city','preacher','hellboy','maus']
    for (const s of STRONG) {
      if (t.includes(s)) { leakage++; break }
    }
  }
  console.log(`\nStrong-signal leakage in delete set (must be 0): ${leakage}`)

  // ── Publisher composition of the delete set ────────────────────────
  const pubDist = new Map<string, number>()
  for (const r of toDelete) {
    const key = r.publisher ?? '(NULL)'
    pubDist.set(key, (pubDist.get(key) ?? 0) + 1)
  }
  const topPubs = [...pubDist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)
  console.log(`\nTop 15 publishers in delete set:`)
  topPubs.forEach(([k, v]) => console.log(`  ${v.toString().padStart(5)}  ${k.slice(0, 60)}`))

  // ── Sample 150 of the delete set ───────────────────────────────────
  console.log(`\n=== Sample of 150 delete candidates ===`)
  toDelete.slice(0, 150).forEach((r, i) => {
    const pub = r.publisher ? ` [${r.publisher.slice(0, 28)}]` : ''
    console.log(`  ${(i + 1).toString().padStart(4)}. ${r.title.slice(0, 65)}${pub}`)
  })

  // ── Write JSON audit ───────────────────────────────────────────────
  const path = join(__dirname, 'cleanup-v2-delete-candidates.json')
  writeFileSync(path, JSON.stringify(toDelete.map(r => ({
    id: r.id, title: r.title, publisher: r.publisher,
  })), null, 2))

  console.log(`\nJSON audit: ${path} (${toDelete.length} rows)`)
  console.log(`\nDRY RUN — no data modified. Awaiting user sign-off before any execute.`)

  await prisma.$disconnect()
}

main().catch(async e => {
  console.error('Failed:', e)
  await prisma.$disconnect()
  process.exit(1)
})
