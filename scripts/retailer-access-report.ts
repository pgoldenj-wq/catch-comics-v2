/**
 * retailer-access-report.ts — READ-ONLY inventory of what price access we
 * actually have, retailer by retailer.
 *
 * Zero writes. Zero provider requests. No secret is ever printed: sync_config
 * can hold API keys and feed URLs with tokens in them, so only its KEY NAMES
 * are shown, and environment variables are reported as set/unset booleans.
 *
 * The question it answers is deliberately narrow: for each retailer, is there
 * a live route to a PRICE today, and if not, at which stage does it stop —
 * source access, ingestion, matching, storage, freshness, or rendering?
 *
 *   npx dotenv -e <main>/.env.local -- npx tsx scripts/retailer-access-report.ts
 */
import { PrismaClient }                from '@prisma/client'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, extname }               from 'node:path'

const prisma = new PrismaClient()

const FRESH_DAYS = 30
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000)
const iso = (d: Date | null | undefined) => d ? d.toISOString().slice(0, 16).replace('T', ' ') : '—'
const num = (v: unknown) => Number(v).toLocaleString()

/** Walk a directory tree collecting source files. */
function walk(dir: string, out: string[] = []): string[] {
  let entries: string[]
  try { entries = readdirSync(dir) } catch { return out }
  for (const e of entries) {
    if (e === 'node_modules' || e === '.next' || e.startsWith('.')) continue
    const p = join(dir, e)
    let s
    try { s = statSync(p) } catch { continue }
    if (s.isDirectory()) walk(p, out)
    else if (['.ts', '.tsx', '.mts'].includes(extname(e))) out.push(p)
  }
  return out
}

