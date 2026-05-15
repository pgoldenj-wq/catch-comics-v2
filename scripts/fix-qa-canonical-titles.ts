#!/usr/bin/env tsx
/**
 * scripts/fix-qa-canonical-titles.ts
 *
 * Fixes specific canonical product titles/formats identified as wrong during
 * the Day 5C QA pass. Each fix is targeted by ISBN and only applies when the
 * current value is incorrect.
 *
 * Sources of truth:
 *   - Travelling Man product page URLs (the retailer's own descriptive slug)
 *   - Published ISBN metadata
 *
 * Usage:
 *   npx dotenv -e .env.local -- npx tsx scripts/fix-qa-canonical-titles.ts           # dry-run
 *   npx dotenv -e .env.local -- npx tsx scripts/fix-qa-canonical-titles.ts --write   # apply
 */

import { prisma } from '../lib/prisma'

const WRITE = process.argv.includes('--write')

interface Fix {
  isbn:        string
  description: string
  title?:      string   // new title (if fixing title)
  format?:     string   // new format enum value (if fixing format)
  publisher?:  string   // new publisher (only set if we are certain)
}

const FIXES: Fix[] = [
  {
    isbn:        '9781302954543',
    description: 'Marvel-Verse: Wonder Man — title too broad (TM URL: marvel-verse-wonder-man)',
    title:       'Marvel-Verse: Wonder Man',
    format:      'TPB',     // All Marvel-Verse books are trade paperbacks
  },
  {
    isbn:        '9781421584935',
    description: 'Naruto: The Seventh Hokage and the Scarlet Spring — title just "Naruto" (TM URL: naruto-the-seventh-hokage-and-the-scarlet-spring)',
    title:       'Naruto: The Seventh Hokage and the Scarlet Spring',
    format:      'TPB',     // This is a collected story-arc volume
    publisher:   'Viz Media',
  },
]

async function main() {
  console.log(`\n${'═'.repeat(60)}`)
  console.log(`  QA canonical title/format fixes`)
  console.log(`  Mode: ${WRITE ? '⚡ WRITE' : 'DRY RUN'}`)
  console.log(`${'═'.repeat(60)}\n`)

  for (const fix of FIXES) {
    console.log(`\n── ${fix.isbn}`)
    console.log(`   ${fix.description}\n`)

    const product = await prisma.canonicalProduct.findFirst({
      where:  { isbn13: fix.isbn },
      select: { id: true, title: true, format: true, publisher: true },
    })

    if (!product) {
      console.log(`   ⚠  No canonical product found for ISBN ${fix.isbn} — skipping`)
      continue
    }

    console.log(`   Current title     : ${product.title}`)
    console.log(`   Current format    : ${product.format}`)
    console.log(`   Current publisher : ${product.publisher ?? '(none)'}`)

    const data: Record<string, string> = {}
    let changed = false

    if (fix.title && product.title !== fix.title) {
      data.title = fix.title
      changed = true
      console.log(`   → title    : "${product.title}" → "${fix.title}"`)
    }
    if (fix.format && product.format !== fix.format) {
      data.format = fix.format
      changed = true
      console.log(`   → format   : "${product.format}" → "${fix.format}"`)
    }
    if (fix.publisher && product.publisher !== fix.publisher) {
      data.publisher = fix.publisher
      changed = true
      console.log(`   → publisher: "${product.publisher ?? '(none)'}" → "${fix.publisher}"`)
    }

    if (!changed) {
      console.log(`   ✓ Already correct — nothing to change`)
      continue
    }

    if (WRITE) {
      // Use Prisma ORM — avoids UUID vs text cast issues in raw SQL
      await prisma.canonicalProduct.update({
        where: { id: product.id },
        data,
      })
      console.log(`   ✅ Applied`)
    } else {
      console.log(`   (dry-run — pass --write to apply)`)
    }
  }

  console.log('\n')
}

main()
  .catch(err => { console.error('\n❌ Fatal:', err); process.exit(1) })
  .finally(() => prisma.$disconnect())
