#!/usr/bin/env tsx
/**
 * scripts/bulk-import-retailers.ts
 *
 * Reads a JSON file of retailer candidates, auto-detects their platform, and
 * creates retailer records + enqueues an initial sync for each detected store.
 *
 * Usage:
 *   npm run import:retailers
 *   npm run import:retailers -- --file scripts/my-candidates.json
 *   npm run import:retailers -- --dry-run         (detect only, no DB writes)
 *   npm run import:retailers -- --no-sync          (create records, skip initial sync)
 *
 * Input file shape (scripts/retailer-candidates.json):
 *   [
 *     { "name": "Store Name", "domain": "example.com", "country": "GB", "currency": "GBP" },
 *     ...
 *   ]
 *
 * Env vars:
 *   DATABASE_URL    — Prisma connection (via dotenv-cli)
 *   INNGEST_EVENT_KEY — required for sync enqueueing (can be 'local' in dev)
 */

import { prisma }           from '../lib/prisma'
import { detectPlatform }   from '../lib/adapters/platform_auto_detect'
import { inngest }          from '../lib/inngest/client'
import { RetailerPlatform } from '@prisma/client'
import * as fs              from 'fs'
import * as path            from 'path'

// ── Types ─────────────────────────────────────────────────────────────────────

interface RetailerCandidate {
  name     : string
  domain   : string
  country  : string
  currency : string
  /** Optional manual platform override — skips auto-detection */
  platform?: string
  /** Optional trust score override (default: 70) */
  trustScore?: number
}

interface ImportResult {
  candidate : RetailerCandidate
  detected  : string | null
  endpoint  : string | null
  sample    : string | null
  outcome   : 'created' | 'already_exists' | 'detection_failed' | 'skipped' | 'error'
  retailerId: string | null
  error     : string | null
}

// ── CLI args ──────────────────────────────────────────────────────────────────

