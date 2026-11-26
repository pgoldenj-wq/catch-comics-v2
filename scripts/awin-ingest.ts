/**
 * awin-ingest.ts — run an Awin feed sync for one retailer, with bounds,
 * checkpointing and before/after accounting.
 *
 * DEFAULT MODE IS READ-ONLY (--dry prints the plan and stops). Writes with
 * --write.
 *
 * Resumability: the adapter upserts on (retailer_id, retailer_sku) and never
 * deletes, so a partial run is safe to repeat — re-reading simply re-upserts
 * what it already wrote. A partial download therefore cannot withdraw offers
 * from rows it never reached; nothing is marked sold out by absence here.
 *
 * Freshness: the adapter reads the feed's own Awin build time and refuses a
 * feed older than its limit, so re-reading an unchanged feed cannot give old
 * prices a new observation date.
 *
 *   npx dotenv -e <main>/.env.local -- npx tsx scripts/awin-ingest.ts waterstones.com
 *   npx dotenv -e <main>/.env.local -- npx tsx scripts/awin-ingest.ts waterstones.com --write --max 50
 */
import { PrismaClient }            from '@prisma/client'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join }            from 'node:path'
import { AwinFeedAdapter, fetchFeedImportedAt } from '@/lib/adapters/awin-feed'

const prisma = new PrismaClient()

const argv   = process.argv.slice(2)
const domain = argv.find(a => !a.startsWith('--'))
const WRITE  = argv.includes('--write')
const MAX    = argv.includes('--max') ? Number(argv[argv.indexOf('--max') + 1]) : undefined

async function counts(retailerId: string) {
  const [r] = await prisma.$queryRaw<{ total: bigint; active: bigint; priced: bigint; matched: bigint }[]>`
    SELECT COUNT(*)::bigint AS total,
           COUNT(*) FILTER (WHERE deleted_at IS NULL)::bigint AS active,
           COUNT(*) FILTER (WHERE deleted_at IS NULL AND price_amount > 0)::bigint AS priced,
           COUNT(*) FILTER (WHERE deleted_at IS NULL AND price_amount > 0 AND canonical_product_id IS NOT NULL)::bigint AS matched
    FROM retailer_listings WHERE retailer_id = ${retailerId}::uuid`
  // Observation count and newest observation date: the two numbers that prove
  // whether re-reading an UNCHANGED feed invented freshness. Both must hold
  // steady across a repeat run of the same feed build.
  const [h] = await prisma.$queryRaw<{ obs: bigint; newest: Date | null; seen: Date | null }[]>`
    SELECT COUNT(ph.id)::bigint AS obs, MAX(ph.recorded_at) AS newest,
           (SELECT MAX(last_seen_at) FROM retailer_listings
             WHERE retailer_id = ${retailerId}::uuid AND deleted_at IS NULL) AS seen
    FROM price_history ph
    JOIN retailer_listings rl ON rl.id = ph.retailer_listing_id
    WHERE rl.retailer_id = ${retailerId}::uuid`
  return {
    total: Number(r.total), active: Number(r.active), priced: Number(r.priced), matched: Number(r.matched),
    observations: Number(h.obs),
    newestObservation: h.newest ? h.newest.toISOString() : '—',
    newestLastSeen: h.seen ? h.seen.toISOString() : '—',
  }
}

async function depth() {
  const [d] = await prisma.$queryRaw<{ one: bigint; two: bigint; three: bigint }[]>`
    WITH per AS (
      SELECT canonical_product_id, COUNT(DISTINCT retailer_id) AS n
      FROM retailer_listings
      WHERE deleted_at IS NULL AND price_amount > 0 AND canonical_product_id IS NOT NULL
      GROUP BY canonical_product_id)
    SELECT COUNT(*) FILTER (WHERE n = 1)::bigint AS one,
           COUNT(*) FILTER (WHERE n = 2)::bigint AS two,
           COUNT(*) FILTER (WHERE n >= 3)::bigint AS three FROM per`
  return { one: Number(d.one), two: Number(d.two), three: Number(d.three) }
}

