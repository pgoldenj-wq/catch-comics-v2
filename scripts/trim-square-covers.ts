/**
 * trim-square-covers.ts — Fix A: recover HD covers from SQUARE letterboxed
 * Shopify sources (cohort 1, ~80 products).
 *
 * Some Shopify stores serve hi-res covers as 2400x2400 / 1500x1500 SQUARES with
 * white letterbox bars. The HD migration's aspect gate [1.2,1.7] correctly
 * refused to store squares — but rejected these recoverable sources entirely,
 * leaving the products at their legacy 150-400px covers (incl. homepage deals).
 *
 * Flow (CE-review hardened):
 *   DRY-RUN  — evaluate all candidates through the gates, build a contact sheet
 *              for visual review, and write an APPROVED MANIFEST [{id, src, sig}].
 *   EXECUTE  — consumes ONLY the manifest: re-derives each entry and writes only
 *              when the recomputed content hash equals the reviewed sig, so what
 *              was visually approved is exactly what reaches production.
 *
 * GATES (all must pass — STRICTLY upgrade-only):
 *   1. Source is cdn.shopify.com, near-square (h/w in [0.9,1.1]), >= 800px
 *   2. Post-trim: width >= 300, aspect in [1.2,1.7], AND >= 92% of source
 *      height retained (pillarbox removal only — never a crop into artwork)
 *   3. Not a known placeholder (shared content-hash set from lib/images/download)
 *   4. New processed width STRICTLY > existing stored width; if the stored
 *      cover cannot be fetched/measured, SKIP (never write on unknown oldW)
 *
 * Reversibility: before each overwrite the OLD R2 bytes are saved to
 * scripts/.cover-trim-backup/{id}.webp and every write is appended immediately
 * to a JSONL log (crash-safe) with old/new URLs, widths, source and backup path.
 *
 *   npx dotenv -e .env.local -- tsx scripts/trim-square-covers.ts            # dry-run
 *   npx dotenv -e .env.local -- tsx scripts/trim-square-covers.ts --execute  # mutate
 */
import fs from 'fs'
import path from 'path'
import os from 'os'
import crypto from 'crypto'
import sharp from 'sharp'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { prisma } from '../lib/prisma'
import { r2Client, R2_BUCKET, R2_PUBLIC_URL } from '../lib/images/r2'
import { PLACEHOLDER_HASHES } from '../lib/images/download'

const EXECUTE = process.argv.includes('--execute')
const TARGET_WIDTH = 1000
const WEBP_Q = 85
const SQ_MIN = 0.9, SQ_MAX = 1.1
const ASPECT_MIN = 1.2, ASPECT_MAX = 1.7
const MIN_SOURCE_PX = 800
const HEIGHT_RETENTION = 0.92
const TRIM_THRESHOLD = 25
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
const PROOF_DIR = path.join(os.tmpdir(), 'trim-proof')
const MANIFEST = path.join(PROOF_DIR, 'manifest.json')
const BACKUP_DIR = path.join(__dirname, '.cover-trim-backup')
const LOG_PATH = path.join(__dirname, `.cover-trim-log-${Date.now()}.jsonl`)

interface ManifestEntry { id: string; title: string; src: string; sig: string; oldWidth: number; newWidth: number }

async function fetchBuf(url: string): Promise<Buffer | null> {
  try { const r = await fetch(url, { signal: AbortSignal.timeout(20000), headers: UA }); if (!r.ok) return null; return Buffer.from(await r.arrayBuffer()) } catch { return null }
}
/** Prefer the largest square variant (2400x2400 > 1500x1500 > unsized last). */
function rankSquare(u: string): number { return parseInt(u.match(/_(\d+)x\1/)?.[1] ?? '0', 10) }

/** Run one source through trim + gates. Returns processed webp or a skip reason. */
async function deriveTrimmed(srcBuf: Buffer): Promise<{ ok: true; processed: Buffer; sig: string; procW: number; note: string } | { ok: false; reason: 'small' | 'not_square' | 'bad_trim' | 'placeholder' | 'error' }> {
  try {
    const meta = await sharp(srcBuf).metadata()
    const w = meta.width ?? 0, h = meta.height ?? 0
    if (w < MIN_SOURCE_PX || h < MIN_SOURCE_PX) return { ok: false, reason: 'small' }
    const srcAspect = h / w
    if (srcAspect < SQ_MIN || srcAspect > SQ_MAX) return { ok: false, reason: 'not_square' }

    const trimmed = await sharp(srcBuf).flatten({ background: '#ffffff' }).trim({ threshold: TRIM_THRESHOLD }).toBuffer()
    const tm = await sharp(trimmed).metadata()
    const tw = tm.width ?? 0, th = tm.height ?? 0
    const tAspect = th / (tw || 1)
    // Pillarbox-shaped trims only: full height retained (never a crop into art)
    if (tw < 300 || th < Math.round(h * HEIGHT_RETENTION) || tAspect < ASPECT_MIN || tAspect > ASPECT_MAX) return { ok: false, reason: 'bad_trim' }

    const processed = await sharp(trimmed).resize(TARGET_WIDTH, undefined, { fit: 'inside', withoutEnlargement: true }).webp({ quality: WEBP_Q }).toBuffer()
    const sig = crypto.createHash('sha256').update(processed).digest('hex').slice(0, 16)
    if (PLACEHOLDER_HASHES.has(sig)) return { ok: false, reason: 'placeholder' }
    const procW = (await sharp(processed).metadata()).width ?? 0
    return { ok: true, processed, sig, procW, note: `trim ${w}x${h} → ${tw}x${th}` }
  } catch { return { ok: false, reason: 'error' } }
}

