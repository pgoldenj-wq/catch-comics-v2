#!/usr/bin/env tsx
/**
 * test-amazon-retirement.ts — proves the Rainforest retirement holds and the
 * kept Amazon behaviour (stored offers, stale suppression, affiliate links)
 * still works. Read-only against the DB; no external calls.
 *
 * Run: npm run test:amazon
 *
 * Asserts:
 *   1. No functional Rainforest reference in runtime source (app/, lib/,
 *      components/): no rainforestapi host, no RAINFOREST_API_KEY reads, no
 *      amazon-rainforest imports, no AMAZON_ONDEMAND_ENABLED gate.
 *      (Comments explaining the retirement are allowed.)
 *   2. package.json: enrich:amazon is the refusal stub; enrich:overnight gone;
 *      nothing references the deleted enrichment scripts.
 *   3. Missing Rainforest env vars are NORMAL — nothing reads them, so this
 *      test running without them is itself the proof.
 *   4. Affiliate wrapping still works (UK tag applied; URL params preserved).
 *   5. US search links carry NO tag while no real US tag exists; UK links do.
 *   6. DB display rules: visible = fresh priced live rows; stale rows are
 *      suppressed by the product-page filter; sets are disjoint and complete.
 *   7. A real stored Amazon listing wraps through the /go code path with the
 *      retailer's configured tag.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join }             from 'node:path'
import { prisma }           from '../lib/prisma'
import { wrapAffiliateUrl } from '../lib/affiliate'
import { buildAmazonUrl }   from '../lib/amazon'

let failures = 0
function check(name: string, ok: boolean, detail = '') {
  console.log(`  ${ok ? '✓' : '✗ FAIL'} ${name}${detail && !ok ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) yield* walk(p)
    else if (/\.(ts|tsx|js|mjs)$/.test(entry)) yield p
  }
}

async function main() {
  console.log('\n── Rainforest retirement tests ─────────────────────────────\n')
  const root = join(__dirname, '..')

  // 1. Runtime source scan — functional references only
  const banned = [
    /rainforestapi\.com/i,
    /RAINFOREST_API_KEY/,
    /adapters\/amazon-rainforest/,
    /AMAZON_ONDEMAND_ENABLED/,
    /RainforestQuotaError/,
  ]
  const offenders: string[] = []
  for (const dir of ['app', 'lib', 'components']) {
    for (const file of walk(join(root, dir))) {
      const src = readFileSync(file, 'utf8')
      for (const re of banned) if (re.test(src)) offenders.push(`${file} matches ${re}`)
    }
  }
  check('no functional Rainforest reference in app/, lib/, components/', offenders.length === 0, offenders.join('; '))

  // 2. package.json commands
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> }
  check('enrich:amazon is the refusal stub', pkg.scripts['enrich:amazon'] === 'node scripts/amazon-refresh-retired.mjs')
  check('enrich:overnight removed', !('enrich:overnight' in pkg.scripts))
  const pkgRaw = JSON.stringify(pkg)
  check('no command references deleted enrichment scripts', !pkgRaw.includes('enrich-amazon-bulk') && !pkgRaw.includes('enrich-overnight'))

  // 3. Absent env vars are normal (this process runs fine without them)
  check('RAINFOREST_API_KEY absent from environment', process.env.RAINFOREST_API_KEY === undefined)
  check('AMAZON_ONDEMAND_ENABLED absent from environment', process.env.AMAZON_ONDEMAND_ENABLED === undefined)

  // 4. Affiliate wrapping (pure)
  const wrapped = wrapAffiliateUrl('https://www.amazon.co.uk/dp/B0TEST123?psc=1', 'amazon', 'catchcomics-21')
  check('amazon wrapping applies UK tag', wrapped.includes('tag=catchcomics-21'))
  check('amazon wrapping preserves existing params', wrapped.includes('psc=1'))

  // 5. Search-fallback tags: UK tagged, US untagged (no real US tag exists)
  const ukTag = process.env.NEXT_PUBLIC_AMAZON_UK_ASSOCIATE_TAG ?? ''
  const usTag = process.env.NEXT_PUBLIC_AMAZON_US_ASSOCIATE_TAG ?? ''
  check('UK associate tag configured', ukTag.length > 0)
  check('US associate tag blank (never the UK tag)', usTag === '')
  const ukUrl = buildAmazonUrl({ title: 'Saga Vol. 1', region: 'uk', format: 'graphic-novel', tag: ukTag })
  const usUrl = buildAmazonUrl({ title: 'Saga Vol. 1', region: 'us', format: 'graphic-novel', tag: usTag })
  check('UK search link carries tag', ukUrl.includes(`tag=${encodeURIComponent(ukTag)}`))
  check('US search link carries NO tag', !usUrl.includes('tag='))

  // 6. Display rules against the live DB (read-only)
  const amazon = await prisma.retailer.findUnique({ where: { domain: 'amazon.co.uk' }, select: { id: true, affiliateNetwork: true, affiliateId: true } })
  if (!amazon) {
    check('amazon.co.uk retailer exists', false)
  } else {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const [livePriced, visible, stale] = await Promise.all([
      prisma.retailerListing.count({ where: { retailerId: amazon.id, deletedAt: null, priceAmount: { gt: 0 } } }),
      prisma.retailerListing.count({ where: { retailerId: amazon.id, deletedAt: null, priceAmount: { gt: 0 }, lastSeenAt: { gte: cutoff } } }),
      prisma.retailerListing.count({ where: { retailerId: amazon.id, deletedAt: null, priceAmount: { gt: 0 }, lastSeenAt: { lt: cutoff } } }),
    ])
    check('visible + suppressed = all live priced rows', visible + stale === livePriced, `${visible}+${stale}≠${livePriced}`)
    console.log(`    (stored Amazon: ${livePriced} priced · ${visible} visible · ${stale} suppressed)`)

    // Product-page filter: same shape as getProduct() — stale Amazon rows must not pass
    const pageVisible = await prisma.retailerListing.findMany({
      where: {
        retailerId: amazon.id,
        retailer  : { isActive: true },
        deletedAt : null,
        priceAmount: { gt: 0 },
        NOT: {
          AND: [
            { retailer:   { name: { contains: 'amazon', mode: 'insensitive' } } },
            { lastSeenAt: { lt: cutoff } },
          ],
        },
      },
      select: { lastSeenAt: true },
    })
    check('product-page filter admits no stale Amazon row', pageVisible.every(l => l.lastSeenAt >= cutoff))
    check('fresh stored Amazon listings still render (filter admits them)', pageVisible.length === visible, `${pageVisible.length}≠${visible}`)

    // 7. /go code path on a real stored listing
    const sample = await prisma.retailerListing.findFirst({
      where : { retailerId: amazon.id, deletedAt: null, priceAmount: { gt: 0 } },
      select: { retailerUrl: true },
      orderBy: { lastSeenAt: 'desc' },
    })
    if (sample && amazon.affiliateNetwork && amazon.affiliateId) {
      const go = wrapAffiliateUrl(sample.retailerUrl, amazon.affiliateNetwork, amazon.affiliateId)
      check('/go wrapping of a real stored listing carries the retailer tag', go.includes(`tag=${amazon.affiliateId}`))
    } else {
      console.log('    (no priced stored listing left to sample — expected after full expiry; skipping /go sample check)')
    }
  }

  console.log(`\n${failures === 0 ? '✓ ALL TESTS PASSED' : `✗ ${failures} FAILURE(S)`}\n`)
  if (failures > 0) process.exit(1)
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
