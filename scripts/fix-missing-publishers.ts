#!/usr/bin/env tsx
/**
 * scripts/fix-missing-publishers.ts
 *
 * Re-enriches specific canonical products that are missing publisher data.
 * Uses the same enrichByIsbn() + applyEnrichment() pipeline as enrich-isbn.ts.
 *
 * Identified during Day 5B QA pass:
 *   9781799507758 — Absolute Superman Vol. 2 (missing publisher → DC Comics)
 *   9781421584935 — Naruto: The Seventh Hokage (missing publisher → VIZ Media)
 *
 * Usage:
 *   npx tsx scripts/fix-missing-publishers.ts           # dry-run (shows what would change)
 *   npx tsx scripts/fix-missing-publishers.ts --write   # apply enrichment to DB
 */

import { enrichByIsbn, applyEnrichment } from '../lib/enrichment/isbn'
import { prisma } from '../lib/prisma'

const WRITE_MODE = process.argv.includes('--write')

interface Target {
  isbn:    string
  hint:    string   // human-readable label for log output
}

const TARGETS: Target[] = [
  { isbn: '9781799507758', hint: 'Absolute Superman Vol. 2' },
  { isbn: '9781421584935', hint: 'Naruto: The Seventh Hokage and Beyond' },
]

function fmt(v: unknown): string {
  if (v == null)  return '(none)'
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  const s = String(v)
  return s.length > 80 ? s.slice(0, 80) + '…' : s
}

async function main() {
  console.log(`\n${'═'.repeat(60)}`)
  console.log(`  Fix missing publishers`)
  console.log(`  Mode : ${WRITE_MODE ? '⚡ WRITE — applying to DB' : 'DRY RUN (pass --write to apply)'}`)
  console.log(`${'═'.repeat(60)}\n`)

  for (const target of TARGETS) {
    console.log(`\n── ${target.hint}  [ISBN ${target.isbn}] ──`)

    // 1. Find canonical product
    const product = await prisma.canonicalProduct.findFirst({
      where:  { isbn13: target.isbn },
      select: { id: true, title: true, publisher: true, coverImageUrl: true },
    })

    if (!product) {
      console.log(`  ⚠  No canonical product found for ISBN ${target.isbn} — skipping`)
      continue
    }

    console.log(`  DB title      : ${fmt(product.title)}`)
    console.log(`  DB publisher  : ${fmt(product.publisher)}`)
    console.log(`  Has cover     : ${product.coverImageUrl ? 'yes' : 'no'}`)

    // 2. Fetch enrichment
    let enriched: Awaited<ReturnType<typeof enrichByIsbn>>
    try {
      enriched = await enrichByIsbn(target.isbn)
    } catch (err) {
      console.log(`  ❌ enrichByIsbn error: ${err instanceof Error ? err.message : err}`)
      continue
    }

    console.log(`  API source    : ${enriched.source}`)
    console.log(`  API publisher : ${fmt(enriched.publisher)}`)
    console.log(`  API title     : ${fmt(enriched.title)}`)
    console.log(`  API cover     : ${enriched.coverImageUrl ? 'yes' : 'no'}`)

    if (enriched.source === 'none') {
      console.log(`  ⚠  No metadata returned from any API — cannot fix`)
      continue
    }

    if (!enriched.publisher) {
      console.log(`  ⚠  API returned data but publisher field is still empty`)
    }

    if (WRITE_MODE) {
      const applied = await applyEnrichment(product.id, enriched)
      if (applied) {
        console.log(`  ✅  Enrichment applied`)
      } else {
        console.log(`  ℹ  applyEnrichment: no new fields to fill (product already fully enriched)`)
      }
    } else {
      console.log(`  (dry-run — pass --write to apply)`)
    }
  }

  console.log('\n')
}

main()
  .catch(err => { console.error('\n❌ Fatal:', err); process.exit(1) })
  .finally(() => prisma.$disconnect())
