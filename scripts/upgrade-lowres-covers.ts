/**
 * upgrade-lowres-covers.ts — site-wide recovery of LOW-RESOLUTION stored covers
 * from EXACT-IDENTITY sources only.
 *
 * WHY: a 64-byte-header census of every stored R2 cover (audit-cover-resolution.ts,
 * 2026-09-26) found 10,067 of 27,730 are 200x200 white-letterboxed retailer
 * thumbnails (the AWIN productserve images that seeded covers before that writer
 * was fixed) — ~133px of real artwork, rendered in ~100 CSS px slots on 2x/3x
 * phones. The earlier HD migrations (upgrade-cover-resolution.ts,
 * trim-square-covers.ts) only looked at typed formats with a LIVE Shopify
 * listing, so format=OTHER products and every product whose listings had aged
 * out (feeds soft-delete after 30 days) were never upgraded.
 *
 * COHORT: live products, stored R2 cover, ISBN-13 present, artwork width < 300px.
 *
 * SOURCES (all keyed to the product's OWN ISBN-13 — never title similarity):
 *   1. Shopify retailer images from listings carrying the SAME ISBN-13 (live or
 *      soft-deleted — an image does not change identity when a price expires)
 *   2. Waterstones ISBN jacket (bookjackets/large) — the original the stored
 *      200px AWIN thumbnail was cut from
 *   3. Open Library by ISBN (--with-ol; rate-limited, throttled)
 *
 * GATES (all must pass — STRICTLY upgrade-only, identity before quality):
 *   1. Source decodes; square sources must letterbox-trim to a full-height
 *      portrait (never a crop into artwork); final aspect in [1.2, 1.75]
 *   2. Not a known placeholder (shared content hashes; HTTP 404 rejected)
 *   3. New width >= max(300px, 1.5x the stored artwork width)
 *   4. VISUAL IDENTITY: the candidate must match the artwork already stored for
 *      this product (normalised cross-correlation of the trimmed cover regions).
 *      Measured: same cover 0.74-0.99, different products <= 0.48.
 *      >= 0.85 auto-approved; < 0.70 rejected. 0.70-0.85 is approved only when
 *      the stored cover is a square letterboxed thumbnail AND the frame-faithful
 *      box comparison (boxSimilarity) is >= 0.95 — measured over 4,830
 *      different-product pairs its maximum was 0.595. The rest of that band goes
 *      to a review contact sheet and is written only with --approve-review.
 *
 * FLOW:
 *   DRY-RUN  — evaluates the cohort, stages processed bytes, writes a manifest
 *              + contact sheets for visual review. No R2 or DB writes.
 *   EXECUTE  — consumes ONLY the manifest; verifies each staged file's hash
 *              equals the reviewed sig and that the product's cover has not
 *              changed since the dry-run; backs up the old R2 bytes, overwrites
 *              covers/{id}.webp and bumps cover_image_url ?v=<sig>. Every write is
 *              appended to a crash-safe JSONL log (reversible).
 *
 *   npx dotenv -e .env.local -- tsx scripts/upgrade-lowres-covers.ts [--title "blade runner%"] [--limit N] [--with-ol]
 *   npx dotenv -e .env.local -- tsx scripts/upgrade-lowres-covers.ts --rescore   # re-apply the gate to the manifest
 *   npx dotenv -e .env.local -- tsx scripts/upgrade-lowres-covers.ts --execute [--approve-review]
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
import { webpDims, effectiveCoverWidth } from '../lib/images/webp-dims'

const argv = process.argv.slice(2)
const EXECUTE = argv.includes('--execute')
const APPROVE_REVIEW = argv.includes('--approve-review')
const RESCORE = argv.includes('--rescore')
const WITH_OL = argv.includes('--with-ol')
const arg = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined }
const TITLE = arg('--title')
const LIMIT = parseInt(arg('--limit') ?? '0', 10)

const TARGET_WIDTH = 1000
const WEBP_Q = 85
const MAX_EFF = 300                  // cohort: stored artwork narrower than this
const MIN_NEW = 300                  // an upgrade must reach at least this…
const MIN_GAIN = 1.5                 // …and be 1.5x the stored artwork width
const GOOD_ENOUGH = 600              // stop trying further sources once reached
const ASPECT_MIN = 1.2, ASPECT_MAX = 1.75
const SIM_AUTO = 0.85, SIM_REVIEW = 0.70, BOX_AUTO = 0.95
const CONCURRENCY = EXECUTE ? 6 : 10
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }

const WORK = path.join(__dirname, '.cover-lowres')
const STAGING = path.join(WORK, 'staging')
const BACKUP = path.join(WORK, 'backup')
const MANIFEST = path.join(WORK, 'manifest.json')
const PROOF_DIR = path.join(os.tmpdir(), 'cover-lowres-proof')

type Source = 'shopify' | 'waterstones' | 'openlibrary'
interface Entry {
  id: string; title: string; isbn: string; oldUrl: string; oldW: number; oldH: number; oldEff: number
  src: string; kind: Source; newW: number; newH: number; sim: number; boxSim?: number; sig: string; review: boolean
}

async function fetchBuf(url: string, headers: Record<string, string> = UA): Promise<Buffer | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20000), headers, redirect: 'follow' })
    if (!r.ok) return null
    return Buffer.from(await r.arrayBuffer())
  } catch { return null }
}

async function storedDims(url: string): Promise<{ w: number; h: number } | null> {
  const b = await fetchBuf(url, { ...UA, Range: 'bytes=0-63' })
  return b ? webpDims(b) : null
}

/** 24x36 grayscale vector of the cover region (white letterbox trimmed). */
async function coverVector(b: Buffer): Promise<number[]> {
  let src = await sharp(b).flatten({ background: '#ffffff' }).toBuffer()
  try { src = await sharp(src).trim({ threshold: 20 }).toBuffer() } catch { /* nothing to trim */ }
  return Array.from(await sharp(src).resize(24, 36, { fit: 'fill' }).grayscale().raw().toBuffer())
}

