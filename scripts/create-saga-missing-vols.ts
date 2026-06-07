/**
 * create-saga-missing-vols — Fix the Saga series reading-order gaps.
 *
 * Investigation results (2026-06-07):
 *
 *  Vol. 7  — genuinely absent. No product anywhere with volume_number=7
 *             or ISBN 9781632152701 under comicvine_id=46568.
 *             Action: INSERT synthetic TPB (catalogue entry, no listings).
 *
 *  Vol. 10 — exists as "Saga" (ISBN 9781534323346, id: f644a8b5…)
 *             but has volume_number=NULL so getSeriesData() sorts it last.
 *             Confirmed by Open Library ("Saga, Volume Ten") + DB description
 *             ("Source title: Saga, Volume 10 (Saga, 10)") + 8 live listings.
 *             Action: UPDATE title + volume_number only. Keep slug, cv_metadata,
 *             cover, and listings untouched.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/create-saga-missing-vols.ts
 *   npx tsx --env-file=.env.local scripts/create-saga-missing-vols.ts --dry-run
 *
 * Idempotent: pre-flight checks skip any step already in the correct state.
 * Safe to re-run at any time.
 */

import { PrismaClient } from '@prisma/client'
import { downloadAndStoreCoverWithFallback } from '../lib/images/download'

const prisma  = new PrismaClient()
const DRY_RUN = process.argv.includes('--dry-run')

// ── Constants ─────────────────────────────────────────────────────────────────

const SAGA_CV_VOLUME_ID = '46568'
const CV_BASE           = 'https://comicvine.gamespot.com/api'
const CV_KEY            = process.env.COMIC_VINE_API_KEY

const VOL7 = {
  volumeNumber: 7,
  isbn13:       '9781632152701',
  title:        'Saga Volume 7',
  slug:         'saga-volume-7',
}

const VOL10_EXISTING_ID  = 'f644a8b5-91a6-48f5-862f-622aac1201db'
const VOL10_EXISTING_ISBN = '9781534323346'

// ── CV API ────────────────────────────────────────────────────────────────────

interface CVVolume {
  id:          number
  name:        string
  description: string | null
  start_year:  string | null
  publisher:   { name: string } | null
  image:       { super_url?: string; original_url?: string } | null
}

async function fetchCvVolume(volumeId: string): Promise<CVVolume | null> {
  if (!CV_KEY) {
    console.warn('[cv] COMIC_VINE_API_KEY not set — skipping CV metadata fetch')
    return null
  }
  try {
    const url = `${CV_BASE}/volume/4050-${volumeId}/?api_key=${CV_KEY}&format=json&field_list=id,name,description,start_year,publisher,image`
    const res = await fetch(url, {
      signal:  AbortSignal.timeout(30_000),
      headers: { 'User-Agent': 'CatchComics/1.0 (+https://catchcomics.com) missing-vols-fix' },
    })
    if (!res.ok) throw new Error(`CV HTTP ${res.status}`)
    const json = await res.json() as { status_code: number; results: CVVolume }
    if (json.status_code !== 1) throw new Error(`CV error ${json.status_code}`)
    return json.results
  } catch (e) {
    console.warn(`[cv] Volume fetch failed: ${e}`)
    return null
  }
}

