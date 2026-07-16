/**
 * test-lbb-containment.ts — proves the Lets Buy Books containment holds
 * (2026-07-16): the ungated hourly adapter path skips LBB, other scheduled
 * retailers are unaffected, duplicate LBB offers collapse to the trusted
 * ISBN-13 listing, and affiliate wrapping is unchanged.
 *
 * Run: npm run test:containment   (pure functions — no DB, no network)
 */

process.env.AWIN_PUBLISHER_ID = process.env.AWIN_PUBLISHER_ID || '2888331'

import { isScheduledSyncDisabled, isDueForScheduledSync } from '../lib/sync/dispatch'
import { suppressDuplicateRetailerListings } from '../lib/listings/dedupeListings'
import { classifyCanonicalComicShape } from '../lib/identity/comicShape'
import { wrapAffiliateUrl } from '../lib/affiliate'

let failures = 0
function check(label: string, ok: boolean, detail = '') {
  if (ok) console.log(`✓ ${label}`)
  else { failures++; console.error(`✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}

const NOW = Date.now()
const hoursAgo = (h: number) => new Date(NOW - h * 60 * 60 * 1000)

// ── isScheduledSyncDisabled — flag semantics ─────────────────────────────────
check('flag: true → disabled', isScheduledSyncDisabled({ scheduled_sync_disabled: true }) === true)
check('flag: false → enabled', isScheduledSyncDisabled({ scheduled_sync_disabled: false }) === false)
check('flag: absent → enabled', isScheduledSyncDisabled({ feed_id: '112530', feed_format: 'csv' }) === false)
check('flag: null config → enabled', isScheduledSyncDisabled(null) === false)
check('flag: string "true" is NOT the flag (strict boolean)', isScheduledSyncDisabled({ scheduled_sync_disabled: 'true' }) === false)

// ── isDueForScheduledSync — LBB excluded, others unaffected ─────────────────
const lbbFlagged = {
  platform: 'AWIN_FEED',
  lastSyncedAt: hoursAgo(24 * 100),   // 100 days overdue — still excluded
  syncConfig: { feed_id: '112530', feed_format: 'csv', scheduled_sync_disabled: true },
}
check('LBB (flagged) never due, even 100 days overdue', isDueForScheduledSync(lbbFlagged, NOW) === false)

const awinUnflagged = { platform: 'AWIN_FEED', lastSyncedAt: hoursAgo(25), syncConfig: { feed_id: '2957' } }
check('unflagged AWIN_FEED retailer due after 24h default', isDueForScheduledSync(awinUnflagged, NOW) === true)
check('unflagged AWIN_FEED retailer NOT due after 1h', isDueForScheduledSync({ ...awinUnflagged, lastSyncedAt: hoursAgo(1) }, NOW) === false)

const shopify = { platform: 'SHOPIFY', lastSyncedAt: hoursAgo(7), syncConfig: {} }
check('SHOPIFY retailer (WoB/TM-shaped) due after 6h default — unaffected', isDueForScheduledSync(shopify, NOW) === true)
check('SHOPIFY retailer NOT due after 1h — unaffected', isDueForScheduledSync({ ...shopify, lastSyncedAt: hoursAgo(1) }, NOW) === false)
check('never-synced unflagged retailer is due', isDueForScheduledSync({ platform: 'AWIN_FEED', lastSyncedAt: null, syncConfig: {} }, NOW) === true)
check('syncConfig.refreshIntervalHours override respected', isDueForScheduledSync({ platform: 'AWIN_FEED', lastSyncedAt: hoursAgo(2), syncConfig: { refreshIntervalHours: 1 } }, NOW) === true)

for (const platform of ['EBAY', 'MANUAL', 'DIRECT_AFFILIATE', 'CJ_FEED', 'DYNAMIC_LINK']) {
  check(`skip platform ${platform} never due`, isDueForScheduledSync({ platform, lastSyncedAt: null, syncConfig: {} }, NOW) === false)
}

// ── Duplicate-offer suppression — one trusted LBB offer per product ──────────
type L = { id: string; retailerSku: string; lastSeenAt: Date; retailer: { domain: string } }
const lbb = (id: string, sku: string, h: number): L =>
  ({ id, retailerSku: sku, lastSeenAt: hoursAgo(h), retailer: { domain: 'letsbuybooks.com' } })
const tm = (id: string, sku: string, h: number): L =>
  ({ id, retailerSku: sku, lastSeenAt: hoursAgo(h), retailer: { domain: 'travellingman.com' } })

// Real duplicate pair from prod: Wings of Fire GN 5 — ISBN sku vs merchant sku.
// The merchant-sku row is NEWER; the ISBN row must still win.
const pair = [lbb('isbn', '9781338730852', 10), lbb('merchant', '56699608465790', 1)]
let out = suppressDuplicateRetailerListings(pair)
check('ISBN-13 listing beats newer merchant-SKU duplicate', out.length === 1 && out[0].id === 'isbn')

out = suppressDuplicateRetailerListings([lbb('old', '42807607623917', 48), lbb('new', '56589783433598', 2)])
check('no-ISBN duplicate pair → newest survives', out.length === 1 && out[0].id === 'new')

out = suppressDuplicateRetailerListings([lbb('badsum', '9781338730853', 1), lbb('valid', '9780702330025', 20)])
check('checksum-invalid 13-digit SKU is not an ISBN — valid ISBN wins', out.length === 1 && out[0].id === 'valid')

out = suppressDuplicateRetailerListings([tm('tm1', 'sku-a', 5), tm('tm2', 'sku-b', 1)])
check('other retailers untouched (TM duplicate preserved)', out.length === 2)

out = suppressDuplicateRetailerListings([lbb('only', '9781338730852', 5)])
check('single LBB listing untouched', out.length === 1 && out[0].id === 'only')

const mixed = [tm('tm1', 'x', 9), lbb('merchant', '56699608465790', 1), tm('tm2', 'y', 3), lbb('isbn', '9781338730852', 10)]
out = suppressDuplicateRetailerListings(mixed)
check('mixed page: LBB collapsed to ISBN row, others in original order',
  out.map(l => l.id).join(',') === 'tm1,tm2,isbn')

check('empty list handled', suppressDuplicateRetailerListings([]).length === 0)

// ── No path refreshes a rejected non-comic LBB row ───────────────────────────
// (a) the gated CLI sync rejects it before the write path… ('uncertain' and
//     'non-comic' are both rejected — only 'comic' may be refreshed)
check('gate still rejects a real LBB pollution title (Speedy BOSH cookery book)',
  classifyCanonicalComicShape({ format: 'HARDCOVER', publisher: null, title: 'Speedy BOSH 100+ Quick Plant-Based Meals In 30 Minutes' }) !== 'comic')
check('gate still rejects an explicit cookbook title',
  classifyCanonicalComicShape({ format: 'HARDCOVER', publisher: null, title: 'The Mediterranean Cookbook' }) === 'non-comic')
// (b) …and the hourly path never runs for the flagged retailer.
check('flagged LBB retailer is unreachable by the scheduled path', isDueForScheduledSync(lbbFlagged, NOW) === false)

// ── Affiliate wrapping unchanged ──────────────────────────────────────────────
const wrapped = wrapAffiliateUrl('https://www.letsbuybooks.com/products/x', 'awin', '122824', 'cc-86350171')
check('awin wrap: cread.php base', wrapped.startsWith('https://www.awin1.com/cread.php?'))
check('awin wrap: mid 122824', wrapped.includes('awinmid=122824'))
check('awin wrap: affiliate id 2888331', wrapped.includes('awinaffid=2888331'))
check('awin wrap: single clickref', (wrapped.match(/clickref=/g) ?? []).length === 1 && wrapped.includes('clickref=cc-86350171'))
check('awin wrap: ued round-trips to the bare merchant URL (no double wrap)',
  new URL(wrapped).searchParams.get('ued') === 'https://www.letsbuybooks.com/products/x')

console.log(failures === 0 ? '\nLBB CONTAINMENT: PASS' : `\nLBB CONTAINMENT: FAIL — ${failures} failure(s)`)
process.exit(failures === 0 ? 0 : 1)
