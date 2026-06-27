/**
 * upgrade-cover-resolution.ts — STRICTLY UPGRADE-ONLY cover re-ingest.
 *
 * Re-stores comic covers that have a higher-resolution, edition-correct source
 * (ISBN-keyed cdn.shopify.com retailer images, ~975-1011x1500) at 1000px wide.
 * Legacy covers were capped at 400px (or stored as 200x200 thumbnails).
 *
 * GATES (all must pass — never downgrade, never replace equal quality):
 *   1. Source host is cdn.shopify.com  (edition-correct, ISBN-keyed, high confidence)
 *   2. Source aspect ratio is a valid comic portrait (H/W in [1.2, 1.7])
 *   3. New processed width  >  existing stored width  (STRICTLY greater)
 *   4. New image is not a known placeholder (content-hash guard)
 *
 * Overwrites covers/{id}.webp and bumps cover_image_url with a ?v=<hash> cache
 * buster so the CDN/browsers fetch the new bytes. Reversible log of every change.
 *
 *   npx dotenv -e .env.local -- tsx scripts/upgrade-cover-resolution.ts            # dry-run
 *   npx dotenv -e .env.local -- tsx scripts/upgrade-cover-resolution.ts --execute  # mutate
 */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import sharp from 'sharp'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { prisma } from '../lib/prisma'
import { r2Client, R2_BUCKET, R2_PUBLIC_URL } from '../lib/images/r2'

const EXECUTE = process.argv.includes('--execute')
const TARGET_WIDTH = 1000
const WEBP_Q = 85
const ASPECT_MIN = 1.2
const ASPECT_MAX = 1.7
const TYPED = ['SINGLE_ISSUE', 'TPB', 'HARDCOVER', 'OMNIBUS', 'DELUXE', 'COMPENDIUM', 'MANGA_VOLUME', 'ABSOLUTE']
const PLACEHOLDER_HASHES = new Set(['06661fd690879985', '2cafc2b0f16dfe03', '307a2fbbc46139a8', 'b3165c10e262603d', 'f2161a2b764f9dd6', '61a456d23edb8d69'])
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }

async function fetchBuf(url: string): Promise<Buffer | null> {
  try { const r = await fetch(url, { signal: AbortSignal.timeout(20000), headers: UA }); if (!r.ok) return null; return Buffer.from(await r.arrayBuffer()) } catch { return null }
}
async function widthOf(url: string): Promise<number> {
  const b = await fetchBuf(url); if (!b) return -1
  try { return (await sharp(b).metadata()).width ?? -1 } catch { return -1 }
}
/** Prefer the largest Shopify variant (_SLNNNN), else first. */
function bestShopify(urls: string[]): string | null {
  const sh = urls.filter(u => u.includes('cdn.shopify.com'))
  if (!sh.length) return null
  return sh.map(u => ({ u, n: parseInt(u.match(/_SL(\d+)/i)?.[1] ?? '0', 10) })).sort((a, b) => b.n - a.n)[0].u
}
const keyFor = (id: string) => `covers/${id}.webp`

interface Log { id: string; title: string; oldCover: string | null; newCover: string; oldWidth: number; newWidth: number; src: string }
const log: Log[] = []

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  let i = 0
  await Promise.all([...Array(Math.min(n, items.length))].map(async () => { while (i < items.length) { const k = i++; await fn(items[k]) } }))
}

const stats = { candidates: 0, upgraded: 0, skip_no_shopify: 0, skip_bad_source: 0, skip_aspect: 0, skip_not_bigger: 0, skip_placeholder: 0, skip_error: 0,
  beforeW: [] as number[], afterW: [] as number[] }

