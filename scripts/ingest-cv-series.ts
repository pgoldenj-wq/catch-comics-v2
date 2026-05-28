/**
 * ingest-cv-series — Scoped Comic Vine series ingest.
 *
 * Given a CV volume ID or a search term, fetches the volume + all issues
 * from Comic Vine and upserts them as canonical_products rows. Single
 * issues get format=SINGLE_ISSUE, the volume itself isn't ingested (we
 * already capture collected editions via retailer feeds).
 *
 * These rows have NO retailer listings — they're catalogue entries.
 * They're searchable because score.ts no longer demotes zero-offer products.
 *
 * Usage:
 *   npm run ingest:cv-series -- --volume-id 121424      # by CV volume ID
 *   npm run ingest:cv-series -- --search "Absolute Batman"
 *   npm run ingest:cv-series -- --volume-id 121424 --dry-run
 *
 * Cover sourcing: uses downloadAndStoreCoverWithFallback() → CV first,
 * then Open Library if ISBN present (issues rarely have ISBNs). Falls back
 * to leaving cover_image_url as the CV URL if R2 upload fails (still works
 * via the images.catchcomics.com proxy or as a direct embed).
 */

import { PrismaClient } from '@prisma/client'
import { downloadAndStoreCoverWithFallback } from '../lib/images/download'

const prisma = new PrismaClient()

// ── CLI argument parsing ───────────────────────────────────────────────────────

interface Args {
  volumeId: string | null
  search:   string | null
  dryRun:   boolean
  limit:    number
}

function parseArgs(): Args {
  const argv = process.argv.slice(2)
  const args: Args = { volumeId: null, search: null, dryRun: false, limit: 200 }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--volume-id') args.volumeId = argv[++i] ?? null
    else if (a === '--search') args.search = argv[++i] ?? null
    else if (a === '--dry-run') args.dryRun = true
    else if (a === '--limit')   args.limit  = parseInt(argv[++i] ?? '200', 10)
  }
  if (!args.volumeId && !args.search) {
    console.error('Usage: --volume-id <id> | --search <term> [--dry-run] [--limit N]')
    process.exit(1)
  }
  return args
}

// ── Comic Vine API client ──────────────────────────────────────────────────────

const CV_BASE = 'https://comicvine.gamespot.com/api'
const CV_KEY  = process.env.COMIC_VINE_API_KEY

interface CVImage {
  small_url?: string
  medium_url?: string
  original_url?: string
  super_url?: string
}

interface CVVolume {
  id:               number
  name:             string
  start_year:       string | null
  description:      string | null
  publisher:        { name: string } | null
  count_of_issues:  number
  image:            CVImage | null
}

interface CVIssue {
  id:           number
  issue_number: string
  name:         string | null
  cover_date:   string | null
  store_date:   string | null
  description:  string | null
  image:        CVImage | null
  volume:       { id: number; name: string } | null
}

async function cvFetch<T>(path: string): Promise<T> {
  const sep = path.includes('?') ? '&' : '?'
  const url = `${CV_BASE}${path}${sep}api_key=${CV_KEY}&format=json`
  const res = await fetch(url, {
    headers: { 'User-Agent': 'CatchComics/1.0 (+https://catchcomics.com) series-ingest' },
  })
  if (!res.ok) throw new Error(`CV API ${res.status} for ${path}`)
  const json = await res.json()
  if (json.status_code && json.status_code !== 1) {
    throw new Error(`CV error ${json.status_code}: ${json.error}`)
  }
  return json.results as T
}

// ── Search → volume ID resolution ──────────────────────────────────────────────

async function resolveVolumeId(search: string): Promise<string | null> {
  const results = await cvFetch<CVVolume[]>(
    `/search/?resources=volume&query=${encodeURIComponent(search)}&limit=10&field_list=id,name,start_year,count_of_issues,publisher`
  )
  if (results.length === 0) return null

  // Pick most issues among results that contain all query words in name
  const qWords = search.toLowerCase().split(/\s+/).filter(w => w.length > 1)
  const matches = results.filter(r => {
    const n = r.name.toLowerCase()
    return qWords.every(w => n.includes(w))
  })
  const pool = matches.length > 0 ? matches : results
  pool.sort((a, b) => (b.count_of_issues ?? 0) - (a.count_of_issues ?? 0))
  console.log(`[search] ${pool.length} candidates for "${search}"; top: ${pool[0].name} (${pool[0].start_year}, ${pool[0].count_of_issues} issues, id=${pool[0].id})`)
  return String(pool[0].id)
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 200)
}

function pickCoverUrl(img: CVImage | null): string | null {
  if (!img) return null
  return img.super_url || img.original_url || img.medium_url || img.small_url || null
}

