/**
 * ingest-issue-covers.ts — bounded, resumable issue-cover ingestion to R2
 * (Wave 4 Phase 5).
 *
 * For one ComicVine volume at a time: fetches the volume's issue list (ONE
 * CV API call, same endpoint the site uses), then downloads each issue's
 * cover from CV's image CDN (not rate-limited API calls), validates it
 * (content-type / decodability / dimensions / portrait / placeholder-hash)
 * and stores it at issue-covers/cv-{issueId}.webp. Identity is structural —
 * the key is derived from the same CV issue id the UI renders.
 *
 *   npm run ingest:issue-covers -- --volume 160294            # DRY RUN
 *   npm run ingest:issue-covers -- --volume 160294 --write    # store to R2
 *   npm run ingest:issue-covers -- --volume 160294 --write --limit 5
 *
 * Safety: never writes to the database; skips objects that already exist;
 * checkpoint (.issue-covers-checkpoint.json, gitignored) makes reruns cheap;
 * 500ms politeness delay between image downloads. Manifest for launch:health
 * → launch/operations/issue-covers-manifest.json (accumulates per volume).
 */

import { HeadObjectCommand } from '@aws-sdk/client-s3'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { r2Client, R2_BUCKET } from '../lib/images/r2'
import { downloadAndStoreIssueCover, issueCoverR2Key } from '../lib/images/download'

const argv     = process.argv.slice(2)
const WRITE    = argv.includes('--write')
const volIdx   = argv.indexOf('--volume')
const VOLUME   = volIdx !== -1 ? argv[volIdx + 1] : null
const limIdx   = argv.indexOf('--limit')
const LIMIT    = limIdx !== -1 ? parseInt(argv[limIdx + 1], 10) : Infinity

const CHECKPOINT = join(process.cwd(), 'scripts', '.issue-covers-checkpoint.json')
const MANIFEST   = join(process.cwd(), 'launch', 'operations', 'issue-covers-manifest.json')

if (!VOLUME || !/^\d+$/.test(VOLUME)) {
  console.error('Usage: npm run ingest:issue-covers -- --volume <cvVolumeId> [--write] [--limit N]')
  process.exit(1)
}

interface CvIssue { id: number; issue_number: string; image?: { medium_url?: string; small_url?: string; original_url?: string } }

function loadJson<T>(path: string, fallback: T): T {
  try { return JSON.parse(readFileSync(path, 'utf8')) as T } catch { return fallback }
}

async function r2ObjectExists(key: string): Promise<boolean> {
  try { await r2Client.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key })); return true }
  catch { return false }
}

async function main() {
  const apiKey = process.env.COMIC_VINE_API_KEY
  if (!apiKey) { console.error('COMIC_VINE_API_KEY not set'); process.exit(1) }

  // ── 1 CV API call: the volume's issues (same shape the site consumes) ─────
  const url = `https://comicvine.gamespot.com/api/issues/?api_key=${apiKey}&format=json&filter=volume:${VOLUME}&sort=cover_date:asc&limit=100&field_list=id,issue_number,image`
  const res = await fetch(url, { headers: { 'User-Agent': 'catch-comics issue-cover ingest' } })
  if (!res.ok) { console.error(`CV API ${res.status}`); process.exit(1) }
  const issues: CvIssue[] = ((await res.json()) as { results?: CvIssue[] }).results ?? []
  console.log(`\nVolume ${VOLUME}: ${issues.length} issues from ComicVine · mode: ${WRITE ? 'WRITE' : 'DRY RUN'}\n`)

  const checkpoint = loadJson<Record<string, string>>(CHECKPOINT, {})
  const results: Array<{ issue: number; number: string; outcome: string }> = []
  let attempted = 0, accepted = 0, rejected = 0, skipped = 0

  for (const issue of issues) {
    if (attempted >= LIMIT) break
    const src = issue.image?.medium_url || issue.image?.original_url || issue.image?.small_url
    const key = issueCoverR2Key(issue.id)

    if (!src) { results.push({ issue: issue.id, number: issue.issue_number, outcome: 'rejected: no-source-image' }); rejected++; continue }
    if (checkpoint[key] === 'stored' || await r2ObjectExists(key)) {
      results.push({ issue: issue.id, number: issue.issue_number, outcome: 'skipped: already-on-r2' }); skipped++; continue
    }

    attempted++
    if (!WRITE) { results.push({ issue: issue.id, number: issue.issue_number, outcome: `dry-run: would fetch ${src.slice(0, 70)}` }); continue }

    const r = await downloadAndStoreIssueCover(issue.id, src)
    if ('stored' in r) {
      accepted++; checkpoint[key] = 'stored'
      results.push({ issue: issue.id, number: issue.issue_number, outcome: `stored: ${r.stored}` })
    } else {
      rejected++
      results.push({ issue: issue.id, number: issue.issue_number, outcome: `rejected: ${r.rejected}` })
    }
    writeFileSync(CHECKPOINT, JSON.stringify(checkpoint, null, 2))
    await new Promise(r2 => setTimeout(r2, 500)) // politeness between CDN fetches
  }

  for (const r of results) console.log(`  #${r.number.padEnd(5)} cv-${r.issue}  ${r.outcome}`)
  console.log(`\n  attempted=${attempted} accepted=${accepted} rejected=${rejected} skipped(existing)=${skipped} of ${issues.length} issues`)

  if (WRITE) {
    mkdirSync(join(process.cwd(), 'launch', 'operations'), { recursive: true })
    const manifest = loadJson<Record<string, unknown>>(MANIFEST, { version: 1, volumes: {} }) as {
      version: number; volumes: Record<string, unknown>
    }
    manifest.volumes[VOLUME!] = {
      at: new Date().toISOString(), issues: issues.length,
      attempted, accepted, rejected, skippedExisting: skipped,
      rejections: results.filter(r => r.outcome.startsWith('rejected')).map(r => ({ issue: r.issue, reason: r.outcome })),
    }
    writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2))
    console.log(`  manifest → launch/operations/issue-covers-manifest.json`)
  }
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