// ── DRY-RUN: evaluate candidates, build contact sheet + approved manifest ─────
async function dryRun() {
  const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(`
    SELECT cp.id FROM canonical_products cp
    WHERE cp.deleted_at IS NULL
      AND cp.cover_image_url LIKE 'https://images.catchcomics.com/%'
      AND cp.cover_image_url NOT LIKE '%?v=%'
      AND cp.format::text IN ('SINGLE_ISSUE','TPB','HARDCOVER','OMNIBUS','DELUXE','COMPENDIUM','MANGA_VOLUME','ABSOLUTE')
      AND EXISTS(SELECT 1 FROM retailer_listings l WHERE l.canonical_product_id=cp.id AND l.deleted_at IS NULL
                  AND l.image_url LIKE '%cdn.shopify.com%'
                  AND (l.image_url LIKE '%2400x2400%' OR l.image_url LIKE '%1500x1500%' OR l.image_url LIKE '%1000x1000%'
                       OR l.image_url LIKE '%_800x800%' OR l.image_url LIKE '%_600x600%' OR l.image_url LIKE '%/1/0642/%'))`)
  const prods = await prisma.canonicalProduct.findMany({
    where: { id: { in: rows.map(r => r.id) } },
    select: { id: true, title: true, coverImageUrl: true, listings: { where: { deletedAt: null }, select: { imageUrl: true } } },
  })
  console.log(`Candidates (cohort 1 — square hi-res Shopify, not yet upgraded): ${prods.length}  [DRY-RUN]\n`)
  fs.mkdirSync(PROOF_DIR, { recursive: true })

  const manifest: ManifestEntry[] = []
  const proofs: Buffer[] = []
  // Per-PRODUCT outcome accounting (one increment per product)
  const outcome = { upgraded: 0, no_valid_trim: 0, oldw_unknown: 0, not_bigger: 0, no_source: 0 }

  for (const p of prods) {
    const squares = [...new Set(p.listings.map(l => l.imageUrl).filter((u): u is string => !!u && u.includes('cdn.shopify.com')))]
      .sort((a, b) => rankSquare(b) - rankSquare(a))
    if (!squares.length) { outcome.no_source++; continue }

    // Product-level oldW — fetched ONCE; unknown = skip (never bypass the gate)
    const oldBuf = p.coverImageUrl ? await fetchBuf(p.coverImageUrl) : null
    let oldW = -1
    if (oldBuf) { try { oldW = (await sharp(oldBuf).metadata()).width ?? -1 } catch { oldW = -1 } }
    if (p.coverImageUrl && oldW < 0) { outcome.oldw_unknown++; console.log(`  ? skip (stored cover unmeasurable)  ${p.title.slice(0, 44)}`); continue }
    if (!p.coverImageUrl) oldW = 0

    let done = false
    for (const src of squares) {
      const srcBuf = await fetchBuf(src)
      if (!srcBuf) continue
      const d = await deriveTrimmed(srcBuf)
      if (!d.ok) continue
      if (!(d.procW > oldW)) continue        // try next source — a different image may be bigger
      manifest.push({ id: p.id, title: p.title, src, sig: d.sig, oldWidth: oldW, newWidth: d.procW })
      proofs.push(d.processed)
      outcome.upgraded++
      console.log(`  ✓ would upgrade ${String(oldW).padStart(4)}px → ${d.procW}px (${d.note})  ${p.title.slice(0, 44)}`)
      done = true
      break
    }
    if (!done) { outcome.no_valid_trim++ }
  }

  console.log(`\n── WOULD UPGRADE: ${outcome.upgraded} of ${prods.length} ──`)
  const avgB = manifest.length ? Math.round(manifest.reduce((s, m) => s + m.oldWidth, 0) / manifest.length) : 0
  const avgA = manifest.length ? Math.round(manifest.reduce((s, m) => s + m.newWidth, 0) / manifest.length) : 0
  console.log(`   avg width before: ${avgB}px   →   after: ${avgA}px`)
  console.log(`── PER-PRODUCT OUTCOMES ──`)
  console.log(`   no valid trim from any source : ${outcome.no_valid_trim}`)
  console.log(`   stored width unmeasurable     : ${outcome.oldw_unknown}`)
  console.log(`   no shopify source             : ${outcome.no_source}`)
  console.log(`   (reconcile: ${outcome.upgraded + outcome.no_valid_trim + outcome.oldw_unknown + outcome.no_source}/${prods.length})`)

  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2))
  console.log(`\nApproved manifest (${manifest.length}): ${MANIFEST}`)

  if (proofs.length) {
    const CW = 150, CH = 225, COLS = 8
    const cells = await Promise.all(proofs.map(async (buf, i) => ({
      input: await sharp(buf).resize(CW, CH, { fit: 'contain', background: '#f3f4f6' }).png().toBuffer(),
      left: (i % COLS) * (CW + 6) + 6, top: Math.floor(i / COLS) * (CH + 6) + 6,
    })))
    const sheet = path.join(PROOF_DIR, 'contact-sheet.png')
    await sharp({ create: { width: COLS * (CW + 6) + 6, height: Math.ceil(proofs.length / COLS) * (CH + 6) + 6, channels: 3, background: '#ffffff' } })
      .composite(cells).png().toFile(sheet)
    console.log(`Contact sheet (${proofs.length}): ${sheet}`)
  }
}

