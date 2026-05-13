#!/usr/bin/env tsx
/**
 * Purge canonical products that passed the old format-only filter
 * but are not actually comics (TPB/HARDCOVER/OTHER with non-comic publishers).
 *
 * Safe to re-run — checks each candidate against the full isLikelyComic logic.
 */

import { prisma } from '../lib/prisma'
import * as fs   from 'fs'
import * as path from 'path'

const COMIC_PUBLISHERS = new Set([
  'marvel', 'marvel comics', 'dc comics', 'image comics', 'image', 'dark horse comics',
  'dark horse', 'idw publishing', 'idw', 'boom! studios', 'boom studios', 'oni press',
  'fantagraphics books', 'fantagraphics', 'drawn & quarterly', 'viz media', 'viz',
  'kodansha comics', 'kodansha', 'yen press', 'seven seas entertainment', 'seven seas',
  'tokyopop', 'square enix manga', 'square enix', 'shueisha', 'vertical comics', 'vertical',
  'titan comics', 'dynamite entertainment', 'dynamite', 'aftershock comics', 'aftershock',
  'vault comics', 'vault', 'scout comics', 'ahoy comics', 'top shelf productions',
  'humanoids', 'ablaze', 'valiant entertainment', 'valiant', 'archie comics', 'archie',
  'avatar press', 'zenescope', 'action lab', 'lion forge', 'oni-lion forge',
  'drawn and quarterly', 'pantheon books', 'abrams comicarts', 'abrams',
  'first second', 'graphix', 'scholastic graphix', 'viz signature', 'dark horse manga',
  'j-novel club', 'papercutz', 'eurocomics',
])

const COMIC_KEYWORDS = [
  'graphic novel', 'comic book', 'manga', 'superhero', 'batman', 'spider-man',
  'avengers', 'x-men', 'justice league', 'collected edition', 'trade paperback',
  'comic strip', 'illustrated novel', 'anime', 'sequential art',
]

function isLikelyComic(pub: string | null, title: string, desc: string | null): boolean {
  const p = (pub ?? '').toLowerCase().trim()
  if (p) {
    for (const known of COMIC_PUBLISHERS) {
      if (p.includes(known)) return true
    }
  }
  const text = `${title} ${desc ?? ''}`.toLowerCase()
  for (const kw of COMIC_KEYWORDS) {
    if (text.includes(kw)) return true
  }
  return false
}

const CHECKPOINT_PATH = path.join(__dirname, '.seed-checkpoint.json')

async function main() {
  // Only check formats that could have false-positived through the old format check
  const candidates = await prisma.canonicalProduct.findMany({
    where : { format: { in: ['TPB', 'HARDCOVER', 'OTHER'] } },
    select: { id: true, isbn13: true, title: true, publisher: true, description: true, format: true },
  })

  console.log(`Checking ${candidates.length} TPB/HARDCOVER/OTHER canonical products...`)

  const toDelete: string[] = []
  const toCheckpoint: string[] = []

  for (const cp of candidates) {
    if (isLikelyComic(cp.publisher, cp.title, cp.description)) continue
    toDelete.push(cp.id)
    if (cp.isbn13) toCheckpoint.push(cp.isbn13)
    console.log(`  ✗ "${cp.title}" (${cp.format}) publisher=${cp.publisher ?? 'null'}`)
  }

  if (toDelete.length === 0) {
    console.log('\n✓ No false positives found.')
    return
  }

  console.log(`\nDeleting ${toDelete.length} false positives...`)

  // Unlink listings
  await prisma.$executeRaw`
    UPDATE retailer_listings
    SET canonical_product_id = NULL
    WHERE canonical_product_id = ANY(${toDelete}::uuid[])
  `
  // Delete canonicals
  await prisma.canonicalProduct.deleteMany({ where: { id: { in: toDelete } } })

  console.log(`Deleted ${toDelete.length} false-positive canonical products.`)

  // Add to checkpoint so seed:canonical won't recreate them
  if (fs.existsSync(CHECKPOINT_PATH)) {
    const data = JSON.parse(fs.readFileSync(CHECKPOINT_PATH, 'utf-8')) as { completed: string[] }
    const set = new Set(data.completed)
    for (const isbn of toCheckpoint) set.add(isbn)
    fs.writeFileSync(CHECKPOINT_PATH, JSON.stringify({ completed: [...set] }, null, 2))
    console.log(`Checkpoint updated — ${set.size} total ISBNs marked done.`)
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) }).finally(() => prisma.$disconnect())
