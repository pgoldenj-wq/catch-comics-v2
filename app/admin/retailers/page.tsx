import { prisma } from '@/lib/prisma'
import Link from 'next/link'

// Re-validate on every request — data changes frequently during sync
export const dynamic = 'force-dynamic'

type SortField = 'name' | 'lastSyncedAt' | 'listings' | 'matchRate'
type SortDir   = 'asc' | 'desc'

function fmtDate(d: Date | null): string {
  if (!d) return '—'
  return d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
}

function fmtRelative(d: Date | null): string {
  if (!d) return 'never'
  const diffMs  = Date.now() - d.getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 2)  return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return `${diffH}h ago`
  return `${Math.floor(diffH / 24)}d ago`
}

const PLATFORM_BADGE: Record<string, string> = {
  SHOPIFY          : 'bg-green-100 text-green-800',
  BIGCOMMERCE      : 'bg-blue-100  text-blue-800',
  WOOCOMMERCE      : 'bg-purple-100 text-purple-800',
  EBAY             : 'bg-yellow-100 text-yellow-800',
  AWIN_FEED        : 'bg-orange-100 text-orange-800',
  CJ_FEED          : 'bg-orange-100 text-orange-800',
  DIRECT_AFFILIATE : 'bg-gray-100  text-gray-700',
  MANUAL           : 'bg-gray-100  text-gray-700',
}

export default async function RetailersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>
}) {
  const params  = await searchParams
  const sort    = (params.sort  ?? 'name')  as SortField
  const dir     = (params.dir   ?? 'asc')   as SortDir
  const flipDir = dir === 'asc' ? 'desc' : 'asc'

  // ── Fetch data — surface DB errors visibly instead of crashing ─────────────
  let retailers: Awaited<ReturnType<typeof prisma.retailer.findMany<{ include: { _count: { select: { listings: true } } } }>>> = []
  let matchedMap = new Map<string, number>()
  let dbError: string | null = null

  try {
    retailers = await prisma.retailer.findMany({
      include: {
        _count: { select: { listings: true } },
      },
      orderBy: sort === 'name'         ? { name: dir }
             : sort === 'lastSyncedAt' ? { lastSyncedAt: dir }
             : undefined,
    })

    const matchedCounts = await prisma.retailerListing.groupBy({
      by:    ['retailerId'],
      where: { canonicalProductId: { not: null } },
      _count: { id: true },
    })
    matchedMap = new Map(matchedCounts.map(r => [r.retailerId, r._count.id]))
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err)
  }

  // ── Build display rows ─────────────────────────────────────────────────────
  let rows = retailers.map(r => {
    const total   = r._count.listings
    const matched = matchedMap.get(r.id) ?? 0
    const rate    = total > 0 ? Math.round((matched / total) * 100) : null
    return { ...r, listingCount: total, matchedCount: matched, matchRate: rate }
  })

  if (sort === 'listings') {
    rows = rows.sort((a, b) =>
      dir === 'asc' ? a.listingCount - b.listingCount : b.listingCount - a.listingCount,
    )
  }
  if (sort === 'matchRate') {
    rows = rows.sort((a, b) => {
      const ra = a.matchRate ?? -1
      const rb = b.matchRate ?? -1
      return dir === 'asc' ? ra - rb : rb - ra
    })
  }

  function sortLink(field: SortField, label: string) {
    const active = sort === field
    const nextDir = active ? flipDir : 'desc'
    const arrow = active ? (dir === 'desc' ? ' ↓' : ' ↑') : ''
    return (
      <Link
        href={`/admin/retailers?sort=${field}&dir=${nextDir}`}
        className={`hover:text-gray-900 ${active ? 'text-gray-900 font-semibold' : 'text-gray-500'}`}
      >
        {label}{arrow}
      </Link>
    )
  }

  return (
    <div>
      {dbError && (
        <div className="mb-4 bg-red-50 border border-red-300 rounded p-4 font-mono text-xs text-red-800">
          <strong>Database error</strong> — check your DATABASE_URL and that migrations are applied.
          <pre className="mt-2 whitespace-pre-wrap break-all">{dbError}</pre>
        </div>
      )}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold">Retailers <span className="text-gray-400 text-sm font-normal">({rows.length})</span></h1>
        <Link
          href="/admin/retailers/new"
          className="bg-gray-900 text-white text-xs px-3 py-1.5 rounded hover:bg-gray-700 transition-colors"
        >
          + Add retailer
        </Link>
      </div>

      <div className="bg-white border border-gray-200 rounded overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-3 py-2 font-medium">{sortLink('name', 'Name / domain')}</th>
              <th className="text-left px-3 py-2 font-medium text-gray-500">Platform</th>
              <th className="text-left px-3 py-2 font-medium text-gray-500">Country</th>
              <th className="text-left px-3 py-2 font-medium text-gray-500">Active</th>
              <th className="text-right px-3 py-2 font-medium">{sortLink('lastSyncedAt', 'Last sync')}</th>
              <th className="text-right px-3 py-2 font-medium">{sortLink('listings', 'Listings')}</th>
              <th className="text-right px-3 py-2 font-medium">{sortLink('matchRate', 'Match %')}</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-gray-400">
                  No retailers yet.{' '}
                  <Link href="/admin/retailers/new" className="underline">Add one.</Link>
                </td>
              </tr>
            )}
            {rows.map(r => (
              <tr key={r.id} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="px-3 py-2">
                  <div className="font-medium text-gray-900">{r.name}</div>
                  <div className="text-gray-400">{r.domain}</div>
                </td>
                <td className="px-3 py-2">
                  <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${PLATFORM_BADGE[r.platform] ?? 'bg-gray-100 text-gray-700'}`}>
                    {r.platform}
                  </span>
                </td>
                <td className="px-3 py-2 text-gray-600">{r.countryCode} · {r.currency}</td>
                <td className="px-3 py-2">
                  {r.isActive
                    ? <span className="text-green-700">●  yes</span>
                    : <span className="text-red-600">●  no</span>
                  }
                </td>
                <td className="px-3 py-2 text-right text-gray-500" title={fmtDate(r.lastSyncedAt)}>
                  {fmtRelative(r.lastSyncedAt)}
                </td>
                <td className="px-3 py-2 text-right font-mono">{r.listingCount.toLocaleString()}</td>
                <td className="px-3 py-2 text-right font-mono">
                  {r.matchRate === null ? '—' : (
                    <span className={r.matchRate >= 80 ? 'text-green-700' : r.matchRate >= 40 ? 'text-yellow-700' : 'text-red-600'}>
                      {r.matchRate}%
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  <Link
                    href={`/admin/retailers/${r.id}`}
                    className="text-blue-600 hover:underline"
                  >
                    Edit →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