/**
 * Frame-faithful comparison for LETTERBOXED stored covers: render the candidate
 * the way the stored thumbnail was made (fit inside the stored WxH on white),
 * then compare only the box where its artwork lands. Unlike coverVector's
 * white-trim this does not eat into covers whose own art has white areas
 * (Black Butler, Saga, Invincible). Bars are excluded, so shared white bars
 * cannot inflate the score for unrelated products.
 */
async function boxSimilarity(oldBuf: Buffer, oldW: number, oldH: number, cand: Buffer): Promise<number> {
  const cm = await sharp(cand).metadata()
  const s = Math.min(oldW / (cm.width || 1), oldH / (cm.height || 1))
  const bw = Math.max(1, Math.min(oldW, Math.round((cm.width ?? 0) * s))), bh = Math.max(1, Math.min(oldH, Math.round((cm.height ?? 0) * s)))
  const box = { left: Math.floor((oldW - bw) / 2), top: Math.floor((oldH - bh) / 2), width: bw, height: bh }
  const vec = async (b: Buffer) => {
    const framed = await sharp(b).flatten({ background: '#ffffff' }).resize(oldW, oldH, { fit: 'contain', background: '#ffffff' }).toBuffer()
    const cropped = await sharp(framed).extract(box).toBuffer()
    return Array.from(await sharp(cropped).resize(24, 36, { fit: 'fill' }).grayscale().raw().toBuffer())
  }
  return ncc(await vec(oldBuf), await vec(cand))
}

/** Square stored frames are letterboxed thumbnails — the case the box metric is calibrated for. */
const isLetterboxed = (w: number, h: number) => Math.abs(h / w - 1) < 0.05

export function ncc(a: number[], b: number[]): number {
  const ma = a.reduce((s, x) => s + x, 0) / a.length, mb = b.reduce((s, x) => s + x, 0) / b.length
  let num = 0, da = 0, db = 0
  for (let i = 0; i < a.length; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2 }
  return da && db ? num / Math.sqrt(da * db) : 0
}

/** Normalise one source into a stored cover, or say why not. */
async function derive(buf: Buffer): Promise<{ processed: Buffer; sig: string; w: number; h: number } | string> {
  try {
    const m = await sharp(buf).metadata()
    const w = m.width ?? 0, h = m.height ?? 0
    if (w < 100 || h < 100) return 'tiny'
    let working = buf
    const aspect = h / w
    if (aspect >= 0.9 && aspect <= 1.1) {
      // Square retailer image: keep only a pillarbox trim (side bars removed,
      // full height retained) — never a crop into the artwork.
      const t = await sharp(buf).flatten({ background: '#ffffff' }).trim({ threshold: 25 }).toBuffer()
      const tm = await sharp(t).metadata()
      if ((tm.height ?? 0) < Math.round(h * 0.92)) return 'square-not-pillarbox'
      working = t
    }
    const wm = await sharp(working).metadata()
    const wa = (wm.height ?? 0) / (wm.width || 1)
    if (wa < ASPECT_MIN || wa > ASPECT_MAX) return `aspect ${wa.toFixed(2)}`
    const processed = await sharp(working).resize(TARGET_WIDTH, undefined, { fit: 'inside', withoutEnlargement: true }).webp({ quality: WEBP_Q }).toBuffer()
    const sig = crypto.createHash('sha256').update(processed).digest('hex').slice(0, 16)
    if (PLACEHOLDER_HASHES.has(sig)) return 'placeholder'
    const pm = await sharp(processed).metadata()
    return { processed, sig, w: pm.width ?? 0, h: pm.height ?? 0 }
  } catch { return 'decode-error' }
}

