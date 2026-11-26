/**
 * b4-probe-second-feed.ts — READ-ONLY, bounded live probe.
 *
 * Tests whether a SECOND price is obtainable today for the editions Travelling
 * Man already prices, using the project's HONEST bot User-Agent rather than a
 * spoofed browser one. That distinction is the point of the probe: if the data
 * is reachable while identifying ourselves truthfully, no posture decision is
 * needed; if it is not, that is the founder's call to make knowingly.
 *
 * At most MAX_REQUESTS requests, sequential, politely paced. Zero writes.
 *
 *   npx dotenv -e <main>/.env.local -- npx tsx scripts/b4-probe-second-feed.ts
 */
import { PrismaClient }       from '@prisma/client'
import { verifyRow, cost, resetCost } from '@/lib/retailers/shopify-verify'
import { generateWorderyUrl } from '@/lib/adapters/wordery'

const prisma = new PrismaClient()

const HONEST_UA   = 'CatchComics/1.0 (+https://catchcomics.com/bot)'
const MAX_PER_SITE = 2
const BETWEEN_MS   = 2_000
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

async function main() {
  resetCost()

  // The editions Travelling Man currently prices.
  const restored = await prisma.retailerListing.findMany({
    where: {
      retailer: { domain: 'travellingman.com' },
      deletedAt: null, priceAmount: { gt: 0 },
    },
    select: {
      priceAmount: true, isbn13: true,
      canonicalProduct: { select: { id: true, canonicalSlug: true, title: true, isbn13: true } },
    },
  })
  console.log(`Travelling Man prices ${restored.length} editions.\n`)

  const productIds = restored.map(r => r.canonicalProduct!.id)
  const tmPrice = new Map(restored.map(r => [r.canonicalProduct!.id, String(r.priceAmount)]))
  const tmIsbn  = new Map(restored.map(r => [r.canonicalProduct!.id, r.isbn13 ?? r.canonicalProduct!.isbn13]))
  const tmTitle = new Map(restored.map(r => [r.canonicalProduct!.id, r.canonicalProduct!.title]))

  // ── World of Books: SHOPIFY, so the shared verifier proves identity ───────
  console.log('═══ World of Books — Shopify, shared verifier, robots allows /products/*.js ═══')
  const wob = await prisma.retailerListing.findMany({
    where: { retailer: { domain: 'worldofbooks.com' }, canonicalProductId: { in: productIds } },
    select: {
      id: true, retailerSku: true, retailerUrl: true, priceAmount: true,
      deletedAt: true, canonicalProductId: true,
    },
    take: MAX_PER_SITE,
  })
  if (wob.length === 0) console.log('  no stored rows for these editions')
  for (const row of wob) {
    const title = tmTitle.get(row.canonicalProductId!) ?? '?'
    console.log(`\n  ${title}`)
    console.log(`    stored WoB £${row.priceAmount} · deleted_at ${row.deletedAt?.toISOString() ?? 'NULL (active)'}`)
    const v = await verifyRow('worldofbooks.com', row)
    console.log(`    live verify: ${v.klass}${v.live ? ` at £${v.live}` : ''}`)
    console.log(`    Travelling Man has it at £${tmPrice.get(row.canonicalProductId!)}`)
    if (v.klass === 'availableUnchanged' || v.klass === 'availablePriceChanged') {
      console.log(`    => a genuine two-retailer comparison is available for this edition TODAY`)
    }
    await sleep(BETWEEN_MS)
  }

  // ── Wordery: ISBN-keyed, honest UA, no spoofing ──────────────────────────
  console.log('\n═══ Wordery — ISBN-keyed, probed with the HONEST bot UA ═══')
  let done = 0
  for (const pid of productIds) {
    if (done >= MAX_PER_SITE) break
    const isbn = tmIsbn.get(pid)
    if (!isbn) continue
    const url = generateWorderyUrl(isbn)
    console.log(`\n  ${tmTitle.get(pid)}  (ISBN ${isbn})`)
    console.log(`    ${url}`)
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': HONEST_UA,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-GB,en;q=0.9',
        },
        redirect: 'follow',
      })
      const text = await res.text()
      const hasInertia = text.includes('id="inertia-root"') || text.includes('data-page=')
      const challenged = /cf-challenge|Just a moment|turnstile|cf_chl/i.test(text)
      const backToSearch = /\/search/i.test(res.url) && !/\/books\//i.test(res.url)
      console.log(`    http ${res.status} · final ${res.url}`)
      console.log(`    inertia data-page present: ${hasInertia} · cloudflare challenge: ${challenged} · bounced to search: ${backToSearch}`)
      if (hasInertia && !challenged) {
        const m = /&quot;price&quot;:\s*([0-9.]+)/.exec(text) ?? /"price":\s*([0-9.]+)/.exec(text)
        console.log(`    extracted price: ${m ? '£' + m[1] : 'not found in payload'}`)
        console.log(`    => reachable with an honest UA; no spoofing needed`)
      } else if (challenged) {
        console.log(`    => challenged. Honest-UA access does NOT work; this is a posture decision, not a code task.`)
      }
    } catch (e) {
      console.log(`    request failed: ${(e as Error).message}`)
    }
    done++
    await sleep(BETWEEN_MS)
  }

  console.log(`\nrequests made: ${cost.productRequests + done} (shopify ${cost.productRequests}, wordery ${done}) · zero writes`)
  await prisma.$disconnect()
}

main().catch(async e => {
  await prisma.$disconnect()
  console.error(e)
  process.exit(1)
})
