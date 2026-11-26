/**
 * test-offer-health-alerts.ts — demonstrate the B4 alarms.
 *
 * The alarms are a pure function of a snapshot, so each one can be fired here
 * against forced inputs and its exact payload printed. That is the difference
 * between "alerting exists" and "the alert has been seen to fire".
 *
 * Part 1 replays the B4 timeline and asserts the right alarm fires at each
 * stage. Part 2 reads the REAL current snapshot and shows what it says today.
 *
 * Never prints the Slack webhook, only whether one is configured.
 *
 *   npx dotenv -e <main>/.env.local -- npx tsx scripts/test-offer-health-alerts.ts
 */
import { PrismaClient } from '@prisma/client'
import { formatAlert }  from '@/lib/alerts/notify'
import {
  evaluateOfferHealth, SOFT_DELETE_POLICY_DAYS, STALL_HOURS, EXPIRY_WARN_DAYS,
} from '@/lib/alerts/offer-health'

const prisma = new PrismaClient()
const NOW = new Date('2026-11-26T12:00:00.000Z')
const daysBefore = (d: number) => new Date(NOW.getTime() - d * 86_400_000)
const hoursBefore = (h: number) => new Date(NOW.getTime() - h * 3_600_000)

let failures = 0
function expect(label: string, keys: string[], wanted: string[]) {
  const ok = wanted.every(w => keys.includes(w)) && keys.length === wanted.length
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)
  console.log(`        fired: [${keys.join(', ') || 'none'}]`)
  if (!ok) { console.log(`        wanted: [${wanted.join(', ')}]`); failures++ }
}

