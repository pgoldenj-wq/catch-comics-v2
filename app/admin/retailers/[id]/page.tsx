'use client'

import { use, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

// ── Types matching the API response ──────────────────────────────────────────

interface SyncLog {
  id              : string
  startedAt       : string
  finishedAt      : string | null
  status          : string
  productsFetched : number
  listingsCreated : number
  listingsUpdated : number
  priceChanges    : number
  errorCount      : number
  errorSummary    : string | null
}

interface UnmatchedListing {
  id          : string
  retailerSku : string
  title       : string
  priceAmount : string
  stockStatus : string
  retailerUrl : string
  firstSeenAt : string
}

interface RetailerDetail {
  id               : string
  name             : string
  domain           : string
  platform         : string
  countryCode      : string
  currency         : string
  isActive         : boolean
  trustScore       : number
  affiliateNetwork : string | null
  affiliateId      : string | null
  lastSyncedAt     : string | null
  syncConfig       : Record<string, unknown>
  createdAt        : string
  listingCount     : number
  matchedCount     : number
  syncLogs         : SyncLog[]
  unmatchedListings: UnmatchedListing[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d: string | null): string {
  if (!d) return '—'
  return new Date(d).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
}

function fmtDuration(start: string, finish: string | null): string {
  if (!finish) return '—'
  const ms = new Date(finish).getTime() - new Date(start).getTime()
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}

const PLATFORMS = ['SHOPIFY','BIGCOMMERCE','WOOCOMMERCE','MANUAL','DIRECT_AFFILIATE','AWIN_FEED','CJ_FEED']
const COUNTRIES  = ['GB','US','AU','CA','DE','FR']
const CURRENCIES = ['GBP','USD','AUD','CAD','EUR']
const AFFILIATE_NETWORKS = ['','Awin','CJ','Rakuten','ShareASale','Impact','Other']

// ── Component ─────────────────────────────────────────────────────────────────

export default function RetailerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router  = useRouter()

  const [retailer,    setRetailer]    = useState<RetailerDetail | null>(null)
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState('')

  // Edit state
  const [editing,          setEditing]          = useState(false)
  const [editName,         setEditName]         = useState('')
  const [editPlatform,     setEditPlatform]     = useState('')
  const [editCountry,      setEditCountry]      = useState('')
  const [editCurrency,     setEditCurrency]     = useState('')
  const [editAffNet,       setEditAffNet]       = useState('')
  const [editAffId,        setEditAffId]        = useState('')
  const [editTrust,        setEditTrust]        = useState(50)
  const [saving,           setSaving]           = useState(false)
  const [saveError,        setSaveError]        = useState('')

  // Sync state
  const [syncing,     setSyncing]     = useState(false)
  const [syncMsg,     setSyncMsg]     = useState('')

  // Delete state
  const [deleteOpen,  setDeleteOpen]  = useState(false)
  const [deleteInput, setDeleteInput] = useState('')
  const [deleting,    setDeleting]    = useState(false)

  // ── Load retailer ──────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res  = await fetch(`/api/admin/retailers/${id}`)
      if (!res.ok) {
        setError(`Failed to load retailer (${res.status})`)
        return
      }
      const data = await res.json() as RetailerDetail
      setRetailer(data)
      // Seed edit fields
      setEditName(data.name)
      setEditPlatform(data.platform)
      setEditCountry(data.countryCode)
      setEditCurrency(data.currency)
      setEditAffNet(data.affiliateNetwork ?? '')
      setEditAffId(data.affiliateId ?? '')
      setEditTrust(data.trustScore)
    } catch {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { void load() }, [load])

  // ── Save edits ─────────────────────────────────────────────────────────────
  async function handleSave() {
    setSaving(true)
    setSaveError('')
    try {
      const res = await fetch(`/api/admin/retailers/${id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          name:             editName.trim(),
          platform:         editPlatform,
          countryCode:      editCountry,
          currency:         editCurrency,
          affiliateNetwork: editAffNet || null,
          affiliateId:      editAffId.trim() || null,
          trustScore:       editTrust,
        }),
      })
      if (!res.ok) {
        const err = await res.json() as { error?: string }
        setSaveError(err.error ?? 'Save failed')
        return
      }
      setEditing(false)
      await load()
    } catch {
      setSaveError('Network error')
    } finally {
      setSaving(false)
    }
  }

  // ── Toggle active ──────────────────────────────────────────────────────────
  async function handleToggleActive() {
    if (!retailer) return
    await fetch(`/api/admin/retailers/${id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ isActive: !retailer.isActive }),
    })
    await load()
  }

  // ── Sync now ───────────────────────────────────────────────────────────────
  async function handleSync() {
    setSyncing(true)
    setSyncMsg('Syncing… (this may take a few minutes for large catalogs)')
    try {
      const res  = await fetch(`/api/admin/retailers/${id}/sync`, { method: 'POST' })
      const data = await res.json() as {
        ok      ?: boolean
        error   ?: string
        summary ?: { productsFetched: number; listingsCreated: number; listingsUpdated: number; priceChanges: number; errors: number; durationMs: number }
      }
      if (data.ok && data.summary) {
        const s = data.summary
        setSyncMsg(
          `✓ Sync complete — ${s.productsFetched} products, ` +
          `${s.listingsCreated} created, ${s.listingsUpdated} updated, ` +
          `${s.priceChanges} price changes, ${s.errors} errors — ${(s.durationMs / 1000).toFixed(1)}s`
        )
      } else {
        setSyncMsg(`✗ ${data.error ?? 'Sync failed'}`)
      }
      await load()
    } catch {
      setSyncMsg('✗ Network error during sync')
    } finally {
      setSyncing(false)
    }
  }

  // ── Delete ─────────────────────────────────────────────────────────────────
  async function handleDelete() {
    setDeleting(true)
    try {
      const res = await fetch(`/api/admin/retailers/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const err = await res.json() as { error?: string }
        alert(err.error ?? 'Delete failed')
        setDeleting(false)
        return
      }
      router.push('/admin/retailers')
    } catch {
      alert('Network error')
      setDeleting(false)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) return <div className="text-gray-400 text-sm">Loading…</div>
  if (error)   return <div className="text-red-600 text-sm">{error} <button onClick={() => void load()} className="underline ml-2">Retry</button></div>
  if (!retailer) return null

  const matchRate = retailer.listingCount > 0
    ? Math.round((retailer.matchedCount / retailer.listingCount) * 100)
    : null

  return (
    <div className="max-w-4xl flex flex-col gap-6">

      {/* ── Header ── */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Link href="/admin/retailers" className="text-gray-400 hover:text-gray-700 text-sm">
              ← Retailers
            </Link>
          </div>
          <h1 className="text-xl font-bold">{retailer.name}</h1>
          <p className="text-sm text-gray-500">{retailer.domain} · {retailer.platform} · {retailer.countryCode}</p>
        </div>
        <div className="flex gap-2 items-center">
          {/* Pause / resume toggle */}
          <button
            onClick={handleToggleActive}
            className={`text-xs px-3 py-1.5 rounded border transition-colors ${
              retailer.isActive
                ? 'border-yellow-400 text-yellow-700 hover:bg-yellow-50'
                : 'border-green-400 text-green-700 hover:bg-green-50'
            }`}
          >
            {retailer.isActive ? 'Pause syncing' : 'Resume syncing'}
          </button>

          {/* Sync now */}
          {retailer.platform === 'SHOPIFY' && (
            <button
              onClick={handleSync}
              disabled={syncing}
              className="bg-blue-600 text-white text-xs px-3 py-1.5 rounded hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {syncing ? 'Syncing…' : 'Sync now'}
            </button>
          )}

          {/* Delete */}
          <button
            onClick={() => setDeleteOpen(true)}
            className="text-xs px-3 py-1.5 rounded border border-red-300 text-red-600 hover:bg-red-50 transition-colors"
          >
            Delete
          </button>
        </div>
      </div>

      {/* Sync status message */}
      {syncMsg && (
        <div className={`text-xs px-4 py-2 rounded border ${
          syncMsg.startsWith('✓') ? 'bg-green-50 border-green-200 text-green-800'
          : syncMsg.startsWith('✗') ? 'bg-red-50 border-red-200 text-red-700'
          : 'bg-blue-50 border-blue-200 text-blue-700'
        }`}>
          {syncMsg}
        </div>
      )}

      {/* ── Stats bar ── */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Total listings',    value: retailer.listingCount.toLocaleString() },
          { label: 'Matched',           value: retailer.matchedCount.toLocaleString() },
          { label: 'Match rate',        value: matchRate !== null ? `${matchRate}%` : '—' },
          { label: 'Last sync',         value: fmtDate(retailer.lastSyncedAt) },
        ].map(({ label, value }) => (
          <div key={label} className="bg-white border border-gray-200 rounded p-3">
            <div className="text-xs text-gray-500 uppercase tracking-wide">{label}</div>
            <div className="text-lg font-bold font-mono mt-1">{value}</div>
          </div>
        ))}
      </div>

      {/* ── Retailer fields ── */}
      <div className="bg-white border border-gray-200 rounded p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-sm">Retailer details</h2>
          {!editing
            ? <button onClick={() => setEditing(true)} className="text-xs text-blue-600 hover:underline">Edit</button>
            : <div className="flex gap-3">
                <button onClick={handleSave} disabled={saving}
                  className="text-xs bg-gray-900 text-white px-3 py-1 rounded hover:bg-gray-700 disabled:opacity-50">
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button onClick={() => { setEditing(false); setSaveError('') }}
                  className="text-xs text-gray-500 hover:text-gray-800">
                  Cancel
                </button>
              </div>
          }
        </div>

        {saveError && <p className="text-red-600 text-xs mb-3">{saveError}</p>}

        <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-xs">
          {/* Name */}
          <div>
            <div className="text-gray-500 uppercase tracking-wide mb-1">Name</div>
            {editing
              ? <input value={editName} onChange={e => setEditName(e.target.value)}
                  className="border border-gray-300 rounded px-2 py-1 w-full focus:outline-none focus:border-gray-600" />
              : <div className="font-medium">{retailer.name}</div>
            }
          </div>

          {/* Domain (read-only) */}
          <div>
            <div className="text-gray-500 uppercase tracking-wide mb-1">Domain</div>
            <div className="font-mono text-gray-700">{retailer.domain}</div>
          </div>

          {/* Platform */}
          <div>
            <div className="text-gray-500 uppercase tracking-wide mb-1">Platform</div>
            {editing
              ? <select value={editPlatform} onChange={e => setEditPlatform(e.target.value)}
                  className="border border-gray-300 rounded px-2 py-1 w-full focus:outline-none focus:border-gray-600">
                  {PLATFORMS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              : <div>{retailer.platform}</div>
            }
          </div>

          {/* Country */}
          <div>
            <div className="text-gray-500 uppercase tracking-wide mb-1">Country</div>
            {editing
              ? <select value={editCountry} onChange={e => setEditCountry(e.target.value)}
                  className="border border-gray-300 rounded px-2 py-1 w-full focus:outline-none focus:border-gray-600">
                  {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              : <div>{retailer.countryCode}</div>
            }
          </div>

          {/* Currency */}
          <div>
            <div className="text-gray-500 uppercase tracking-wide mb-1">Currency</div>
            {editing
              ? <select value={editCurrency} onChange={e => setEditCurrency(e.target.value)}
                  className="border border-gray-300 rounded px-2 py-1 w-full focus:outline-none focus:border-gray-600">
                  {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              : <div>{retailer.currency}</div>
            }
          </div>

          {/* Trust score */}
          <div>
            <div className="text-gray-500 uppercase tracking-wide mb-1">Trust score</div>
            {editing
              ? <div className="flex items-center gap-2">
                  <input type="range" min={0} max={100} value={editTrust}
                    onChange={e => setEditTrust(Number(e.target.value))} className="flex-1" />
                  <span className="w-8 text-right">{editTrust}</span>
                </div>
              : <div>{retailer.trustScore}/100</div>
            }
          </div>

          {/* Affiliate network */}
          <div>
            <div className="text-gray-500 uppercase tracking-wide mb-1">Affiliate network</div>
            {editing
              ? <select value={editAffNet} onChange={e => setEditAffNet(e.target.value)}
                  className="border border-gray-300 rounded px-2 py-1 w-full focus:outline-none focus:border-gray-600">
                  {AFFILIATE_NETWORKS.map(n => <option key={n} value={n}>{n || '— none —'}</option>)}
                </select>
              : <div>{retailer.affiliateNetwork ?? '—'}</div>
            }
          </div>

          {/* Affiliate ID */}
          <div>
            <div className="text-gray-500 uppercase tracking-wide mb-1">Affiliate ID</div>
            {editing
              ? <input value={editAffId} onChange={e => setEditAffId(e.target.value)}
                  className="border border-gray-300 rounded px-2 py-1 w-full focus:outline-none focus:border-gray-600" />
              : <div className="font-mono">{retailer.affiliateId ?? '—'}</div>
            }
          </div>

          {/* Status */}
          <div>
            <div className="text-gray-500 uppercase tracking-wide mb-1">Active</div>
            <div>{retailer.isActive
              ? <span className="text-green-700">● Yes</span>
              : <span className="text-red-600">● No (paused)</span>
            }</div>
          </div>

          {/* Created */}
          <div>
            <div className="text-gray-500 uppercase tracking-wide mb-1">Created</div>
            <div className="font-mono">{fmtDate(retailer.createdAt)}</div>
          </div>
        </div>

        {/* sync_config raw dump */}
        {Object.keys(retailer.syncConfig).length > 0 && (
          <details className="mt-4">
            <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-800">
              sync_config (raw)
            </summary>
            <pre className="mt-2 text-xs bg-gray-50 border border-gray-200 rounded p-3 overflow-x-auto whitespace-pre-wrap">
              {JSON.stringify(retailer.syncConfig, null, 2)}
            </pre>
          </details>
        )}
      </div>

      {/* ── Sync history ── */}
      <div className="bg-white border border-gray-200 rounded p-5">
        <h2 className="font-semibold text-sm mb-3">
          Sync history <span className="text-gray-400 font-normal">(last {retailer.syncLogs.length})</span>
        </h2>
        {retailer.syncLogs.length === 0
          ? <p className="text-xs text-gray-400">No syncs run yet.</p>
          : (
            <table className="w-full text-xs border-collapse">
              <thead className="border-b border-gray-200">
                <tr className="text-gray-500">
                  <th className="text-left py-1.5 pr-3">Started</th>
                  <th className="text-left py-1.5 pr-3">Status</th>
                  <th className="text-right py-1.5 pr-3">Duration</th>
                  <th className="text-right py-1.5 pr-3">Products</th>
                  <th className="text-right py-1.5 pr-3">Created</th>
                  <th className="text-right py-1.5 pr-3">Updated</th>
                  <th className="text-right py-1.5 pr-3">Prices</th>
                  <th className="text-right py-1.5">Errors</th>
                </tr>
              </thead>
              <tbody>
                {retailer.syncLogs.map(log => (
                  <tr key={log.id} className="border-t border-gray-100">
                    <td className="py-1.5 pr-3 font-mono">{fmtDate(log.startedAt)}</td>
                    <td className="py-1.5 pr-3">
                      <span className={
                        log.status === 'success' ? 'text-green-700'
                        : log.status === 'error'   ? 'text-red-600'
                        : 'text-yellow-700'
                      }>
                        {log.status}
                      </span>
                    </td>
                    <td className="py-1.5 pr-3 text-right font-mono">{fmtDuration(log.startedAt, log.finishedAt)}</td>
                    <td className="py-1.5 pr-3 text-right font-mono">{log.productsFetched.toLocaleString()}</td>
                    <td className="py-1.5 pr-3 text-right font-mono text-green-700">+{log.listingsCreated}</td>
                    <td className="py-1.5 pr-3 text-right font-mono">{log.listingsUpdated}</td>
                    <td className="py-1.5 pr-3 text-right font-mono">{log.priceChanges}</td>
                    <td className="py-1.5 text-right font-mono">
                      {log.errorCount > 0
                        ? <span className="text-red-600" title={log.errorSummary ?? undefined}>{log.errorCount} ⚠</span>
                        : '0'
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        }
      </div>

      {/* ── Top 20 unmatched listings ── */}
      <div className="bg-white border border-gray-200 rounded p-5">
        <h2 className="font-semibold text-sm mb-3">
          Unmatched listings <span className="text-gray-400 font-normal">(top 20 by first seen)</span>
        </h2>
        {retailer.unmatchedListings.length === 0
          ? <p className="text-xs text-gray-400">No unmatched listings 🎉</p>
          : (
            <table className="w-full text-xs border-collapse">
              <thead className="border-b border-gray-200">
                <tr className="text-gray-500">
                  <th className="text-left py-1.5 pr-3">Title</th>
                  <th className="text-left py-1.5 pr-3">SKU</th>
                  <th className="text-right py-1.5 pr-3">Price</th>
                  <th className="text-left py-1.5 pr-3">Stock</th>
                  <th className="text-right py-1.5">First seen</th>
                </tr>
              </thead>
              <tbody>
                {retailer.unmatchedListings.map(l => (
                  <tr key={l.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="py-1.5 pr-3 max-w-xs">
                      <a href={l.retailerUrl} target="_blank" rel="noopener noreferrer"
                        className="text-blue-600 hover:underline truncate block">
                        {l.title}
                      </a>
                    </td>
                    <td className="py-1.5 pr-3 font-mono text-gray-500">{l.retailerSku}</td>
                    <td className="py-1.5 pr-3 text-right font-mono">{l.priceAmount}</td>
                    <td className="py-1.5 pr-3">
                      <span className={
                        l.stockStatus === 'IN_STOCK'    ? 'text-green-700'
                        : l.stockStatus === 'OUT_OF_STOCK' ? 'text-red-600'
                        : 'text-gray-500'
                      }>
                        {l.stockStatus.replace('_', ' ').toLowerCase()}
                      </span>
                    </td>
                    <td className="py-1.5 text-right font-mono text-gray-400">{fmtDate(l.firstSeenAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        }
      </div>

      {/* ── Delete confirmation modal ── */}
      {deleteOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded border border-gray-300 p-6 w-full max-w-md font-mono text-sm">
            <h3 className="font-bold text-red-700 mb-2">⚠ Delete retailer</h3>
            <p className="text-gray-700 mb-1">
              This will permanently delete <strong>{retailer.name}</strong> and all
              {' '}<strong>{retailer.listingCount.toLocaleString()} listings</strong> and price history. This cannot be undone.
            </p>
            <p className="text-gray-600 mb-3">
              Type <strong>{retailer.domain}</strong> to confirm:
            </p>
            <input
              type="text"
              value={deleteInput}
              onChange={e => setDeleteInput(e.target.value)}
              placeholder={retailer.domain}
              className="border border-gray-300 rounded px-3 py-1.5 w-full mb-4 focus:outline-none focus:border-red-400"
            />
            <div className="flex gap-3">
              <button
                onClick={handleDelete}
                disabled={deleting || deleteInput !== retailer.domain}
                className="bg-red-600 text-white text-xs px-4 py-2 rounded hover:bg-red-700 disabled:opacity-40 transition-colors"
              >
                {deleting ? 'Deleting…' : 'Delete permanently'}
              </button>
              <button
                onClick={() => { setDeleteOpen(false); setDeleteInput('') }}
                className="text-xs text-gray-500 hover:text-gray-800 py-2"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