function isoDate(d: string | null): Date | null {
  if (!d) return null
  const dt = new Date(d)
  return isNaN(dt.getTime()) ? null : dt
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!CV_KEY) {
    console.error('COMIC_VINE_API_KEY not set')
    process.exit(1)
  }
  const args = parseArgs()

  // Resolve volume ID if a search term was given
  let volumeId = args.volumeId
  if (!volumeId && args.search) {
    volumeId = await resolveVolumeId(args.search)
    if (!volumeId) {
      console.error(`No CV volume found for "${args.search}"`)
      process.exit(1)
    }
  }

  // Fetch the volume metadata
  console.log(`\nFetching volume ${volumeId}…`)
  const volume = await cvFetch<CVVolume>(
    `/volume/4050-${volumeId}/?field_list=id,name,start_year,description,publisher,count_of_issues,image`
  )
  console.log(`  ${volume.name} (${volume.start_year}) — ${volume.count_of_issues} issues — ${volume.publisher?.name ?? 'no publisher'}`)

  // Fetch all issues for this volume (paginated, 100 per page)
  const allIssues: CVIssue[] = []
  let offset = 0
  while (offset < volume.count_of_issues && allIssues.length < args.limit) {
    const batch = await cvFetch<CVIssue[]>(
      `/issues/?filter=volume:${volumeId}&offset=${offset}&limit=100&sort=issue_number:asc&field_list=id,issue_number,name,cover_date,store_date,description,image,volume`
    )
    if (batch.length === 0) break
    allIssues.push(...batch)
    offset += batch.length
    console.log(`  Fetched ${allIssues.length}/${volume.count_of_issues} issues`)
  }
  const issues = allIssues.slice(0, args.limit)
  console.log(`\nWill ${args.dryRun ? 'DRY-RUN' : 'ingest'} ${issues.length} issues for "${volume.name}"`)
  if (args.dryRun) {
    issues.slice(0, 5).forEach(i =>
      console.log(`  #${i.issue_number} ${i.name ?? ''} (id=${i.id}, ${i.cover_date ?? 'no date'})`)
    )
    if (issues.length > 5) console.log(`  … and ${issues.length - 5} more`)
    await prisma.$disconnect()
    return
  }

  // Upsert each issue as a canonical_product
  let inserted = 0
  let updated  = 0
  let coversOk = 0

  for (const issue of issues) {
    const cvId       = String(issue.id)
    const title      = `${volume.name} #${issue.issue_number}${issue.name ? ` — ${issue.name}` : ''}`
    const slug       = slugify(`${volume.name}-${issue.issue_number}-${cvId}`)
    const cvCoverUrl = pickCoverUrl(issue.image)
    const releaseAt  = isoDate(issue.cover_date) ?? isoDate(issue.store_date)
    const cvMeta = {
      cv_issue_id:  issue.id,
      cv_volume_id: Number(volumeId),
      issue_name:   issue.name,
      cover_date:   issue.cover_date,
      store_date:   issue.store_date,
      ingested_at:  new Date().toISOString(),
    }

    // Check if a row with this comicvine_id already exists
    const existing = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM canonical_products WHERE comicvine_id = ${cvId} LIMIT 1
    `

    if (existing.length > 0) {
      // Update — preserve cover_image_url if already set
      await prisma.$executeRaw`
        UPDATE canonical_products SET
          title         = ${title},
          publisher     = ${volume.publisher?.name ?? null},
          series_name   = ${volume.name},
          issue_number  = ${issue.issue_number},
          release_date  = ${releaseAt},
          description   = ${issue.description},
          cv_metadata   = ${JSON.stringify(cvMeta)}::jsonb,
          updated_at    = NOW()
        WHERE id = ${existing[0].id}::uuid
      `
      updated++
      // Backfill cover if missing
      if (cvCoverUrl) {
        const r = await downloadAndStoreCoverWithFallback(existing[0].id, { cvUrl: cvCoverUrl })
        if (r) coversOk++
      }
    } else {
      // Insert — create new product
      const inserted_row = await prisma.$queryRaw<Array<{ id: string }>>`
        INSERT INTO canonical_products (
          id, comicvine_id, title, publisher, format, series_name,
          issue_number, release_date, description, canonical_slug,
          cv_metadata, created_at, updated_at
        ) VALUES (
          gen_random_uuid(),
          ${cvId},
          ${title},
          ${volume.publisher?.name ?? null},
          'SINGLE_ISSUE'::"ProductFormat",
          ${volume.name},
          ${issue.issue_number},
          ${releaseAt},
          ${issue.description},
          ${slug},
          ${JSON.stringify(cvMeta)}::jsonb,
          NOW(),
          NOW()
        )
        ON CONFLICT (canonical_slug) DO UPDATE SET updated_at = NOW()
        RETURNING id
      `
      inserted++
      if (cvCoverUrl && inserted_row[0]) {
        const r = await downloadAndStoreCoverWithFallback(inserted_row[0].id, { cvUrl: cvCoverUrl })
        if (r) coversOk++
      }
    }
  }

  console.log(`\nDone:`)
  console.log(`  Inserted: ${inserted}`)
  console.log(`  Updated:  ${updated}`)
  console.log(`  Covers:   ${coversOk}/${inserted + updated} uploaded to R2`)

  await prisma.$disconnect()
}

main().catch(async e => {
  console.error('Ingest failed:', e)
  await prisma.$disconnect()
  process.exit(1)
})
