/**
 * trim-square-covers.ts — Fix A: recover HD covers from SQUARE letterboxed
 * Shopify sources (cohort 1, ~80 products).
 *
 * Some Shopify stores serve hi-res covers as 2400x2400 / 1500x1500 SQUARES with
 * white letterbox bars. The HD migration's aspect gate [1.2,1.7] correctly
 * refused to store squares — but rejected these recoverable sources entirely,
 * leaving the products at their legacy 150-338px covers (incl. homepage deals).
 *
 * This pass: fetch square source → sharp.trim() the letterbox → RE-VALIDATE the
 * trimmed aspect is a real comic portrait [1.2,1.7] → resize 1000px → webp q85.
 *
 * GATES (all must pass — STRICTLY upgrade-only):
 *   1. Source is cdn.shopify.com and near-square (h/w in [0.9,1.1]) and >=800px
 *   2. Post-trim aspect in [1.2,1.7]  (else skip — never store a bad trim)
 *   3. Not a known placeholder (content hash)
 *   4. New processed width STRICTLY > existing stored width
 *
 * Dry-run writes every trimmed candidate to a proof dir + builds a CONTACT SHEET
 * for visual review before any write. Execute writes R2 + DB with a reversible log.
 *
 *   npx dotenv -e .env.local -- tsx scripts/trim-square-covers.ts            # dry-run + contact sheet
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

const EXECUTE = process.argv.includes('--execute')
const TARGET_WIDTH = 1000
const WEBP_Q = 85
const SQ_MIN = 0.9, SQ_MAX = 1.1          // near-square source
const ASPECT_MIN = 1.2, ASPECT_MAX = 1.7  // valid comic portrait post-trim
const MIN_SOURCE_PX = 800                  // only hi-res squares are worth trimming
const TRIM_THRESHOLD = 25                  // tolerant of off-white letterbox bars
const PLACEHOLDER_HASHES = new Set(['06661fd690879985', '2cafc2b0f16dfe03', '307a2fbbc46139a8', 'b3165c10e262603d', 'f2161a2b764f9dd6', '61a456d23edb8d69'])
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
const PROOF_DIR = path.join(os.tmpdir(), 'trim-proof')

async function fetchBuf(url: string): Promise<Buffer | null> {
  try { const r = await fetch(url, { signal: AbortSignal.timeout(20000), headers: UA }); if (!r.ok) return null; return Buffer.from(await r.arrayBuffer()) } catch { return null }
}
async function storedWidth(url: string): Promise<number> {
  const b = await fetchBuf(url); if (!b) return -1
  try { return (await sharp(b).metadata()).width ?? -1 } catch { return -1 }
}
/** Prefer the largest square variant (2400x2400 > 1500x1500 > ...). */
function rankSquare(u: string): number { return parseInt(u.match(/_(\d+)x\1/)?.[1] ?? '0', 10) }

interface Log { id: string; title: string; oldCover: string | null; newCover: string; oldWidth: number; newWidth: number; src: string }
const log: Log[] = []
const stats = { candidates: 0, upgraded: 0, skip_not_square: 0, skip_small_source: 0, skip_bad_trim_aspect: 0, skip_not_bigger: 0, skip_placeholder: 0, skip_fetch: 0,
  beforeW: [] as number[], afterW: [] as number[] }
const proofs: { id: string; title: string; buf: Buffer }[] = []

