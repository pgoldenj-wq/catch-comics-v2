/**
 * awin-entitlements.ts — READ-ONLY. Asks Awin which merchants this publisher
 * account is actually approved for, and cross-references the answer against
 * our own retailer records.
 *
 * This exists because a missing env var is not proof of a missing entitlement.
 * AWIN_API_TOKEN (the Publisher API) is unset, but AWIN_DATAFEED_KEY (the
 * product datafeed download key) IS set, and the datafeed key is the one the
 * feed adapter actually uses. The two are different credentials for different
 * APIs, and confusing them is how a working feed gets written off.
 *
 * ONE small request: the datafeed LIST endpoint, which returns a CSV index of
 * every feed the publisher may download — not a 200MB product feed.
 *
 * The key is never printed. It is redacted from every URL and error message
 * before anything reaches stdout.
 *
 *   npx dotenv -e <main>/.env.local -- npx tsx scripts/awin-entitlements.ts
 */
import { PrismaClient } from '@prisma/client'
import { existsSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { tmpdir }       from 'node:os'
import { join }         from 'node:path'

const prisma = new PrismaClient()

const KEY = process.env.AWIN_DATAFEED_KEY
const LIST_URL = (k: string) => `https://productdata.awin.com/datafeed/list/apikey/${k}/`

/** Remove the datafeed key from anything about to be printed. */
function redact(s: string): string {
  if (!KEY) return s
  return s.split(KEY).join('<AWIN_DATAFEED_KEY>')
}

/** Split one CSV line, honouring double quotes. */
function splitCsv(line: string): string[] {
  const out: string[] = []
  let cur = '', inQ = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++ } else inQ = !inQ
    } else if (c === ',' && !inQ) { out.push(cur); cur = '' }
    else cur += c
  }
  out.push(cur)
  return out.map(s => s.trim())
}