function stripHtmlBasic(html: string | null): string | null {
  if (!html) return null
  return html.replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim() || null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function log(msg: string) { console.log(msg) }
function dry(msg: string) { console.log(`  [DRY-RUN] ${msg}`) }

// ── Pre-flight checks ─────────────────────────────────────────────────────────

async function preflightVol7(): Promise<{ ok: boolean; reason?: string }> {
  // Check no product already exists with this ISBN
  const byIsbn = await prisma.$queryRaw<Array<{ id: string; title: string }>>`
    SELECT id, title FROM canonical_products
    WHERE isbn_13 = ${VOL7.isbn13} AND deleted_at IS NULL
    LIMIT 1
  `
  if (byIsbn.length > 0) {
    return { ok: false, reason: `ISBN ${VOL7.isbn13} already exists: "${byIsbn[0].title}" (${byIsbn[0].id})` }
  }

  // Check no product already has volume_number=7 for this CV volume
  const byVol = await prisma.$queryRaw<Array<{ id: string; title: string }>>`
    SELECT id, title FROM canonical_products
    WHERE comicvine_id = ${SAGA_CV_VOLUME_ID}
      AND volume_number = 7
      AND format != 'SINGLE_ISSUE'
      AND deleted_at IS NULL
    LIMIT 1
  `
  if (byVol.length > 0) {
    return { ok: false, reason: `Vol.7 already exists: "${byVol[0].title}" (${byVol[0].id})` }
  }

  // Check no product with slug 'saga-volume-7' exists
  const bySlug = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM canonical_products WHERE canonical_slug = ${VOL7.slug} LIMIT 1
  `
  if (bySlug.length > 0) {
    return { ok: false, reason: `Slug "${VOL7.slug}" already taken by ${bySlug[0].id}` }
  }

  return { ok: true }
}

async function preflightVol10(): Promise<{
  ok:      boolean
  reason?: string
  alreadyFixed?: boolean
  existingTitle?: string
  existingVolumeNumber?: number | null
}> {
  // Verify the known product still exists and matches expectations
  const rows = await prisma.$queryRaw<Array<{
    id: string; title: string; isbn_13: string | null;
    volume_number: number | null; comicvine_id: string | null; deleted_at: Date | null
  }>>`
    SELECT id, title, isbn_13, volume_number, comicvine_id, deleted_at
    FROM canonical_products
    WHERE id = ${VOL10_EXISTING_ID}::uuid
    LIMIT 1
  `

  if (rows.length === 0) {
    return { ok: false, reason: `Expected product ${VOL10_EXISTING_ID} not found — may have been deleted` }
  }

  const row = rows[0]

  if (row.deleted_at) {
    return { ok: false, reason: `Product ${VOL10_EXISTING_ID} is soft-deleted` }
  }

  if (row.isbn_13 !== VOL10_EXISTING_ISBN) {
    return { ok: false, reason: `Product ISBN mismatch: expected ${VOL10_EXISTING_ISBN}, got ${row.isbn_13}` }
  }

  if (row.comicvine_id !== SAGA_CV_VOLUME_ID) {
    return { ok: false, reason: `Product comicvine_id mismatch: expected ${SAGA_CV_VOLUME_ID}, got ${row.comicvine_id}` }
  }

  if (row.volume_number === 10) {
    return { ok: true, alreadyFixed: true, existingTitle: row.title }
  }

  return { ok: true, existingTitle: row.title, existingVolumeNumber: row.volume_number }
}

// ── Vol.10 fix ────────────────────────────────────────────────────────────────

async function fixVol10(dryRun: boolean): Promise<'updated' | 'already_correct' | 'skipped'> {
  log('\n── Vol.10 fix ──────────────────────────────────────────────────────────')

  const check = await preflightVol10()
  if (!check.ok) {
    log(`  ✗ Pre-flight failed: ${check.reason}`)
    return 'skipped'
  }

  if (check.alreadyFixed) {
    log(`  ✓ Already correct: "${check.existingTitle}" has volume_number=10`)
    return 'already_correct'
  }

  log(`  Found: "${check.existingTitle}" (volume_number=${check.existingVolumeNumber ?? 'NULL'})`)
  log(`  Will set: title="Saga Volume 10", volume_number=10`)

  if (dryRun) {
    dry(`UPDATE id=${VOL10_EXISTING_ID}: title → "Saga Volume 10", volume_number → 10`)
    return 'skipped'
  }

  await prisma.$executeRaw`
    UPDATE canonical_products
    SET title         = 'Saga Volume 10',
        volume_number = 10,
        updated_at    = NOW()
    WHERE id = ${VOL10_EXISTING_ID}::uuid
  `

  log('  ✓ Updated: volume_number=10, title="Saga Volume 10"')
  log('  ✓ Cover, slug, cv_metadata, and listings preserved unchanged')
  return 'updated'
}

// ── Vol.7 insert ──────────────────────────────────────────────────────────────

async function insertVol7(
  dryRun:    boolean,
  cvVolume:  CVVolume | null,
): Promise<'inserted' | 'already_exists' | 'skipped'> {
  log('\n── Vol.7 insert ─────────────────────────────────────────────────────────')

  const check = await preflightVol7()
  if (!check.ok) {
    if (check.reason?.startsWith('ISBN') || check.reason?.startsWith('Vol.7 already')) {
      log(`  ✓ Already exists: ${check.reason}`)
      return 'already_exists'
    }
    log(`  ✗ Pre-flight failed: ${check.reason}`)
    return 'skipped'
  }

  const rawPublisher = cvVolume?.publisher?.name ?? 'Image Comics'
  // CV abbreviates to "Image" — normalise to match existing Saga product rows.
  const publisher    = rawPublisher === 'Image' ? 'Image Comics' : rawPublisher
  const synopsis     = stripHtmlBasic(cvVolume?.description ?? null)
  const cvMetadata   = {
    cv_volume_id: Number(SAGA_CV_VOLUME_ID),
    cv_publisher: publisher,
    synopsis,
    creators: [
      { name: 'Brian K. Vaughan', role: 'writer' },
      { name: 'Fiona Staples',    role: 'artist'  },
    ],
    note:        'Synthetic catalogue entry — no retailer listings at creation time',
    enriched_at: new Date().toISOString(),
  }

  log(`  Will insert: "${VOL7.title}" slug="${VOL7.slug}" isbn=${VOL7.isbn13}`)
  log(`  CV publisher: ${publisher}`)
  log(`  Synopsis present: ${!!synopsis}`)

  if (dryRun) {
    dry(`INSERT canonical_products: ${VOL7.title} / vol=7 / isbn=${VOL7.isbn13}`)
    return 'skipped'
  }

  const inserted = await prisma.$queryRaw<Array<{ id: string }>>`
    INSERT INTO canonical_products (
      id, comicvine_id, isbn_13, title, publisher, format,
      series_name, volume_number, cv_metadata, canonical_slug,
      created_at, updated_at
    ) VALUES (
      gen_random_uuid(),
      ${SAGA_CV_VOLUME_ID},
      ${VOL7.isbn13},
      ${VOL7.title},
      ${publisher},
      'TPB'::"ProductFormat",
      'Saga',
      ${VOL7.volumeNumber},
      ${JSON.stringify(cvMetadata)}::jsonb,
      ${VOL7.slug},
      NOW(),
      NOW()
    )
    ON CONFLICT (canonical_slug) DO NOTHING
    RETURNING id
  `

  if (inserted.length === 0) {
    log(`  ✓ Slug "${VOL7.slug}" already existed — no insert (ON CONFLICT DO NOTHING)`)
    return 'already_exists'
  }

  const newId = inserted[0].id
  log(`  ✓ Inserted: id=${newId}`)
  return 'inserted'
}

// ── Cover fetch for Vol.7 ─────────────────────────────────────────────────────

async function fetchVol7Cover(dryRun: boolean): Promise<'stored' | 'not_found' | 'skipped'> {
  log('\n── Vol.7 cover ──────────────────────────────────────────────────────────')

  // Find the newly inserted (or pre-existing) Vol.7 product
  const rows = await prisma.$queryRaw<Array<{ id: string; cover_image_url: string | null }>>`
    SELECT id, cover_image_url FROM canonical_products
    WHERE comicvine_id = ${SAGA_CV_VOLUME_ID}
      AND volume_number = 7
      AND format != 'SINGLE_ISSUE'
      AND deleted_at IS NULL
    LIMIT 1
  `

  if (rows.length === 0) {
    log('  ✗ Vol.7 product not found — cannot fetch cover')
    return 'skipped'
  }

  const { id, cover_image_url } = rows[0]

  if (cover_image_url) {
    log(`  ✓ Cover already set: ${cover_image_url}`)
    return 'stored'
  }

  if (dryRun) {
    dry(`downloadAndStoreCoverWithFallback(${id}, isbn=${VOL7.isbn13})`)
    return 'skipped'
  }

  log(`  Trying Open Library → Google Books for ISBN ${VOL7.isbn13}…`)
  const result = await downloadAndStoreCoverWithFallback(id, { isbn13: VOL7.isbn13 })

  if (result) {
    log(`  ✓ Cover stored: ${result}`)
    return 'stored'
  }

  log('  ✗ No cover found from any source — leaving cover_image_url NULL')
  log('    (The VolumeCard will render a letter fallback "S" — acceptable)')
  return 'not_found'
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  log(`\n${'='.repeat(60)}`)
  log(`  create-saga-missing-vols${DRY_RUN ? ' [DRY-RUN]' : ''}`)
  log(`${'='.repeat(60)}`)

  if (DRY_RUN) {
    log('\n  Dry-run mode — no DB writes will be made.')
  }

  // Fetch CV volume metadata once (used for synopsis + publisher in Vol.7 insert)
  log('\nFetching CV volume metadata for Saga (id=46568)…')
  const cvVolume = await fetchCvVolume(SAGA_CV_VOLUME_ID)
  if (cvVolume) {
    log(`  ✓ Fetched: "${cvVolume.name}" (${cvVolume.start_year}) — ${cvVolume.publisher?.name ?? 'no publisher'}`)
  } else {
    log('  ✗ CV metadata unavailable — will use hardcoded Image Comics fallback')
  }

  // Fix Vol.10 first (UPDATE, no cover needed)
  const vol10Result = await fixVol10(DRY_RUN)

  // Insert Vol.7 (INSERT, then cover)
  const vol7Result  = await insertVol7(DRY_RUN, cvVolume)

  // Fetch cover only if we actually inserted (or if product exists with no cover)
  let coverResult: 'stored' | 'not_found' | 'skipped' = 'skipped'
  if (vol7Result === 'inserted' || vol7Result === 'already_exists') {
    coverResult = await fetchVol7Cover(DRY_RUN)
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  log('\n' + '='.repeat(60))
  log('  Summary')
  log('='.repeat(60))
  log(`  Vol.7  insert:  ${vol7Result}`)
  log(`  Vol.7  cover:   ${coverResult}`)
  log(`  Vol.10 fix:     ${vol10Result}`)
  log('')

  if (!DRY_RUN && (vol7Result === 'inserted' || vol10Result === 'updated')) {
    log('  Next steps:')
    log('  • /series/saga should now show Vols 1–12 in order')
    log('  • Vol.7 will show "Check price →" (no listings — correct)')
    log('  • Vol.10 will show its existing 8 live prices')
    log('  • Run: npm run build (or check dev server) to verify')
  }
}

main()
  .catch(e => { console.error('\nScript failed:', e); process.exit(1) })
  .finally(() => prisma.$disconnect())