async function main() {
  if (!domain) { console.error('usage: awin-ingest.ts <domain> [--write] [--max N]'); process.exit(1) }

  const r = await prisma.retailer.findUniqueOrThrow({ where: { domain } })
  const cfg = (r.syncConfig ?? {}) as Record<string, unknown>
  const feedId = String(cfg.feed_id ?? '')
  const key = (cfg.api_key as string | undefined) ?? process.env.AWIN_DATAFEED_KEY

  console.log(`retailer   ${r.name} (${r.domain})`)
  console.log(`platform   ${r.platform} · feed ${feedId || '(none)'} · comic_filter ${cfg.comic_filter === true}`)
  console.log(`mode       ${WRITE ? `WRITE${MAX ? ` (max ${MAX} listings)` : ' (full eligible pass)'}` : 'DRY-RUN — prints the plan, writes nothing'}`)

  if (!feedId) { console.error('no feed_id configured'); process.exit(1) }
  if (cfg.scheduled_sync_disabled === true) console.log(`NOTE       scheduled_sync_disabled=true — hosted runs are off; this is a manual run`)
  if (cfg.hold_reason) console.log(`HOLD       ${cfg.hold_reason}`)

  const builtAt = key ? await fetchFeedImportedAt(feedId, key) : null
  const ageDays = builtAt ? (Date.now() - builtAt.getTime()) / 86_400_000 : null
  console.log(`feed built ${builtAt ? builtAt.toISOString() : 'UNKNOWN'}${ageDays !== null ? ` (${ageDays.toFixed(1)} days ago)` : ''}`)

  const before = await counts(r.id)
  const dBefore = await depth()
  console.log(`BEFORE     ${before.total} rows · ${before.active} active · ${before.priced} priced · ${before.matched} priced+matched`)
  console.log(`           observations ${before.observations} · newest observation ${before.newestObservation} · newest last_seen ${before.newestLastSeen}`)
  console.log(`           site depth: ${dBefore.one} @1 retailer · ${dBefore.two} @2 · ${dBefore.three} @3+`)

  if (!WRITE) { console.log('\nDry run — nothing written.'); await prisma.$disconnect(); return }

  const ckPath = join(process.cwd(), 'scripts', `.awin-ingest-${r.domain}.json`)
  const t0 = Date.now()

  const result = await new AwinFeedAdapter().syncFeed(r.id, {
    maxListings: MAX,
    onProgress: p => {
      mkdirSync(dirname(ckPath), { recursive: true })
      writeFileSync(ckPath, JSON.stringify({
        domain: r.domain, feedId, updatedAt: new Date().toISOString(),
        rowsRead: p.rowsRead, ingested: p.ingested, skippedNotEligible: p.skipped,
      }, null, 2))
    },
  })

  const after = await counts(r.id)
  const dAfter = await depth()
  const secs = ((Date.now() - t0) / 1000).toFixed(1)

  console.log(`\nAFTER      ${after.total} rows (+${after.total - before.total}) · ${after.active} active (+${after.active - before.active}) · ${after.priced} priced (+${after.priced - before.priced}) · ${after.matched} priced+matched (+${after.matched - before.matched})`)
  console.log(`           site depth: ${dAfter.one} @1 (${dAfter.one - dBefore.one >= 0 ? '+' : ''}${dAfter.one - dBefore.one}) · ${dAfter.two} @2 (${dAfter.two - dBefore.two >= 0 ? '+' : ''}${dAfter.two - dBefore.two}) · ${dAfter.three} @3+ (${dAfter.three - dBefore.three >= 0 ? '+' : ''}${dAfter.three - dBefore.three})`)
  console.log(`           observations ${after.observations} (${after.observations - before.observations >= 0 ? '+' : ''}${after.observations - before.observations}) · newest observation ${after.newestObservation} · newest last_seen ${after.newestLastSeen}`)
  if (after.observations === before.observations && after.newestObservation === before.newestObservation) {
    console.log(`           UNCHANGED FEED: no new observation and no new observation date — old prices did not acquire false freshness`)
  }
  console.log(`adapter    ${result.productsFetched} products ingested · ${result.listingsCreated} created · ${result.listingsUpdated} updated · ${result.priceChanges} price changes · ${result.errors.length} errors · ${secs}s`)
  for (const e of result.errors.slice(0, 5)) console.log(`  [${e.type}] ${e.message}${e.context ? ` · ${e.context}` : ''}`)
  console.log(`checkpoint ${ckPath}`)

  await prisma.$disconnect()
}

main().catch(async e => { await prisma.$disconnect(); console.error(e); process.exit(1) })