async function main() {
  console.log('# Retailer access report')
  console.log(`generated ${new Date().toISOString()} · READ-ONLY · no provider requests · no secrets printed\n`)

  // ── 1. Every retailer record, with real listing counts ───────────────────
  const retailers = await prisma.retailer.findMany({ orderBy: { name: 'asc' } })

  const stats = await prisma.$queryRaw<{
    retailer_id: string
    total: bigint; active: bigint; active_priced: bigint; active_fresh_priced: bigint
    deleted: bigint; products_priced: bigint
    last_seen: Date | null; newest_price_change: Date | null
  }[]>`
    SELECT rl.retailer_id,
           COUNT(*)::bigint                                                            AS total,
           COUNT(*) FILTER (WHERE rl.deleted_at IS NULL)::bigint                       AS active,
           COUNT(*) FILTER (WHERE rl.deleted_at IS NULL AND rl.price_amount > 0)::bigint AS active_priced,
           COUNT(*) FILTER (WHERE rl.deleted_at IS NULL AND rl.price_amount > 0
                              AND rl.last_seen_at > ${daysAgo(FRESH_DAYS)})::bigint    AS active_fresh_priced,
           COUNT(*) FILTER (WHERE rl.deleted_at IS NOT NULL)::bigint                   AS deleted,
           COUNT(DISTINCT rl.canonical_product_id) FILTER
             (WHERE rl.deleted_at IS NULL AND rl.price_amount > 0)::bigint             AS products_priced,
           MAX(rl.last_seen_at) FILTER (WHERE rl.deleted_at IS NULL)                   AS last_seen,
           MAX(rl.last_price_change_at)                                                AS newest_price_change
    FROM retailer_listings rl
    GROUP BY rl.retailer_id`
  const byId = new Map(stats.map(s => [s.retailer_id, s]))

  // Most recent genuine price observation per retailer — the only honest
  // answer to "when did a price last actually arrive from this source?"
  const obs = await prisma.$queryRaw<{ retailer_id: string; last_obs: Date | null; obs_30d: bigint }[]>`
    SELECT rl.retailer_id,
           MAX(ph.recorded_at)                                                   AS last_obs,
           COUNT(*) FILTER (WHERE ph.recorded_at > ${daysAgo(30)})::bigint       AS obs_30d
    FROM price_history ph
    JOIN retailer_listings rl ON rl.id = ph.retailer_listing_id
    GROUP BY rl.retailer_id`
  const obsById = new Map(obs.map(o => [o.retailer_id, o]))

  console.log('## Retailers on record\n')
  for (const r of retailers) {
    const s = byId.get(r.id)
    const o = obsById.get(r.id)
    const cfg = (r.syncConfig ?? {}) as Record<string, unknown>
    const cfgKeys = Object.keys(cfg)
    // Values are NOT printed: this column can hold API keys and tokenised feed
    // URLs. Booleans are safe and are the ones that change behaviour.
    const flags = cfgKeys
      .filter(k => typeof cfg[k] === 'boolean')
      .map(k => `${k}=${cfg[k]}`)

    console.log(`### ${r.name}  (${r.domain})`)
    console.log(`  platform ${r.platform} · ${r.countryCode}/${r.currency} · active=${r.isActive} · trust ${r.trustScore}`)
    console.log(`  affiliate network ${r.affiliateNetwork ?? '—'} · affiliate id ${r.affiliateId ? 'SET' : '—'}`)
    console.log(`  sync_config keys: ${cfgKeys.length ? cfgKeys.join(', ') : '(empty)'}`)
    if (flags.length) console.log(`  sync_config flags: ${flags.join(' · ')}`)
    console.log(`  last_synced_at ${iso(r.lastSyncedAt)}`)
    console.log(`  listings: ${num(s?.total ?? 0)} total · ${num(s?.active ?? 0)} active · ${num(s?.active_priced ?? 0)} active+priced · ${num(s?.active_fresh_priced ?? 0)} active+priced+fresh(<${FRESH_DAYS}d) · ${num(s?.deleted ?? 0)} soft-deleted`)
    console.log(`  products priced: ${num(s?.products_priced ?? 0)} · newest active last_seen ${iso(s?.last_seen)}`)
    console.log(`  last price observation ${iso(o?.last_obs)} · observations in 30d ${num(o?.obs_30d ?? 0)}`)
    console.log('')
  }

  // ── 2. Which retailers can a shopper actually see a price from? ──────────
  console.log('## Customer-visible position\n')
  const visible = await prisma.$queryRaw<{ name: string; domain: string; rows: bigint; products: bigint }[]>`
    SELECT r.name, r.domain, COUNT(*)::bigint AS rows,
           COUNT(DISTINCT rl.canonical_product_id)::bigint AS products
    FROM retailer_listings rl JOIN retailers r ON r.id = rl.retailer_id
    WHERE rl.deleted_at IS NULL AND rl.price_amount > 0
    GROUP BY r.name, r.domain ORDER BY rows DESC`
  if (visible.length === 0) console.log('  NOTHING is visible — zero active priced listings across all retailers')
  for (const v of visible) console.log(`  ${v.domain.padEnd(24)} ${String(num(v.rows)).padStart(8)} priced rows · ${num(v.products)} products`)

  const [depth] = await prisma.$queryRaw<{ one: bigint; two: bigint; three: bigint }[]>`
    WITH per AS (
      SELECT canonical_product_id, COUNT(DISTINCT retailer_id) AS n
      FROM retailer_listings
      WHERE deleted_at IS NULL AND price_amount > 0 AND canonical_product_id IS NOT NULL
      GROUP BY canonical_product_id)
    SELECT COUNT(*) FILTER (WHERE n = 1)::bigint  AS one,
           COUNT(*) FILTER (WHERE n = 2)::bigint  AS two,
           COUNT(*) FILTER (WHERE n >= 3)::bigint AS three
    FROM per`
  console.log(`\n  comparison depth: ${num(depth.one)} products @ 1 retailer · ${num(depth.two)} @ 2 · ${num(depth.three)} @ 3+`)

  // ── 3. Scheduled jobs: registered vs actually observed ───────────────────
  console.log('\n## Scheduled jobs — registration is not execution\n')
  const files = walk(join(process.cwd(), 'lib', 'inngest', 'functions'))
  for (const f of files.sort()) {
    const src = readFileSync(f, 'utf8')
    const id   = /id:\s*'([^']+)'/.exec(src)?.[1] ?? '?'
    const cron = [...src.matchAll(/cron:\s*'([^']+)'/g)].map(m => m[1])
    const evt  = [...src.matchAll(/event:\s*'([^']+)'/g)].map(m => m[1])
    console.log(`  ${id.padEnd(34)} ${cron.length ? 'cron ' + cron.join(', ') : evt.length ? 'event ' + evt.join(', ') : 'no trigger found'}`)
  }

  const runs = await prisma.$queryRaw<{
    job_name: string; status: string; started_at: Date; finished_at: Date | null; items: number
  }[]>`
    SELECT DISTINCT ON (job_name) job_name, status, started_at, finished_at, items_processed AS items
    FROM job_runs ORDER BY job_name, started_at DESC`
  console.log('\n  most recent run per job:')
  if (runs.length === 0) console.log('    (no job_runs rows at all)')
  for (const r of runs) {
    console.log(`    ${r.job_name.padEnd(34)} ${r.status.padEnd(8)} started ${iso(r.started_at)} · items ${r.items}`)
  }

  const lastSuccess = await prisma.$queryRaw<{ job_name: string; started_at: Date }[]>`
    SELECT DISTINCT ON (job_name) job_name, started_at
    FROM job_runs WHERE status = 'success' ORDER BY job_name, started_at DESC`
  const successMap = new Map(lastSuccess.map(r => [r.job_name, r.started_at]))
  console.log('\n  last SUCCESSFUL run per job:')
  for (const r of runs) {
    const s = successMap.get(r.job_name)
    console.log(`    ${r.job_name.padEnd(34)} ${s ? iso(s) : 'NEVER SUCCEEDED'}`)
  }

  // ── 4. Sync logs — the per-retailer ingestion record ─────────────────────
  console.log('\n## Most recent sync per retailer (sync_logs)\n')
  const syncs = await prisma.$queryRaw<{
    domain: string; status: string; started_at: Date; items: number | null
  }[]>`
    SELECT DISTINCT ON (r.domain) r.domain, sl.status, sl.started_at,
           sl.listings_created + sl.listings_updated AS items
    FROM sync_logs sl JOIN retailers r ON r.id = sl.retailer_id
    ORDER BY r.domain, sl.started_at DESC`
  if (syncs.length === 0) console.log('  (no sync_logs rows)')
  for (const s of syncs) console.log(`  ${s.domain.padEnd(24)} ${String(s.status).padEnd(10)} ${iso(s.started_at)} · ${s.items ?? 0} listings touched`)

  // ── 5. Credential NAMES referenced in code, and whether they are set ─────
  console.log('\n## Provider credentials — names and presence only, never values\n')
  const srcFiles = [...walk(join(process.cwd(), 'lib')), ...walk(join(process.cwd(), 'app')), ...walk(join(process.cwd(), 'scripts'))]
  const envNames = new Set<string>()
  for (const f of srcFiles) {
    for (const m of readFileSync(f, 'utf8').matchAll(/process\.env\.([A-Z][A-Z0-9_]{2,})/g)) envNames.add(m[1])
  }
  const interesting = [...envNames].filter(n =>
    /EBAY|AWIN|AMAZON|BOOKSHOP|WORDERY|WATERSTONE|CJ_|AFFIL|RAINFOREST|COMICVINE|RETAIL|FEED|SHOPIFY|PA_?API|CREATOR/.test(n)).sort()
  const others = [...envNames].filter(n => !interesting.includes(n)).sort()
  console.log('  provider-related:')
  for (const n of interesting) console.log(`    ${n.padEnd(34)} ${process.env[n] ? 'SET' : 'NOT SET'}`)
  console.log(`\n  other env names referenced (presence only): ${others.map(n => `${n}=${process.env[n] ? 'SET' : 'unset'}`).join(' · ')}`)

  await prisma.$disconnect()
}

main().catch(async e => {
  await prisma.$disconnect()
  console.error(e)
  process.exit(1)
})
