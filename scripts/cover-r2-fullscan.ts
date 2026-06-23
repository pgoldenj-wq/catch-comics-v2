/**
 * READ-ONLY: full catalogue scan of R2 covers to size every file (HEAD →
 * content-length) and find placeholder signatures (sizes shared by many
 * unrelated products). Writes candidate placeholder product IDs to
 * scripts/.cover-placeholder-ids.json for a later (separate) hash-confirmed
 * null step. No DB writes.
 *
 * Run: npx dotenv -e .env.local -- tsx scripts/cover-r2-fullscan.ts
 */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { prisma } from '../lib/prisma'

const CONCURRENCY = 40
const CLUSTER_MIN = 20   // a byte-size shared by >=20 unrelated products = placeholder

async function headSize(url: string): Promise<number | null> {
  try {
    const r = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(15000) })
    if (!r.ok) return -1
    const len = r.headers.get('content-length')
    return len ? parseInt(len, 10) : -2
  } catch { return null }
}

async function hashOf(url: string): Promise<string> {
  const r = await fetch(url, { signal: AbortSignal.timeout(15000) })
  const buf = Buffer.from(await r.arrayBuffer())
  return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16)
}

async function main() {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string; cover_image_url: string }>>(`
    SELECT id, cover_image_url FROM canonical_products
    WHERE deleted_at IS NULL AND cover_image_url ILIKE '%images.catchcomics.com%'
  `)
  console.log(`Scanning ${rows.length.toLocaleString()} R2 covers (HEAD) at concurrency ${CONCURRENCY}…`)

  const sizeToIds = new Map<number, string[]>()
  let ok = 0, missing = 0, err = 0, done = 0
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const batch = rows.slice(i, i + CONCURRENCY)
    const res = await Promise.all(batch.map(r => headSize(r.cover_image_url)))
    res.forEach((s, j) => {
      if (s === null) err++
      else if (s < 0) missing++
      else { ok++; const arr = sizeToIds.get(s) ?? []; arr.push(batch[j].id); sizeToIds.set(s, arr) }
    })
    done += batch.length
    if (done % 4000 < CONCURRENCY) console.log(`  …${done}/${rows.length}`)
  }

  const clusters = [...sizeToIds.entries()].filter(([, ids]) => ids.length >= CLUSTER_MIN).sort((a, b) => b[1].length - a[1].length)
  console.log(`\nScanned ok=${ok}  missing/404=${missing}  errors=${err}`)
  console.log(`\n── placeholder size clusters (>=${CLUSTER_MIN} products share exact byte size) ──`)
  let placeholderTotal = 0
  const placeholderIds: string[] = []
  for (const [size, ids] of clusters) {
    const sampleUrl = rows.find(r => r.id === ids[0])!.cover_image_url
    const h = await hashOf(sampleUrl)
    console.log(`  ${String(ids.length).padStart(6)} @ ${String(size).padStart(7)}b  sha:${h}  (${((ids.length / ok) * 100).toFixed(1)}%)`)
    placeholderTotal += ids.length
    placeholderIds.push(...ids)
  }
  console.log(`\n  Placeholder R2 covers (in clusters): ${placeholderTotal.toLocaleString()} of ${ok.toLocaleString()} (${((placeholderTotal / ok) * 100).toFixed(1)}%)`)
  console.log(`  REAL R2 covers (unique): ${(ok - placeholderTotal).toLocaleString()}`)

  const outPath = path.join(__dirname, '.cover-placeholder-ids.json')
  fs.writeFileSync(outPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    clusterMin: CLUSTER_MIN,
    clusters: clusters.map(([size, ids]) => ({ size, count: ids.length })),
    ids: placeholderIds,
  }, null, 2))
  console.log(`\n  Wrote candidate placeholder IDs (${placeholderIds.length}) → ${outPath}`)
  await prisma.$disconnect()
}
main().catch(e => { console.error('ERR', e); process.exit(1) })
