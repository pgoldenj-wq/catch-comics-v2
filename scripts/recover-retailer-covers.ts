/**
 * recover-retailer-covers.ts — promote retailer_listings.image_url → R2 cover for
 * COMIC-RELEVANT missing-cover products only (typed comic format OR classifyText
 * comic). Trust-first: we do NOT cover non-comic products (would beautify
 * pollution). Protections: placeholder-hash guard (in downloadAndStoreCover) +
 * duplicate/generic detection (same image hash on >=3 products) + dims>=50.
 *
 *   npx dotenv -e .env.local -- tsx scripts/recover-retailer-covers.ts            # dry-run
 *   npx dotenv -e .env.local -- tsx scripts/recover-retailer-covers.ts --execute
 */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import sharp from 'sharp'
import { prisma } from '../lib/prisma'
import { classifyText } from '../lib/search/isLikelyComic'
import { downloadAndStoreCover } from '../lib/images/download'

const EXECUTE = process.argv.includes('--execute')
const CONC = 16
const KNOWN_PLACEHOLDER = new Set(['06661fd690879985', '2cafc2b0f16dfe03', '307a2fbbc46139a8', 'b3165c10e262603d'])
const ALWAYS_COMIC_FORMATS = new Set(['SINGLE_ISSUE', 'TPB', 'HARDCOVER', 'OMNIBUS', 'DELUXE', 'COMPENDIUM', 'MANGA_VOLUME', 'ABSOLUTE'])

interface Row { id: string; title: string; publisher: string | null; format: string; image_url: string }

async function probe(url: string): Promise<{ hash: string; w: number; h: number } | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } })
    if (!r.ok) return null
    const ct = r.headers.get('content-type') ?? ''
    if (!ct.startsWith('image/') && ct !== 'application/octet-stream') return null
    const buf = Buffer.from(await r.arrayBuffer())
    const meta = await sharp(buf).metadata()
    const w = meta.width ?? 0, h = meta.height ?? 0
    const hash = crypto.createHash('sha256').update(
      await sharp(buf).resize(400, undefined, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toBuffer()
    ).digest('hex').slice(0, 16)
    return { hash, w, h }
  } catch { return null }
}

async function main() {
  console.log(`Retailer-image cover recovery (comic-relevant only)  [${EXECUTE ? 'EXECUTE' : 'DRY RUN'}]\n`)

  // Best retailer image per missing-cover product (highest match_confidence)
  const all = await prisma.$queryRawUnsafe<Row[]>(`
    SELECT DISTINCT ON (cp.id) cp.id, cp.title, cp.publisher, cp.format::text AS format, rl.image_url
      FROM canonical_products cp
      JOIN retailer_listings rl ON rl.canonical_product_id = cp.id
       AND rl.deleted_at IS NULL AND rl.image_url IS NOT NULL AND rl.image_url <> ''
     WHERE cp.deleted_at IS NULL AND cp.cover_image_url IS NULL
     ORDER BY cp.id, rl.match_confidence DESC
  `)
  const candidates = all.filter(r => ALWAYS_COMIC_FORMATS.has(r.format) || classifyText(`${r.title} ${r.publisher ?? ''}`) === 'comic')
  console.log(`Missing-cover w/ retailer image : ${all.length.toLocaleString()}`)
  console.log(`Comic-relevant (recovery target): ${candidates.length.toLocaleString()}`)
  console.log(`Excluded (non-comic, left for cleanup): ${(all.length - candidates.length).toLocaleString()}\n`)

  // ── Pass 1: hash all candidates → detect placeholders, dups, broken, small ──
  console.log('Pass 1: validating images (hash/dims/dup)…')
  const probed = new Map<string, { hash: string; w: number; h: number } | null>()
  for (let i = 0; i < candidates.length; i += CONC) {
    const batch = candidates.slice(i, i + CONC)
    const res = await Promise.all(batch.map(c => probe(c.image_url)))
    res.forEach((p, j) => probed.set(batch[j].id, p))
  }
  const hashCount = new Map<string, number>()
  for (const p of probed.values()) if (p) hashCount.set(p.hash, (hashCount.get(p.hash) ?? 0) + 1)
  const dupHashes = new Set([...hashCount.entries()].filter(([, c]) => c >= 3).map(([h]) => h))

  const reasons = { broken: 0, small: 0, placeholder: 0, dup: 0, ok: 0 }
  const valid: Row[] = []
  for (const c of candidates) {
    const p = probed.get(c.id)
    if (!p) { reasons.broken++; continue }
    if (p.w < 50 || p.h < 50) { reasons.small++; continue }
    if (KNOWN_PLACEHOLDER.has(p.hash)) { reasons.placeholder++; continue }
    if (dupHashes.has(p.hash)) { reasons.dup++; continue }
    reasons.ok++; valid.push(c)
  }
  console.log(`  valid: ${reasons.ok}  · rejected → broken/404: ${reasons.broken}, <50px: ${reasons.small}, placeholder: ${reasons.placeholder}, duplicate/generic: ${reasons.dup}`)
  if (dupHashes.size) console.log(`  duplicate/generic hashes found: ${[...dupHashes].join(', ')}`)

  if (!EXECUTE) {
    console.log(`\nDRY RUN — would recover ${valid.length.toLocaleString()} covers. Pass --execute to store.`)
    await prisma.$disconnect(); return
  }

  // ── Pass 2: store valid images (downloadAndStoreCover = guard + R2 + DB) ──
  console.log(`\nPass 2: storing ${valid.length.toLocaleString()} covers to R2…`)
  const logPath = path.join(__dirname, `.cover-retailer-recovery-log-${Date.now()}.json`)
  fs.writeFileSync(logPath, JSON.stringify(valid.map(v => v.id), null, 2))
  let recovered = 0, failed = 0
  for (let i = 0; i < valid.length; i += CONC) {
    const batch = valid.slice(i, i + CONC)
    const res = await Promise.all(batch.map(c => downloadAndStoreCover(c.id, c.image_url).catch(() => null)))
    for (const r of res) { if (r) recovered++; else failed++ }
    if ((i + CONC) % 800 < CONC) console.log(`  …${Math.min(i + CONC, valid.length)}/${valid.length}`)
  }
  console.log(`\n✅ Recovered ${recovered.toLocaleString()}  · failed ${failed}`)
  const live = await prisma.canonicalProduct.count({ where: { deletedAt: null } })
  const withCover = await prisma.canonicalProduct.count({ where: { deletedAt: null, coverImageUrl: { not: null } } })
  console.log(`Cover coverage now: ${withCover.toLocaleString()}/${live.toLocaleString()} (${(withCover/live*100).toFixed(1)}%)`)
  console.log(`Reversible: ids logged in ${path.basename(logPath)} (null those to revert)`)
  await prisma.$disconnect()
}
main().catch(e => { console.error('ERR', e); process.exit(1) }).finally(() => prisma.$disconnect())
