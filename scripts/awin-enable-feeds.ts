/**
 * awin-enable-feeds.ts — configure the entitled Awin feeds so the existing
 * adapter and scheduler will actually run them.
 *
 * DEFAULT MODE IS READ-ONLY. Writes only with --write.
 *
 * Nothing here is a new integration. Every one of these retailers already has
 * an active, joined Awin feed; what was missing was configuration:
 *
 *   waterstones.com   platform DIRECT_AFFILIATE, no feed_id  → AWIN_FEED + feed 3787
 *   scholastic.co.uk  AWIN_FEED but no feed_id               → feed 2957
 *   letsbuybooks.com  AWIN_FEED, feed 112530 already set     → unchanged, just enabled
 *   uk.bookshop.org   HELD — see below
 *
 * Changing `platform` is safe for shoppers: outbound links are wrapped from
 * `affiliate_network` + `affiliate_id` (lib/affiliate.ts), and nothing on the
 * product page, in OffersTable or in /go reads `platform`. It is used by the
 * admin UI, API validation and adapter dispatch only.
 *
 * `comic_filter: true` is set on every one of them. Without it a single
 * Waterstones sync would create ~150,000 listings for general books we do not
 * carry; with it, only ISBNs already present as comic-eligible catalogue
 * editions are ingested.
 *
 * Bookshop UK is deliberately NOT enabled. Its 23,080-product feed was last
 * built by Awin on 2026-09-23 — over two months ago. Ingesting it would
 * publish two-month-old prices, and the adapter's freshness gate would refuse
 * them anyway. Recorded with a hold reason instead.
 *
 *   npx dotenv -e <main>/.env.local -- npx tsx scripts/awin-enable-feeds.ts
 *   npx dotenv -e <main>/.env.local -- npx tsx scripts/awin-enable-feeds.ts --write
 */
import { PrismaClient, Prisma, RetailerPlatform } from '@prisma/client'

const prisma = new PrismaClient()
const WRITE = process.argv.includes('--write')
/**
 * --hold forces scheduled_sync_disabled=true for every feed.
 *
 * This exists because enabling scheduling is effective IMMEDIATELY: the hourly
 * sync-retailer-scheduled cron reads retailers from the database, so a config
 * flip takes effect against whatever adapter code is CURRENTLY DEPLOYED. Until
 * the comic_filter build is in production, an enabled Waterstones feed would
 * ingest ~154,000 general-book listings on the next tick. Enable only after
 * the deploy.
 */
const HOLD = process.argv.includes('--hold')

interface Plan {
  domain: string
  feedId: string
  /**
   * The Awin ADVERTISER id, which is what `/go` must send as `awinmid`.
   * Resolved two independent ways on 2026-11-26 and cross-checked:
   *   - the "Advertiser ID" column of the publisher's datafeed index
   *   - the `m=` parameter of the feed's own aw_deep_link
   *     (e.g. awin1.com/pclick.php?p=…&a=2888331&m=3787)
   * For Waterstones the advertiser id and the feed id are both 3787. That is a
   * coincidence of Awin's older numbering, not a copy-paste error, and it is
   * why the stale `awinMerchantId_BROKEN: 2079` note was misleading.
   */
  advertiserId: string
  platform: RetailerPlatform
  enable: boolean
  holdReason?: string
}

const PLAN: Plan[] = [
  { domain: 'waterstones.com',  feedId: '3787',   advertiserId: '3787',   platform: 'AWIN_FEED', enable: true },
  { domain: 'scholastic.co.uk', feedId: '2957',   advertiserId: '2957',   platform: 'AWIN_FEED', enable: true },
  { domain: 'letsbuybooks.com', feedId: '112530', advertiserId: '122824', platform: 'AWIN_FEED', enable: true },
  {
    domain: 'uk.bookshop.org', feedId: '99173', advertiserId: '62675', platform: 'AWIN_FEED', enable: false,
    holdReason: 'Awin last built feed 99173 on 2026-09-23; publishing it would present two-month-old prices as current. Enable when Awin rebuilds the feed, or when BOOKSHOP_API_KEY is set.',
  },
]