// ── EXECUTE: consume the reviewed manifest; write only sig-matching results ───
async function execute() {
  if (!fs.existsSync(MANIFEST)) { console.error(`No manifest at ${MANIFEST} — run the dry-run first.`); process.exit(1) }
  const manifest: ManifestEntry[] = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'))
  console.log(`Executing approved manifest: ${manifest.length} entries  [EXECUTE]\n`)
  fs.mkdirSync(BACKUP_DIR, { recursive: true })

  let written = 0, sigMismatch = 0, gateSkip = 0, failed = 0
  for (const m of manifest) {
    try {
      const p = await prisma.canonicalProduct.findUnique({ where: { id: m.id }, select: { coverImageUrl: true } })
      if (!p) { gateSkip++; continue }
      // Re-measure stored cover; unknown = skip (TRIM-1)
      const oldBuf = p.coverImageUrl ? await fetchBuf(p.coverImageUrl) : null
      let oldW = -1
      if (oldBuf) { try { oldW = (await sharp(oldBuf).metadata()).width ?? -1 } catch { oldW = -1 } }
      if (p.coverImageUrl && oldW < 0) { gateSkip++; console.log(`  ? skip (stored unmeasurable)  ${m.title.slice(0, 40)}`); continue }
      if (!p.coverImageUrl) oldW = 0

      const srcBuf = await fetchBuf(m.src)
      if (!srcBuf) { failed++; console.log(`  ✗ source fetch failed  ${m.title.slice(0, 40)}`); continue }
      const d = await deriveTrimmed(srcBuf)
      if (!d.ok) { gateSkip++; console.log(`  ✗ gates no longer pass (${d.reason})  ${m.title.slice(0, 40)}`); continue }
      // Bind to the visual review: content must match what was on the contact sheet
      if (d.sig !== m.sig) { sigMismatch++; console.log(`  ✗ sig mismatch (source changed since review)  ${m.title.slice(0, 40)}`); continue }
      if (!(d.procW > oldW)) { gateSkip++; continue }   // strict upgrade-only

      // Reversibility: persist the OLD bytes before overwriting the R2 key
      const backupPath = path.join(BACKUP_DIR, `${m.id}.webp`)
      if (oldBuf) fs.writeFileSync(backupPath, oldBuf)

      const key = `covers/${m.id}.webp`
      const newCover = `${R2_PUBLIC_URL}/${key}?v=${d.sig.slice(0, 8)}`
      await r2Client.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, Body: d.processed, ContentType: 'image/webp' }))
      await prisma.canonicalProduct.update({ where: { id: m.id }, data: { coverImageUrl: newCover, updatedAt: new Date() } })
      // Crash-safe: append the log line immediately after the write (TRIM-2)
      fs.appendFileSync(LOG_PATH, JSON.stringify({ id: m.id, title: m.title, oldCover: p.coverImageUrl, newCover, oldWidth: oldW, newWidth: d.procW, src: m.src, backup: oldBuf ? backupPath : null }) + '\n')
      written++
      console.log(`  ✓ upgraded ${String(oldW).padStart(4)}px → ${d.procW}px  ${m.title.slice(0, 48)}`)
    } catch (e) {
      failed++
      console.error(`  ✗ error on ${m.id}: ${(e as Error).message}`)
    }
  }
  console.log(`\n── WRITTEN: ${written} of ${manifest.length} ──`)
  console.log(`   sig mismatch: ${sigMismatch}   gate re-check skip: ${gateSkip}   failed: ${failed}`)
  console.log(`   crash-safe log: ${LOG_PATH}`)
  console.log(`   old-bytes backups: ${BACKUP_DIR}`)
}

async function main() { if (EXECUTE) await execute(); else await dryRun() }
main().catch(e => { console.error('ERR', e); process.exit(1) }).finally(() => prisma.$disconnect())
