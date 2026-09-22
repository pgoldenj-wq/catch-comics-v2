/**
 * launch-signal.ts — did real people use Catch Comics today?
 *
 * Every /go/{listingId} redirect appends to click_events, and nothing has ever
 * read it back. A soft launch whose only question is "are real shoppers finding
 * comics and clicking through to buy them" cannot be run blind, so this is the
 * one report that answers it.
 *
 * Deliberately NOT a dashboard. Six numbers, the retailers behind them, and the
 * comics people actually clicked.
 *
 * READ-ONLY. Plain SELECTs against click_events and its joins. Writes exactly
 * one local file, launch/operations/launch-signal-latest.json, for the Command
 * Centre to read. No catalogue writes, no third-party call, no cost.
 *
 * Smoke runs make one /go click per run with User-Agent cc-launch-smoke/1;
 * those are excluded below so automation never inflates a launch metric.
 *
 * Run: npm run launch:signal            (default: trailing 7 days)
 *      npm run launch:signal -- --days 30
 */
import { PrismaClient } from '@prisma/client'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const prisma = new PrismaClient()

const OUT = 'launch/operations/launch-signal-latest.json'
/** User-Agents belonging to our own automation, never to a shopper. */
const BOT_UA = ['cc-launch-smoke/1', 'cc-ebay-relevance-audit/1']

const argDays = (() => {
  const i = process.argv.indexOf('--days')
  const n = i !== -1 ? Number(process.argv[i + 1]) : NaN
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 7
})()

const pct = (n: number, d: number) => (d > 0 ? `${((n / d) * 100).toFixed(0)}%` : '—')

async function main() {
  const since = new Date(Date.now() - argDays * 24 * 60 * 60 * 1000)

  console.log(`\n═══ LAUNCH SIGNAL — trailing ${argDays} day${argDays === 1 ? '' : 's'} ═══`)
  console.log(`since ${since.toISOString().slice(0, 16).replace('T', ' ')} UTC   (read-only)\n`)

  // Every click in the window that is not our own automation.
  const clicks = await prisma.clickEvent.findMany({
    where: {
      clickedAt: { gte: since },
      NOT: { userAgent: { in: BOT_UA } },
    },
    select: {
      userSession: true,
      referrer: true,
      clickedAt: true,
      listing: {
        select: {
          retailer: { select: { name: true } },
          canonicalProduct: { select: { title: true } },
        },
      },
    },
    orderBy: { clickedAt: 'desc' },
  })

  const total = clicks.length
  const sessions = new Set(clicks.map(c => c.userSession).filter(Boolean)).size
  const days = new Set(clicks.map(c => c.clickedAt.toISOString().slice(0, 10))).size

  const byRetailer = new Map<string, number>()
  const byProduct = new Map<string, number>()
  const byReferrer = new Map<string, number>()
  for (const c of clicks) {
    const r = c.listing?.retailer?.name ?? 'unknown'
    byRetailer.set(r, (byRetailer.get(r) ?? 0) + 1)
    const t = c.listing?.canonicalProduct?.title ?? '(unmatched listing)'
    byProduct.set(t, (byProduct.get(t) ?? 0) + 1)
    let ref = 'direct'
    if (c.referrer) {
      try { ref = new URL(c.referrer).hostname.replace(/^www\./, '') } catch { ref = 'other' }
    }
    byReferrer.set(ref, (byReferrer.get(ref) ?? 0) + 1)
  }
  const top = (m: Map<string, number>, n: number) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)

  console.log('CLICKOUTS')
  console.log(`  retailer clickouts   : ${total}`)
  console.log(`  distinct visitors    : ${sessions}   (anonymous __cc_session)`)
  console.log(`  days with any click  : ${days} of ${argDays}`)
  console.log(`  clicks per visitor   : ${sessions ? (total / sessions).toFixed(1) : '—'}`)

  if (total === 0) {
    console.log('\n  No human clickouts in the window.')
    console.log('  Before launch this is expected. After launch it is the number that matters.')
  } else {
    console.log('\nBY RETAILER')
    for (const [name, n] of top(byRetailer, 8)) {
      console.log(`  ${String(n).padStart(5)}  ${pct(n, total).padStart(4)}  ${name}`)
    }
    console.log('\nCOMICS PEOPLE CLICKED')
    for (const [title, n] of top(byProduct, 10)) {
      console.log(`  ${String(n).padStart(5)}  ${title.slice(0, 62)}`)
    }
    console.log('\nWHERE THEY CAME FROM')
    for (const [ref, n] of top(byReferrer, 6)) {
      console.log(`  ${String(n).padStart(5)}  ${ref}`)
    }
  }

  const payload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: 'read-only Postgres queries (scripts/launch-signal.ts)',
    windowDays: argDays,
    since: since.toISOString(),
    excludedUserAgents: BOT_UA,
    clickouts: total,
    visitors: sessions,
    activeDays: days,
    byRetailer: Object.fromEntries(top(byRetailer, 12)),
    topProducts: top(byProduct, 10).map(([title, clicks]) => ({ title, clicks })),
    byReferrer: Object.fromEntries(top(byReferrer, 8)),
  }
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(payload, null, 2) + '\n')
  console.log(`\nwrote ${OUT}\n`)
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