const args     = process.argv.slice(2)
const DRY_RUN  = args.includes('--dry-run')
const NO_SYNC  = args.includes('--no-sync')
const fileArg  = (() => {
  const idx = args.indexOf('--file')
  return idx !== -1 ? args[idx + 1] : 'scripts/retailer-candidates.json'
})()

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${'═'.repeat(60)}`)
  console.log(` Catch Comics — Bulk Retailer Import`)
  console.log(` Mode   : ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'}`)
  console.log(` Sync   : ${NO_SYNC || DRY_RUN ? 'disabled' : 'enabled (via Inngest)'}`)
  console.log(` Source : ${fileArg}`)
  console.log(`${'═'.repeat(60)}\n`)

  // ── Load candidates ───────────────────────────────────────────────────────
  const filePath = path.resolve(fileArg)
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`)
    process.exit(1)
  }

  const candidates = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as RetailerCandidate[]
  console.log(`Loaded ${candidates.length} candidates from ${path.basename(filePath)}\n`)

  const results  : ImportResult[] = []
  const failed   : RetailerCandidate[] = []

  // ── Process each candidate ────────────────────────────────────────────────
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]
    console.log(`[${i + 1}/${candidates.length}] ${c.name} (${c.domain})`)

    const result: ImportResult = {
      candidate : c,
      detected  : null,
      endpoint  : null,
      sample    : null,
      outcome   : 'skipped',
      retailerId: null,
      error     : null,
    }

    try {
      // ── Auto-detect platform (or use manual override) ─────────────────────
      let platformStr: string | null = c.platform ?? null
      let endpoint    : string | null = null
      let sample      : string | null = null

      if (!platformStr) {
        process.stdout.write('  Detecting platform... ')
        const detection = await detectPlatform(c.domain)
        platformStr = detection.platform
        endpoint    = detection.endpoint
        sample      = detection.sample
        console.log(platformStr ? `${platformStr} ✓` : 'not detected')
      } else {
        console.log(`  Platform: ${platformStr} (manual override)`)
      }

      result.detected = platformStr
      result.endpoint = endpoint
      result.sample   = sample

      if (!platformStr) {
        console.log(`  → Skipped (platform not detected)`)
        result.outcome = 'detection_failed'
        failed.push(c)
        continue
      }

      // Validate platform enum
      const validPlatforms = Object.values(RetailerPlatform) as string[]
      if (!validPlatforms.includes(platformStr)) {
        result.outcome = 'error'
        result.error   = `Detected platform "${platformStr}" is not a valid RetailerPlatform enum value`
        console.log(`  ✗ ${result.error}`)
        failed.push(c)
        continue
      }

      // ── Check if retailer already exists ──────────────────────────────────
      const existing = await prisma.retailer.findUnique({ where: { domain: c.domain } })
      if (existing) {
        console.log(`  → Already exists (id: ${existing.id})`)
        result.outcome  = 'already_exists'
        result.retailerId = existing.id
        results.push(result)
        continue
      }

      // ── Create retailer record ────────────────────────────────────────────
      if (DRY_RUN) {
        console.log(`  → Would create ${platformStr} retailer [dry-run]`)
        result.outcome = 'created'
        results.push(result)
        continue
      }

      const retailer = await prisma.retailer.create({
        data: {
          name       : c.name,
          domain     : c.domain,
          platform   : platformStr as RetailerPlatform,
          countryCode: c.country,
          currency   : c.currency,
          isActive   : true,
          trustScore : c.trustScore ?? 70,
          syncConfig : {},
        },
      })

      result.retailerId = retailer.id
      result.outcome    = 'created'
      console.log(`  ✓ Created retailer ${retailer.id}`)

      // ── Enqueue initial sync ──────────────────────────────────────────────
      const syncablePlatforms = ['SHOPIFY', 'BIGCOMMERCE', 'WOOCOMMERCE', 'AWIN_FEED']
      if (!NO_SYNC && syncablePlatforms.includes(platformStr)) {
        try {
          await inngest.send({
            name: 'sync/retailer',
            data: { retailerId: retailer.id },
          })
          console.log(`  ↑ Sync enqueued via Inngest`)
        } catch (err) {
          console.warn(`  ⚠ Sync enqueue failed (Inngest not available?):`, err instanceof Error ? err.message : err)
        }
      }

    } catch (err) {
      result.outcome = 'error'
      result.error   = err instanceof Error ? err.message : String(err)
      console.error(`  ✗ Error: ${result.error}`)
      failed.push(c)
    }

    results.push(result)
    // Brief pause between domains to avoid hammering stores with auto-detect
    await new Promise(r => setTimeout(r, 500))
  }

  // ── Write failed-detection file ───────────────────────────────────────────
  if (failed.length > 0 && !DRY_RUN) {
    const failPath = path.join(path.dirname(filePath), 'failed-detection.json')
    fs.writeFileSync(failPath, JSON.stringify(failed, null, 2))
    console.log(`\nWrote ${failed.length} failed entries to ${failPath}`)
  }

  // ── Summary table ─────────────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(60)}`)
  console.log(' Summary')
  console.log(`${'═'.repeat(60)}`)

  const counts = {
    created       : results.filter(r => r.outcome === 'created').length,
    already_exists: results.filter(r => r.outcome === 'already_exists').length,
    detection_failed: results.filter(r => r.outcome === 'detection_failed').length,
    error         : results.filter(r => r.outcome === 'error').length,
  }

  console.log(`  Created       : ${counts.created}`)
  console.log(`  Already exists: ${counts.already_exists}`)
  console.log(`  Not detected  : ${counts.detection_failed}`)
  console.log(`  Errors        : ${counts.error}`)
  console.log()

  // Platform breakdown
  const platforms: Record<string, number> = {}
  for (const r of results) {
    if (r.detected) {
      platforms[r.detected] = (platforms[r.detected] ?? 0) + 1
    }
  }
  if (Object.keys(platforms).length > 0) {
    console.log('  Platform breakdown:')
    for (const [p, count] of Object.entries(platforms).sort(([,a],[,b]) => b - a)) {
      console.log(`    ${p.padEnd(20)} ${count}`)
    }
    console.log()
  }

  // Detailed results
  if (results.some(r => r.sample)) {
    console.log('  Detection samples:')
    for (const r of results.filter(r => r.sample)) {
      console.log(`    ${r.candidate.domain.padEnd(30)} ${r.sample?.slice(0, 50) ?? ''}`)
    }
    console.log()
  }
}

main()
  .catch(err => { console.error('Fatal:', err); process.exit(1) })
  .finally(() => prisma.$disconnect())