/** Largest-first ordering for Shopify variants (_SL1500 / 1500x1500 hints). */
const sizeHint = (u: string) => parseInt(u.match(/_SL(\d+)/i)?.[1] ?? u.match(/_(\d+)x\1/)?.[1] ?? '0', 10)
const waterstonesUrl = (isbn: string) => `https://cdn.waterstones.com/bookjackets/large/${isbn.slice(0, 4)}/${isbn.slice(4, 8)}/${isbn}.jpg`
let olNext = 0
async function olThrottle() { const wait = olNext - Date.now(); olNext = Math.max(Date.now(), olNext) + 3200; if (wait > 0) await new Promise(r => setTimeout(r, wait)) }

async function pool<T>(items: T[], n: number, fn: (t: T, i: number) => Promise<void>) {
  let i = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k) } }))
}

/** Side-by-side proof: stored (left) vs candidate (right), 6 pairs per row. */
async function contactSheet(entries: Entry[], file: string) {
  if (!entries.length) return
  const PW = 110, PH = 165, GAP = 8, PER = 6
  const tiles: sharp.OverlayOptions[] = []
  for (let k = 0; k < entries.length; k++) {
    const e = entries[k]
    const x = (k % PER) * (PW * 2 + GAP * 3), y = Math.floor(k / PER) * (PH + GAP)
    const old = await fetchBuf(e.oldUrl)
    const neu = fs.readFileSync(path.join(STAGING, `${e.id}.webp`))
    if (old) tiles.push({ input: await sharp(old).resize(PW, PH, { fit: 'contain', background: '#fff' }).png().toBuffer(), left: x, top: y })
    tiles.push({ input: await sharp(neu).resize(PW, PH, { fit: 'contain', background: '#fff' }).png().toBuffer(), left: x + PW + GAP, top: y })
  }
  const rows = Math.ceil(entries.length / PER)
  await sharp({ create: { width: PER * (PW * 2 + GAP * 3), height: rows * (PH + GAP), channels: 3, background: '#d0d0d0' } })
    .composite(tiles).png().toFile(file)
  console.log(`  contact sheet: ${file}`)
}