async function upgradeOne(p: { id: string; title: string; coverImageUrl: string | null; listings: { imageUrl: string | null }[] }) {
  try {
    const urls = [...new Set(p.listings.map(l => l.imageUrl).filter((u): u is string => !!u))]
    const src = bestShopify(urls)
    if (!src) { stats.skip_no_shopify++; return }

    const srcBuf = await fetchBuf(src)
    if (!srcBuf) { stats.skip_bad_source++; return }
    let meta; try { meta = await sharp(srcBuf).metadata() } catch { stats.skip_bad_source++; return }
    const sw = meta.width ?? 0, sh = meta.height ?? 0
    if (sw < 50 || sh < 50) { stats.skip_bad_source++; return }
    const aspect = sh / sw
    if (aspect < ASPECT_MIN || aspect > ASPECT_MAX) { stats.skip_aspect++; return }

    const oldW = p.coverImageUrl ? await widthOf(p.coverImageUrl) : 0
    const newW = Math.min(TARGET_WIDTH, sw)
    if (!(newW > oldW)) { stats.skip_not_bigger++; return }   // STRICT upgrade-only

    const processed = await sharp(srcBuf).resize(TARGET_WIDTH, undefined, { fit: 'inside', withoutEnlargement: true }).webp({ quality: WEBP_Q }).toBuffer()
    const sig = crypto.createHash('sha256').update(processed).digest('hex').slice(0, 16)
    if (PLACEHOLDER_HASHES.has(sig)) { stats.skip_placeholder++; return }
    const procW = (await sharp(processed).metadata()).width ?? 0
    if (!(procW > oldW)) { stats.skip_not_bigger++; return }

    stats.upgraded++; stats.beforeW.push(oldW); stats.afterW.push(procW)
    const newCover = `${R2_PUBLIC_URL}/${keyFor(p.id)}?v=${sig.slice(0, 8)}`

    if (EXECUTE) {
      await r2Client.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: keyFor(p.id), Body: processed, ContentType: 'image/webp' }))
      await prisma.canonicalProduct.update({ where: { id: p.id }, data: { coverImageUrl: newCover, updatedAt: new Date() } })
      log.push({ id: p.id, title: p.title, oldCover: p.coverImageUrl, newCover, oldWidth: oldW, newWidth: procW, src })
    }
  } catch { stats.skip_error++ }
}

async function main() {
  const rows = await prisma.canonicalProduct.findMany({
    where: {
      deletedAt: null,
      coverImageUrl: { startsWith: 'https://images.catchcomics.com' },
      format: { in: TYPED as never },
      listings: { some: { deletedAt: null, imageUrl: { contains: 'cdn.shopify.com' } } },
    },
    select: { id: true, title: true, coverImageUrl: true, listings: { where: { deletedAt: null }, select: { imageUrl: true } } },
  })
  stats.candidates = rows.length
  console.log(`Candidates (typed comic, R2 cover, has Shopify image): ${rows.length}  [${EXECUTE ? 'EXECUTE' : 'DRY-RUN'}]`)

  await pool(rows, EXECUTE ? 6 : 10, upgradeOne)

  const avg = (a: number[]) => a.length ? Math.round(a.reduce((s, x) => s + x, 0) / a.length) : 0
  console.log(`\n── ${EXECUTE ? 'UPGRADED' : 'WOULD UPGRADE'}: ${stats.upgraded} ──`)
  console.log(`   avg width before: ${avg(stats.beforeW)}px   →   after: ${avg(stats.afterW)}px`)
  console.log(`── SKIPPED ──`)
  console.log(`   no shopify src   : ${stats.skip_no_shopify}`)
  console.log(`   bad/small source : ${stats.skip_bad_source}`)
  console.log(`   bad aspect ratio : ${stats.skip_aspect}`)
  console.log(`   not strictly bigger (already ≥ source): ${stats.skip_not_bigger}`)
  console.log(`   placeholder hash : ${stats.skip_placeholder}`)
  console.log(`   error            : ${stats.skip_error}`)

  if (EXECUTE && log.length) {
    const lp = path.join(__dirname, `.cover-upgrade-log-${Date.now()}.json`)
    fs.writeFileSync(lp, JSON.stringify(log, null, 2))
    console.log(`\nReversible log (${log.length}): ${path.basename(lp)}`)
  }
  await prisma.$disconnect()
}
main().catch(e => { console.error('ERR', e); process.exit(1) }).finally(() => prisma.$disconnect())