async function main() {
  console.log(`thresholds: policy ${SOFT_DELETE_POLICY_DAYS}d · stall ${STALL_HOURS}h · expiry warning ${EXPIRY_WARN_DAYS}d`)
  console.log(`Slack webhook configured: ${process.env.SLACK_WEBHOOK_URL ? 'yes' : 'no'}`)

  console.log('\n═══ PART 1 — replay the B4 timeline ═══')

  console.log('\n[1] healthy: refreshed today, offers seen today')
  expect('silent', evaluateOfferHealth({
    now: NOW, pricedListings: 10, pricedProducts: 10, productsAtTwoRetailers: 0,
    previousPricedListings: 10,
    lastSuccessfulRefreshAt: hoursBefore(10),
    oldestActiveLastSeenAt:  hoursBefore(10),
  }).alerts.map(a => a.key), [])

  console.log('\n[2] 27 Sept — one day after the last manual refresh ever ran')
  expect('silent (nothing wrong yet)', evaluateOfferHealth({
    now: NOW, pricedListings: 2246, pricedProducts: 2246, productsAtTwoRetailers: 0,
    previousPricedListings: 2246,
    lastSuccessfulRefreshAt: hoursBefore(30),
    oldestActiveLastSeenAt:  hoursBefore(30),
  }).alerts.map(a => a.key), [])

  console.log('\n[3] 29 Sept — the refresh has now missed a day')
  expect('stall fires', evaluateOfferHealth({
    now: NOW, pricedListings: 2246, pricedProducts: 2246, productsAtTwoRetailers: 0,
    previousPricedListings: 2246,
    lastSuccessfulRefreshAt: hoursBefore(60),
    oldestActiveLastSeenAt:  hoursBefore(60),
  }).alerts.map(a => a.key), ['offer-refresh-stalled'])

  console.log('\n[4] 21 Oct — six days before the sweep would remove everything')
  {
    const v = evaluateOfferHealth({
      now: NOW, pricedListings: 2246, pricedProducts: 2246, productsAtTwoRetailers: 0,
      previousPricedListings: 2246,
      lastSuccessfulRefreshAt: daysBefore(24),
      oldestActiveLastSeenAt:  daysBefore(24),
    })
    expect('stall + expiry warning', v.alerts.map(a => a.key),
      ['offer-refresh-stalled', 'offers-approaching-expiry'])
    console.log(`        days to expiry: ${v.daysToExpiry?.toFixed(1)}`)
    for (const a of v.alerts) console.log('\n' + formatAlert(a).split('\n').map(l => '        ' + l).join('\n'))
  }

  console.log('\n[5] 26 Oct — the last day before the 03:00 sweep')
  {
    const v = evaluateOfferHealth({
      now: NOW, pricedListings: 2246, pricedProducts: 2246, productsAtTwoRetailers: 0,
      previousPricedListings: 2246,
      lastSuccessfulRefreshAt: daysBefore(29),
      oldestActiveLastSeenAt:  daysBefore(29),
    })
    expect('expiry escalates to critical', v.alerts.map(a => a.key),
      ['offer-refresh-stalled', 'offers-approaching-expiry'])
    const expiry = v.alerts.find(a => a.key === 'offers-approaching-expiry')
    console.log(`        severity: ${expiry?.severity} (expected critical)`)
    if (expiry?.severity !== 'critical') failures++
  }

  console.log('\n[6] 27 Oct 03:00 — the sweep has run; the site now shows no prices')
  {
    const v = evaluateOfferHealth({
      now: NOW, pricedListings: 0, pricedProducts: 0, productsAtTwoRetailers: 0,
      previousPricedListings: 2246,
      lastSuccessfulRefreshAt: daysBefore(31),
      oldestActiveLastSeenAt:  null,
    })
    expect('stall + zero coverage', v.alerts.map(a => a.key),
      ['offer-refresh-stalled', 'priced-coverage-zero'])
    for (const a of v.alerts) console.log('\n' + formatAlert(a).split('\n').map(l => '        ' + l).join('\n'))
  }

  console.log('\n[7] coverage halves overnight (a retailer stops responding)')
  {
    const v = evaluateOfferHealth({
      now: NOW, pricedListings: 4, pricedProducts: 4, productsAtTwoRetailers: 0,
      previousPricedListings: 10,
      lastSuccessfulRefreshAt: hoursBefore(2),
      oldestActiveLastSeenAt:  hoursBefore(2),
    })
    expect('falling coverage fires', v.alerts.map(a => a.key), ['priced-coverage-falling'])
    for (const a of v.alerts) console.log('\n' + formatAlert(a).split('\n').map(l => '        ' + l).join('\n'))
  }

  console.log('\n[8] the job has never succeeded (a schedule registered but never run)')
  expect('never-succeeded fires', evaluateOfferHealth({
    now: NOW, pricedListings: 10, pricedProducts: 10, productsAtTwoRetailers: 0,
    previousPricedListings: null,
    lastSuccessfulRefreshAt: null,
    oldestActiveLastSeenAt:  hoursBefore(1),
  }).alerts.map(a => a.key), ['offer-refresh-never-succeeded'])

  console.log('\n═══ PART 2 — the real snapshot, right now ═══')
  const [priced] = await prisma.$queryRaw<{ c: bigint }[]>`
    SELECT COUNT(*)::bigint AS c FROM retailer_listings
    WHERE deleted_at IS NULL AND price_amount > 0`
  const [products] = await prisma.$queryRaw<{ c: bigint }[]>`
    SELECT COUNT(DISTINCT canonical_product_id)::bigint AS c FROM retailer_listings
    WHERE deleted_at IS NULL AND price_amount > 0 AND canonical_product_id IS NOT NULL`
  const [two] = await prisma.$queryRaw<{ c: bigint }[]>`
    SELECT COUNT(*)::bigint AS c FROM (
      SELECT canonical_product_id FROM retailer_listings
      WHERE deleted_at IS NULL AND price_amount > 0 AND canonical_product_id IS NOT NULL
      GROUP BY canonical_product_id HAVING COUNT(DISTINCT retailer_id) >= 2) t`
  const [oldest] = await prisma.$queryRaw<{ ts: Date | null }[]>`
    SELECT MIN(last_seen_at) AS ts FROM retailer_listings
    WHERE deleted_at IS NULL AND price_amount > 0`
  const lastRefresh = await prisma.jobRun.findFirst({
    where: { jobName: 'offer_refresh.verified_offers', status: 'success' },
    orderBy: { finishedAt: 'desc' }, select: { finishedAt: true },
  })

  const real = evaluateOfferHealth({
    now: new Date(),
    pricedListings:         Number(priced.c),
    pricedProducts:         Number(products.c),
    productsAtTwoRetailers: Number(two.c),
    previousPricedListings: null,
    lastSuccessfulRefreshAt: lastRefresh?.finishedAt ?? null,
    oldestActiveLastSeenAt:  oldest.ts ? new Date(oldest.ts) : null,
  })
  console.log(`  priced listings ${Number(priced.c)} · priced products ${Number(products.c)} · at 2+ retailers ${Number(two.c)}`)
  console.log(`  oldest active offer last seen: ${oldest.ts ? new Date(oldest.ts).toISOString() : 'none'}`)
  console.log(`  days until it would be swept: ${real.daysToExpiry?.toFixed(1) ?? 'n/a'}`)
  console.log(`  last successful offer refresh: ${lastRefresh?.finishedAt?.toISOString() ?? 'NEVER — the cron has not run yet'}`)
  console.log(`  alarms firing now: [${real.alerts.map(a => a.key).join(', ') || 'none'}]`)
  for (const a of real.alerts) console.log('\n' + formatAlert(a).split('\n').map(l => '    ' + l).join('\n'))

  await prisma.$disconnect()
  console.log(`\n${failures === 0 ? 'ALL ALARM CHECKS PASSED' : `${failures} ALARM CHECK(S) FAILED`}`)
  if (failures > 0) process.exit(1)
}

main().catch(async e => {
  await prisma.$disconnect()
  console.error(e)
  process.exit(1)
})