async function processOne(p: { id: string; title: string; coverImageUrl: string | null; listings: { imageUrl: string | null }[] }) {
  const squares = [...new Set(p.listings.map(l => l.imageUrl).filter((u): u is string => !!u && u.includes('cdn.shopify.com')))]
    .sort((a, b) => rankSquare(b) - rankSquare(a))
  if (!squares.length) { stats.skip_fetch++; return }

  for (const src of squares) {
    const buf = await fetchBuf(src)
    if (!buf) continue
    let meta; try { meta = await sharp(buf).metadata() } catch { continue }
    const w = meta.width ?? 0, h = meta.height ?? 0
    if (w < MIN_SOURCE_PX || h < MIN_SOURCE_PX) { stats.skip_small_source++; continue }
    const srcAspect = h / w
    if (srcAspect < SQ_MIN || srcAspect > SQ_MAX) { stats.skip_not_square++; continue }

    // Trim the letterbox, then RE-VALIDATE the result is a genuine comic portrait
    let trimmed: Buffer
    try { trimmed = await sharp(buf).flatten({ background: '#ffffff' }).trim({ threshold: TRIM_THRESHOLD }).toBuffer() } catch { continue }
    let tm; try { tm = await sharp(trimmed).metadata() } catch { continue }
    const tw = tm.width ?? 0, th = tm.height ?? 0
    const tAspect = th / (tw || 1)
    if (tw < 300 || tAspect < ASPECT_MIN || tAspect > ASPECT_MAX) { stats.skip_bad_trim_aspect++; continue }

    const processed = await sharp(trimmed).resize(TARGET_WIDTH, undefined, { fit: 'inside', withoutEnlargement: true }).webp({ quality: WEBP_Q }).toBuffer()
    const sig = crypto.createHash('sha256').update(processed).digest('hex').slice(0, 16)
    if (PLACEHOLDER_HASHES.has(sig)) { stats.skip_placeholder++; continue }
    const procW = (await sharp(processed).metadata()).width ?? 0

    const oldW = p.coverImageUrl ? await storedWidth(p.coverImageUrl) : 0
    if (!(procW > oldW)) { stats.skip_not_bigger++; return }   // STRICT upgrade-only

    stats.upgraded++; stats.beforeW.push(Math.max(oldW, 0)); stats.afterW.push(procW)

    if (!EXECUTE) {
      proofs.push({ id: p.id, title: p.title, buf: processed })
      console.log(`  ✓ would upgrade ${String(oldW).padStart(4)}px → ${procW}px (trim ${w}x${h} → ${tw}x${th})  ${p.title.slice(0, 44)}`)
      return
    }

    const key = `covers/${p.id}.webp`
    const newCover = `${R2_PUBLIC_URL}/${key}?v=${sig.slice(0, 8)}`
    await r2Client.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, Body: processed, ContentType: 'image/webp' }))
    await prisma.canonicalProduct.update({ where: { id: p.id }, data: { coverImageUrl: newCover, updatedAt: new Date() } })
    log.push({ id: p.id, title: p.title, oldCover: p.coverImageUrl, newCover, oldWidth: oldW, newWidth: procW, src })
    console.log(`  ✓ upgraded ${String(oldW).padStart(4)}px → ${procW}px  ${p.title.slice(0, 48)}`)
    return
  }
}

/** Build a contact sheet (grid of thumbnails) from the dry-run proofs. */
async function contactSheet(items: { buf: Buffer }[]): Promise<string> {
  const CW = 150, CH = 225, COLS = 8
  const rows = Math.ceil(items.length / COLS)
  const cells = await Promise.all(items.map(async (it, i) => ({
    input: await sharp(it.buf).resize(CW, CH, { fit: 'contain', background: '#f3f4f6' }).png().toBuffer(),
    left: (i % COLS) * (CW + 6) + 6,
    top: Math.floor(i / COLS) * (CH + 6) + 6,
  })))
  const out = path.join(PROOF_DIR, 'contact-sheet.png')
  await sharp({ create: { width: COLS * (CW + 6) + 6, height: rows * (CH + 6) + 6, channels: 3, background: '#ffffff' } })
    .composite(cells).png().toFile(out)
  return out
}

async function main() {
  // Cohort-1 prefilter (same definition the diagnosis sized at ~80): typed comic,
  // R2 cover NOT yet HD-upgraded, and a square hi-res Shopify listing image.
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
  stats.candidates = prods.length
  console.log(`Candidates (cohort 1 — square hi-res Shopify, not yet upgraded): ${prods.length}  [${EXECUTE ? 'EXECUTE' : 'DRY-RUN'}]\n`)

  if (!EXECUTE) { fs.mkdirSync(PROOF_DIR, { recursive: true }) }
  for (const p of prods) await processOne(p)

  const avg = (a: number[]) => a.length ? Math.round(a.reduce((s, x) => s + x, 0) / a.length) : 0
  console.log(`\n── ${EXECUTE ? 'UPGRADED' : 'WOULD UPGRADE'}: ${stats.upgraded} of ${stats.candidates} ──`)
  console.log(`   avg width before: ${avg(stats.beforeW)}px   →   after: ${avg(stats.afterW)}px`)
  console.log(`── SKIPPED ──`)
  console.log(`   source not square    : ${stats.skip_not_square}`)
  console.log(`   source too small     : ${stats.skip_small_source}`)
  console.log(`   bad post-trim aspect : ${stats.skip_bad_trim_aspect}`)
  console.log(`   not strictly bigger  : ${stats.skip_not_bigger}`)
  console.log(`   placeholder hash     : ${stats.skip_placeholder}`)
  console.log(`   no fetchable source  : ${stats.skip_fetch}`)

  if (!EXECUTE && proofs.length) {
    const sheet = await contactSheet(proofs)
    console.log(`\nContact sheet (${proofs.length} trimmed candidates): ${sheet}`)
  }
  if (EXECUTE && log.length) {
    const lp = path.join(__dirname, `.cover-trim-log-${Date.now()}.json`)
    fs.writeFileSync(lp, JSON.stringify(log, null, 2))
    console.log(`\nReversible log (${log.length}): ${path.basename(lp)}`)
  }
  await prisma.$disconnect()
}
main().catch(e => { console.error('ERR', e); process.exit(1) }).finally(() => prisma.$disconnect())