async function main() {
  console.log(`MODE: ${WRITE ? 'WRITE' : 'DRY-RUN (read-only, default)'}\n`)

  for (const p of PLAN) {
    const r = await prisma.retailer.findUnique({ where: { domain: p.domain } })
    if (!r) { console.log(`  MISSING  ${p.domain} — no retailer row`); continue }

    const cfg = { ...(r.syncConfig as Record<string, unknown> ?? {}) }
    const before = {
      platform: r.platform,
      feed_id: cfg.feed_id ?? null,
      comic_filter: cfg.comic_filter ?? null,
      scheduled_sync_disabled: cfg.scheduled_sync_disabled ?? null,
    }

    cfg.feed_id      = p.feedId
    cfg.feed_format  = cfg.feed_format ?? 'csv'
    cfg.comic_filter = true
    const enable = p.enable && !HOLD
    cfg.scheduled_sync_disabled = !enable
    const reason = p.holdReason
      ?? (HOLD ? 'held until the comic_filter build is deployed — the hourly scheduler runs whatever adapter is live in production, and the current one has no catalogue gate' : undefined)
    if (reason) cfg.hold_reason = reason
    else delete cfg.hold_reason

    const after = {
      platform: p.platform,
      feed_id: cfg.feed_id,
      comic_filter: cfg.comic_filter,
      scheduled_sync_disabled: cfg.scheduled_sync_disabled,
    }

    console.log(`  ${p.domain}`)
    console.log(`    platform                 ${before.platform} -> ${after.platform}${before.platform === after.platform ? '  (unchanged)' : ''}`)
    console.log(`    feed_id                  ${before.feed_id ?? '—'} -> ${after.feed_id}`)
    console.log(`    comic_filter             ${before.comic_filter ?? '—'} -> ${after.comic_filter}`)
    console.log(`    scheduled_sync_disabled  ${before.scheduled_sync_disabled ?? '—'} -> ${after.scheduled_sync_disabled}`)
    if (p.holdReason) console.log(`    HELD: ${p.holdReason}`)

    // Affiliate wrapping sanity — this is what decides whether a click earns
    // anything. /go sends affiliate_id as awinmid.
    console.log(`    affiliate: network ${r.affiliateNetwork ?? '—'} · id ${r.affiliateId ?? '—'}`)
    if (String(r.affiliateId) !== p.advertiserId) {
      console.log(`    WARNING affiliate_id ${r.affiliateId} != Awin advertiser id ${p.advertiserId} — /go would send the wrong awinmid`)
    } else {
      console.log(`    affiliate_id matches the Awin advertiser id ${p.advertiserId} (verified from the datafeed index and the feed's own deep links)`)
    }
    // Replace the stale investigation notes with the resolved value, so the
    // next person does not re-open a question that is now answered.
    if (cfg.awinMerchantId_BROKEN !== undefined || cfg.awinMerchantId_CORRECT !== undefined) {
      console.log(`    clearing stale notes: BROKEN=${String(cfg.awinMerchantId_BROKEN ?? '—')} CORRECT=${String(cfg.awinMerchantId_CORRECT ?? '—')} -> awinMerchantId_VERIFIED=${p.advertiserId}`)
      delete cfg.awinMerchantId_BROKEN
      delete cfg.awinMerchantId_CORRECT
    }
    cfg.awinMerchantId_VERIFIED = p.advertiserId
    cfg.awinMerchantId_VERIFIED_ON = '2026-11-26'

    if (WRITE) {
      await prisma.retailer.update({
        where: { id: r.id },
        data: { platform: p.platform, syncConfig: cfg as Prisma.InputJsonValue },
      })
      console.log(`    WRITTEN`)
    }
    console.log('')
  }

  if (!WRITE) console.log('No changes written. Re-run with --write to apply.')
  await prisma.$disconnect()
}

main().catch(async e => { await prisma.$disconnect(); console.error(e); process.exit(1) })
