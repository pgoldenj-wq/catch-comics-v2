/**
 * recover-priority-covers.ts — final, bounded recovery for the highest-value
 * missing covers. Fixes the Phase-1 gap: pick the first ACCESSIBLE listing image
 * (Bookshop 403s — deprioritise it), edition-correct by listing match, guarded
 * against placeholders/dups/wrong-volume. Reversible (log). No bulk, no CV-volume.
 *
 *   npx dotenv -e .env.local -- tsx scripts/recover-priority-covers.ts            # dry-run (A)
 *   npx dotenv -e .env.local -- tsx scripts/recover-priority-covers.ts --execute  # A
 *   npx dotenv -e .env.local -- tsx scripts/recover-priority-covers.ts --execute --priorityB
 */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import sharp from 'sharp'
import { prisma } from '../lib/prisma'
import { classifyText } from '../lib/search/isLikelyComic'
import { downloadAndStoreCover } from '../lib/images/download'

const EXECUTE = process.argv.includes('--execute')
const PRIORITY_B = process.argv.includes('--priorityB')
const KNOWN_PLACEHOLDER = new Set(['06661fd690879985','2cafc2b0f16dfe03','307a2fbbc46139a8','b3165c10e262603d','f2161a2b764f9dd6','61a456d23edb8d69'])
const ALWAYS_COMIC_FORMATS = new Set(['SINGLE_ISSUE','TPB','HARDCOVER','OMNIBUS','DELUXE','COMPENDIUM','MANGA_VOLUME','ABSOLUTE'])
const HIGH_TRAFFIC = ['marvel','dc comics','image comics','dark horse','viz','kodansha','idw','boom','yen press','dynamite','titan','valiant','oni press','fantagraphics','seven seas','square enix','vertical']
const PRIORITY_A_ISBN = ['9781634428859','9798888775165','9781974755196','9798893734072','9781974756025']

// Accessibility rank: lower = try first. Bookshop 403s without creds → last.
function rank(url: string): number {
  if (url.includes('bookshop.org')) return 9
  if (url.includes('cdn.shopify.com')) return 1
  if (url.includes('media-amazon') || url.includes('images-amazon')) return 2
  return 5
}

const seenHashes = new Set<string>()

async function tryImage(id: string, url: string): Promise<'stored'|'placeholder'|'dup'|'small'|'broken'> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } })
    if (!r.ok) return 'broken'
    const ct = r.headers.get('content-type') ?? ''
    if (!ct.startsWith('image/') && ct !== 'application/octet-stream') return 'broken'
    const buf = Buffer.from(await r.arrayBuffer())
    const meta = await sharp(buf).metadata()
    if ((meta.width ?? 0) < 50 || (meta.height ?? 0) < 50) return 'small'
    const hash = crypto.createHash('sha256').update(
      await sharp(buf).resize(400, undefined, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toBuffer()
    ).digest('hex').slice(0, 16)
    if (KNOWN_PLACEHOLDER.has(hash)) return 'placeholder'
    if (seenHashes.has(hash)) return 'dup'
    if (!EXECUTE) { seenHashes.add(hash); return 'stored' }
    const stored = await downloadAndStoreCover(id, url)   // re-fetch + guard + R2 + DB
    if (!stored) return 'broken'
    seenHashes.add(hash)
    return 'stored'
  } catch { return 'broken' }
}

interface P { id: string; title: string; isbn13: string|null; format: string; publisher: string|null
  listings: { imageUrl: string|null }[] }

async function recover(prods: P[], label: string) {
  console.log(`\n══ ${label} (${prods.length}) ══`)
  const log: string[] = []
  let recovered=0, skipped=0
  for (const p of prods) {
    const urls = [...new Set(p.listings.map(l=>l.imageUrl).filter((u): u is string => !!u))].sort((a,b)=>rank(a)-rank(b))
    if (!urls.length) { console.log(`  ✗ ${p.title.slice(0,46)} — no retailer image (skip: no edition-correct source)`); skipped++; continue }
    let done=false
    const tried: string[] = []
    for (const u of urls) {
      const res = await tryImage(p.id, u)
      tried.push(`${u.split('/')[2]}:${res}`)
      if (res === 'stored') { console.log(`  ✓ ${p.title.slice(0,46)} ← ${u.split('/')[2]}`); recovered++; log.push(p.id); done=true; break }
    }
    if (!done) { console.log(`  ✗ ${p.title.slice(0,46)} — ${tried.join(', ')}`); skipped++ }
  }
  console.log(`  → ${EXECUTE ? 'recovered' : 'would recover'} ${recovered}, skipped ${skipped}`)
  if (EXECUTE && log.length) {
    const lp = path.join(__dirname, `.cover-priority-recovery-log-${Date.now()}.json`)
    fs.writeFileSync(lp, JSON.stringify(log, null, 2)); console.log(`  log: ${path.basename(lp)}`)
  }
}

async function main() {
  const sel = { id:true, title:true, isbn13:true, format:true, publisher:true, listings:{ where:{ deletedAt:null }, select:{ imageUrl:true } } }
  const A = await prisma.canonicalProduct.findMany({ where: { isbn13: { in: PRIORITY_A_ISBN }, deletedAt: null, coverImageUrl: null }, select: sel })
  await recover(A as P[], `PRIORITY A  [${EXECUTE?'EXECUTE':'DRY'}]`)

  if (PRIORITY_B) {
    const rows = await prisma.canonicalProduct.findMany({
      where: { deletedAt: null, coverImageUrl: null, listings: { some: { deletedAt: null, imageUrl: { not: null } } } },
      select: sel,
    })
    const B = (rows as P[]).filter(p => {
      const comic = ALWAYS_COMIC_FORMATS.has(p.format) || classifyText(`${p.title} ${p.publisher ?? ''}`) === 'comic'
      const major = HIGH_TRAFFIC.some(h => (p.publisher ?? '').toLowerCase().includes(h))
      const visible2 = p.listings.length >= 2
      return comic && major && visible2 && !PRIORITY_A_ISBN.includes(p.isbn13 ?? '')
    })
    await recover(B, `PRIORITY B (comic · major pub · 2+ listings · has image)  [${EXECUTE?'EXECUTE':'DRY'}]`)
  }

  const live = await prisma.canonicalProduct.count({ where: { deletedAt: null } })
  const wc = await prisma.canonicalProduct.count({ where: { deletedAt: null, coverImageUrl: { not: null } } })
  console.log(`\nCoverage (raw): ${wc.toLocaleString()}/${live.toLocaleString()} (${(wc/live*100).toFixed(2)}%)`)
  await prisma.$disconnect()
}
main().catch(e => { console.error('ERR', e); process.exit(1) }).finally(() => prisma.$disconnect())