async function dryRun() {
  const where = TITLE ? `AND title ILIKE $1` : ''
  const rows = await prisma.$queryRawUnsafe<{ id: string; title: string; isbn: string; url: string }[]>(`
    SELECT id, title, isbn_13 AS isbn, cover_image_url AS url FROM canonical_products
     WHERE deleted_at IS NULL AND isbn_13 IS NOT NULL
       AND cover_image_url LIKE 'https://images.catchcomics.com/covers/%' ${where}
     ORDER BY id`, ...(TITLE ? [TITLE] : []))
  console.log(`Measuring ${rows.length.toLocaleString()} stored covers with an ISBN-13…`)

  const cohort: (typeof rows[number] & { w: number; h: number; eff: number })[] = []
  await pool(rows, 48, async r => {
    const d = await storedDims(r.url)
    if (!d) return
    const eff = effectiveCoverWidth(d.w, d.h)
    if (eff < MAX_EFF) cohort.push({ ...r, w: d.w, h: d.h, eff })
  })
  cohort.sort((a, b) => a.id.localeCompare(b.id))
  const work = LIMIT ? cohort.slice(0, LIMIT) : cohort
  console.log(`Low-res cohort (artwork < ${MAX_EFF}px): ${cohort.length.toLocaleString()}  → evaluating ${work.length.toLocaleString()}  [DRY-RUN${WITH_OL ? ' +OL' : ''}]\n`)

  // All Shopify images carrying each cohort ISBN — one query, not N.
  const shop = new Map<string, string[]>()
  const isbns = [...new Set(work.map(r => r.isbn))]
  for (let i = 0; i < isbns.length; i += 2000) {
    const part = await prisma.$queryRawUnsafe<{ isbn: string; urls: string[] }[]>(`
      SELECT isbn_13 AS isbn, array_agg(DISTINCT image_url) AS urls FROM retailer_listings
       WHERE isbn_13 = ANY($1::text[]) AND image_url LIKE 'https://cdn.shopify.com/%' GROUP BY isbn_13`, isbns.slice(i, i + 2000))
    for (const p of part) shop.set(p.isbn, p.urls.sort((a, b) => sizeHint(b) - sizeHint(a)).slice(0, 3))
  }

  fs.mkdirSync(STAGING, { recursive: true })
  fs.mkdirSync(PROOF_DIR, { recursive: true })
  const manifest: Entry[] = []
  const stats: Record<string, number> = {}
  const bump = (k: string) => { stats[k] = (stats[k] ?? 0) + 1 }
  let done = 0

  await pool(work, CONCURRENCY, async p => {
    try {
      const oldBuf = await fetchBuf(p.url)
      if (!oldBuf) { bump('skip: stored cover unreadable'); return }
      const oldVec = await coverVector(oldBuf)
      const need = Math.max(MIN_NEW, Math.ceil(p.eff * MIN_GAIN))

      const sources: { kind: Source; url: string }[] = [
        ...(shop.get(p.isbn) ?? []).map(url => ({ kind: 'shopify' as const, url })),
        { kind: 'waterstones', url: waterstonesUrl(p.isbn) },
        ...(WITH_OL ? [{ kind: 'openlibrary' as const, url: `https://covers.openlibrary.org/b/isbn/${p.isbn}-L.jpg?default=false` }] : []),
      ]
      let best: (Entry & { processed: Buffer }) | null = null
      let lastReason = 'no source'
      for (const s of sources) {
        if (best && best.newW >= GOOD_ENOUGH) break
        if (s.kind === 'openlibrary') { if (best) break; await olThrottle() }
        const buf = await fetchBuf(s.url)
        if (!buf) { lastReason = `${s.kind}: unavailable`; continue }
        const d = await derive(buf)
        if (typeof d === 'string') { lastReason = `${s.kind}: ${d}`; continue }
        if (d.w < need) { lastReason = `${s.kind}: not bigger (${d.w} < ${need})`; continue }
        const sim = ncc(oldVec, await coverVector(d.processed))
        if (sim < SIM_REVIEW) { lastReason = `${s.kind}: different artwork (sim ${sim.toFixed(2)})`; continue }
        const boxSim = sim < SIM_AUTO && isLetterboxed(p.w, p.h) ? await boxSimilarity(oldBuf, p.w, p.h, d.processed) : undefined
        const cand = { id: p.id, title: p.title, isbn: p.isbn, oldUrl: p.url, oldW: p.w, oldH: p.h, oldEff: p.eff,
          src: s.url, kind: s.kind, newW: d.w, newH: d.h, sim: +sim.toFixed(3), boxSim: boxSim === undefined ? undefined : +boxSim.toFixed(3),
          sig: d.sig, review: sim < SIM_AUTO && !(boxSim !== undefined && boxSim >= BOX_AUTO), processed: d.processed }
        // Prefer auto-approvable over review-band; then the larger image.
        if (!best || (best.review && !cand.review) || (best.review === cand.review && cand.newW > best.newW)) best = cand
      }
      if (!best) { bump(`skip: ${lastReason.replace(/\(.*\)/, '').replace(/\d+/g, '').trim()}`); return }
      fs.writeFileSync(path.join(STAGING, `${p.id}.webp`), best.processed)
      const { processed: _drop, ...entry } = best
      void _drop
      manifest.push(entry)
      bump(`${best.review ? 'REVIEW' : 'UPGRADE'} via ${best.kind}`)
    } catch { bump('skip: error') } finally {
      if (++done % 500 === 0) console.log(`  … ${done}/${work.length}  (${manifest.length} upgrades staged)`)
    }
  })

  manifest.sort((a, b) => a.id.localeCompare(b.id))
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1))
  const auto = manifest.filter(e => !e.review), review = manifest.filter(e => e.review)
  const avg = (xs: number[]) => xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : 0
  console.log(`\n── OUTCOME (${work.length} evaluated) ──`)
  for (const [k, v] of Object.entries(stats).sort()) console.log(`   ${k.padEnd(44)} ${v}`)
  console.log(`\n   auto-approved: ${auto.length}   review band: ${review.length}`)
  console.log(`   artwork width  before avg ${avg(manifest.map(e => e.oldEff))}px  →  after avg ${avg(manifest.map(e => e.newW))}px`)
  const kb = manifest.map(e => fs.statSync(path.join(STAGING, `${e.id}.webp`)).size / 1024)
  console.log(`   staged file size avg ${avg(kb)}KB, max ${Math.round(Math.max(0, ...kb))}KB`)
  console.log(`   manifest: ${MANIFEST}`)
  const pick = [...auto].sort(() => Math.random() - 0.5).slice(0, 36)
  await contactSheet(pick, path.join(PROOF_DIR, 'auto-sample.png'))
  await contactSheet([...review].sort((a, b) => a.sim - b.sim).slice(0, 60), path.join(PROOF_DIR, 'review-band.png'))
}