async function main() {
  console.log('# Awin entitlements\n')
  console.log(`AWIN_DATAFEED_KEY : ${KEY ? 'SET' : 'NOT SET'}`)
  console.log(`AWIN_PUBLISHER_ID : ${process.env.AWIN_PUBLISHER_ID ? 'SET' : 'NOT SET'}`)
  console.log(`AWIN_API_TOKEN    : ${process.env.AWIN_API_TOKEN ? 'SET' : 'NOT SET'}  (Publisher API — NOT used by the feed adapter)`)
  if (!KEY) {
    console.log('\nNo datafeed key, so no feed access to establish. Stopping.')
    await prisma.$disconnect()
    return
  }

  // The list is ~500KB and changes slowly. Cache it so repeated analysis costs
  // the provider nothing. --refresh forces a new download.
  const cachePath = join(tmpdir(), 'catchcomics-awin-datafeed-list.csv')
  const refresh   = process.argv.includes('--refresh')
  let text: string

  if (!refresh && existsSync(cachePath)) {
    text = readFileSync(cachePath, 'utf8')
    const ageMin = Math.round((Date.now() - statSync(cachePath).mtimeMs) / 60_000)
    console.log(`\nusing cached feed list (${ageMin} min old, ${text.length.toLocaleString()} bytes) — pass --refresh to re-download`)
  } else {
    console.log(`\nGET https://productdata.awin.com/datafeed/list/apikey/<AWIN_DATAFEED_KEY>/`)
    let res: Response
    try {
      res = await fetch(LIST_URL(KEY), {
        headers: { 'User-Agent': 'CatchComics/1.0 (+https://catchcomics.com/bot)', Accept: 'text/csv,*/*' },
      })
    } catch (e) {
      console.log(`request failed: ${redact(e instanceof Error ? e.message : String(e))}`)
      await prisma.$disconnect()
      process.exit(1)
    }
    text = await res.text()
    console.log(`http ${res.status} · ${text.length.toLocaleString()} bytes\n`)
    if (res.status !== 200) {
      console.log('body (redacted):')
      console.log(redact(text).slice(0, 600))
      console.log('\nNo entitlement list retrieved — the stage that stops here is SOURCE ACCESS.')
      await prisma.$disconnect()
      process.exit(1)
    }
    writeFileSync(cachePath, text)
  }

  const lines  = text.split(/\r?\n/).filter(l => l.trim().length > 0)
  const header = splitCsv(lines[0])
  console.log(`columns: ${header.join(' | ')}\n`)

  const idx = (want: string) => header.findIndex(h => h.toLowerCase().replace(/[^a-z]/g, '').includes(want))
  const iAdvName = idx('advertisername')
  const iAdvId   = idx('advertiserid')
  const iFeedId  = idx('feedid')
  const iStatus  = idx('membershipstatus')
  const iRegion  = idx('primaryregion')
  const iCount   = idx('noofproducts')
  const iImport  = idx('lastimported')

  interface Row { name: string; advId: string; feedId: string; status: string; region: string; products: string; imported: string }
  const rows: Row[] = lines.slice(1).map(l => {
    const c = splitCsv(l)
    const at = (i: number) => (i >= 0 && i < c.length ? c[i] : '')
    return {
      name: at(iAdvName), advId: at(iAdvId), feedId: at(iFeedId), status: at(iStatus),
      region: at(iRegion), products: at(iCount), imported: at(iImport),
    }
  }).filter(r => r.feedId)

  const joined = rows.filter(r => /join|active|approve/i.test(r.status))
  console.log(`${rows.length} feed(s) listed · ${joined.length} with an active/joined membership\n`)

  console.log('## Feeds this publisher may download\n')
  for (const r of rows.sort((a, b) => Number(b.products || 0) - Number(a.products || 0))) {
    const flag = /join|active|approve/i.test(r.status) ? 'JOINED  ' : r.status.padEnd(8).slice(0, 8)
    console.log(`  ${flag} ${(r.name || '?').padEnd(30).slice(0, 30)} feed ${String(r.feedId).padEnd(8)} ${String(r.products || '?').padStart(9)} products · ${r.region || '?'} · imported ${r.imported || '?'}`)
  }

  // ── Direct name search for the retailers we care about ───────────────────
  // The cross-reference below is fuzzy and WILL produce false positives
  // ("EngageBay" for eBay). This section is the exact one: it searches the
  // whole list by name, so an absent retailer is genuinely absent.
  console.log('\n## Lead retailers — exact name search over all feeds\n')
  const LEADS = [
    'waterstones', 'wordery', 'whsmith', 'smiths', 'blackwell', 'foyles',
    'forbidden planet', 'zavvi', 'abebooks', 'world of books', 'wob',
    'travelling man', 'bookshop', 'lets buy books', 'scholastic',
    'amazon', 'ebay', 'hive', 'comic', 'book depository', 'speedyhen',
    'awesome books', 'magazine',
  ]
  for (const term of LEADS) {
    const hits = rows.filter(r => (r.name || '').toLowerCase().includes(term))
    if (hits.length === 0) {
      console.log(`  ${term.padEnd(18)} NOT PRESENT in the publisher's feed list`)
      continue
    }
    for (const h of hits.sort((a, b) => Number(b.products || 0) - Number(a.products || 0)).slice(0, 6)) {
      console.log(`  ${term.padEnd(18)} "${h.name}" feed ${String(h.feedId).padEnd(8)} ${h.status.padEnd(10)} ${String(h.products || '?').padStart(8)} products · ${h.region} · imported ${h.imported}`)
    }
  }

  // ── Cross-reference with our own retailer records ────────────────────────
  console.log('\n## Against our retailer records (FUZZY — verify against the search above)\n')
  const retailers = await prisma.retailer.findMany({
    select: { name: true, domain: true, platform: true, isActive: true, syncConfig: true },
    orderBy: { name: 'asc' },
  })

  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  for (const rt of retailers) {
    const cfg = (rt.syncConfig ?? {}) as Record<string, unknown>
    const storedFeedId = cfg.feed_id ? String(cfg.feed_id) : null
    const hit = rows.find(r =>
      (storedFeedId && String(r.feedId) === storedFeedId) ||
      norm(r.name || '').includes(norm(rt.name)) ||
      norm(rt.name).includes(norm(r.name || '')) ||
      norm(r.name || '').includes(norm(rt.domain.split('.')[0])))
    if (!hit) {
      console.log(`  ${rt.domain.padEnd(24)} ${rt.platform.padEnd(16)} no Awin feed matched`)
      continue
    }
    const joinedNow = /join|active|approve/i.test(hit.status)
    console.log(`  ${rt.domain.padEnd(24)} ${rt.platform.padEnd(16)} Awin "${hit.name}" feed ${hit.feedId} · ${hit.status} · ${hit.products} products`)
    if (storedFeedId && String(hit.feedId) !== storedFeedId) {
      console.log(`      stored feed_id ${storedFeedId} DIFFERS from the listed feed ${hit.feedId}`)
    }
    if (!storedFeedId && joinedNow) {
      console.log(`      no feed_id in sync_config — a joined feed exists but nothing is configured to download it`)
    }
    if (joinedNow && rt.platform !== 'AWIN_FEED') {
      console.log(`      platform is ${rt.platform}, so the AWIN_FEED adapter will refuse it even though the feed is joined`)
    }
  }

  await prisma.$disconnect()
}

main().catch(async e => {
  await prisma.$disconnect()
  console.error(redact(e instanceof Error ? (e.stack ?? e.message) : String(e)))
  process.exit(1)
})