async function execute() {
  const manifest: Entry[] = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'))
  const todo = manifest.filter(e => !e.review || APPROVE_REVIEW)
  console.log(`EXECUTE: ${todo.length} of ${manifest.length} manifest entries${APPROVE_REVIEW ? ' (review band approved)' : ' (review band held back)'}`)
  fs.mkdirSync(BACKUP, { recursive: true })
  const logPath = path.join(WORK, `log-${Date.now()}.jsonl`)
  const stats = { written: 0, sig_mismatch: 0, cover_changed: 0, backup_failed: 0, error: 0 }

  await pool(todo, CONCURRENCY, async e => {
    try {
      const staged = fs.readFileSync(path.join(STAGING, `${e.id}.webp`))
      if (crypto.createHash('sha256').update(staged).digest('hex').slice(0, 16) !== e.sig) { stats.sig_mismatch++; return }
      const cur = await prisma.canonicalProduct.findUnique({ where: { id: e.id }, select: { coverImageUrl: true, deletedAt: true } })
      if (!cur || cur.deletedAt || cur.coverImageUrl !== e.oldUrl) { stats.cover_changed++; return }
      const old = await fetchBuf(e.oldUrl)
      if (!old) { stats.backup_failed++; return }
      const backupPath = path.join(BACKUP, `${e.id}.webp`)
      fs.writeFileSync(backupPath, old)
      await r2Client.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: `covers/${e.id}.webp`, Body: staged, ContentType: 'image/webp' }))
      const newUrl = `${R2_PUBLIC_URL}/covers/${e.id}.webp?v=${e.sig.slice(0, 8)}`
      await prisma.canonicalProduct.update({ where: { id: e.id }, data: { coverImageUrl: newUrl, updatedAt: new Date() } })
      fs.appendFileSync(logPath, JSON.stringify({ id: e.id, title: e.title, isbn: e.isbn, oldUrl: e.oldUrl, newUrl, oldEff: e.oldEff, newW: e.newW, src: e.src, sim: e.sim, backup: backupPath, at: new Date().toISOString() }) + '\n')
      if (++stats.written % 250 === 0) console.log(`  … ${stats.written} written`)
    } catch (err) { stats.error++; console.error(`  ! ${e.id}: ${(err as Error).message}`) }
  })
  console.log(`\n── EXECUTED ──`, stats, `\n   log: ${logPath}`)
}

/** Re-apply the identity gate to an existing manifest (review-band rows only; no network writes). */
async function rescore() {
  const manifest: Entry[] = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'))
  let promoted = 0, checked = 0
  await pool(manifest.filter(e => e.review && isLetterboxed(e.oldW, e.oldH)), CONCURRENCY, async e => {
    const old = await fetchBuf(e.oldUrl)
    if (!old) return
    checked++
    e.boxSim = +(await boxSimilarity(old, e.oldW, e.oldH, fs.readFileSync(path.join(STAGING, `${e.id}.webp`)))).toFixed(3)
    if (e.boxSim >= BOX_AUTO) { e.review = false; promoted++ }
  })
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1))
  console.log(`RESCORE: ${checked} letterboxed review rows checked, ${promoted} promoted (box >= ${BOX_AUTO}); still in review: ${manifest.filter(e => e.review).length}`)
  await contactSheet(manifest.filter(e => e.boxSim !== undefined && !e.review).sort((a, b) => (a.boxSim ?? 0) - (b.boxSim ?? 0)).slice(0, 60), path.join(PROOF_DIR, 'promoted-lowest.png'))
}

(EXECUTE ? execute() : RESCORE ? rescore() : dryRun())
  .catch(e => { console.error('ERR', e); process.exit(1) })
  .finally(() => prisma.$disconnect())
