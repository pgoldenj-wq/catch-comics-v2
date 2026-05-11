'use client'

/**
 * OffersTable — client component.
 *
 * Renders the price comparison table with "New / Used / All" tab switching.
 * Each row links to /go/{listingId} for click tracking + affiliate redirect.
 */

import { useState } from 'react'

export interface OfferRow {
  listingId:    string
  retailerName: string
  retailerUrl:  string   // raw URL — not used directly, always go through /go/
  condition:    string
  conditionDetail: string | null
  priceAmount:  number
  currency:     string
  shippingAmount: number | null
  stockStatus:  string
  lastSeenAt:   string  // ISO string
  trustScore:   number
}

interface Props {
  offers: OfferRow[]
}

type Tab = 'ALL' | 'NEW' | 'USED'

const NEW_CONDITIONS  = new Set(['NEW'])
const USED_CONDITIONS = new Set(['LIKE_NEW', 'VERY_GOOD', 'GOOD', 'ACCEPTABLE', 'POOR', 'GRADED', 'UNGRADED'])

const CONDITION_LABELS: Record<string, string> = {
  NEW:        'New',
  LIKE_NEW:   'Like New',
  VERY_GOOD:  'Very Good',
  GOOD:       'Good',
  ACCEPTABLE: 'Acceptable',
  POOR:       'Poor',
  GRADED:     'Graded',
  UNGRADED:   'Ungraded',
}

const STOCK_LABELS: Record<string, { label: string; cls: string }> = {
  IN_STOCK:    { label: 'In stock',  cls: 'text-emerald-400' },
  LOW_STOCK:   { label: 'Low stock', cls: 'text-amber-400'   },
  PREORDER:    { label: 'Pre-order', cls: 'text-sky-400'      },
  OUT_OF_STOCK:{ label: 'OOS',       cls: 'text-red-400'      },
  UNKNOWN:     { label: 'Unknown',   cls: 'text-gray-500'     },
}

const STALE_DAYS = 30

function isStale(lastSeenAt: string): boolean {
  const age = Date.now() - new Date(lastSeenAt).getTime()
  return age > STALE_DAYS * 24 * 60 * 60 * 1000
}

function fmtPrice(amount: number, currency: string) {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency', currency, maximumFractionDigits: 2,
  }).format(amount)
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

export default function OffersTable({ offers }: Props) {
  const [tab, setTab] = useState<Tab>('ALL')

  const visible = offers.filter(o => {
    if (tab === 'NEW')  return NEW_CONDITIONS.has(o.condition)
    if (tab === 'USED') return USED_CONDITIONS.has(o.condition)
    return true
  })

  const newCount  = offers.filter(o => NEW_CONDITIONS.has(o.condition)).length
  const usedCount = offers.filter(o => USED_CONDITIONS.has(o.condition)).length

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: 'ALL',  label: 'All',  count: offers.length },
    { id: 'NEW',  label: 'New',  count: newCount  },
    { id: 'USED', label: 'Used', count: usedCount },
  ]

  return (
    <div>
      {/* Tabs */}
      <div className="flex gap-1 mb-4">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
              tab === t.id
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white'
            }`}
          >
            {t.label}
            <span className="ml-1.5 text-xs opacity-70">({t.count})</span>
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="text-gray-500 text-sm py-4">No {tab.toLowerCase()} listings available.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs uppercase tracking-wide border-b border-gray-800">
                <th className="pb-2 pr-4 font-medium">Retailer</th>
                <th className="pb-2 pr-4 font-medium">Condition</th>
                <th className="pb-2 pr-4 font-medium">Price</th>
                <th className="pb-2 pr-4 font-medium hidden sm:table-cell">Shipping</th>
                <th className="pb-2 pr-4 font-medium hidden md:table-cell">Stock</th>
                <th className="pb-2 pr-4 font-medium hidden lg:table-cell">Last checked</th>
                <th className="pb-2 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {visible.map(o => {
                const stale  = isStale(o.lastSeenAt)
                const stock  = STOCK_LABELS[o.stockStatus] ?? STOCK_LABELS['UNKNOWN']
                const total  = o.priceAmount + (o.shippingAmount ?? 0)

                return (
                  <tr
                    key={o.listingId}
                    className={`hover:bg-gray-800/40 transition-colors ${stale ? 'opacity-50' : ''}`}
                  >
                    <td className="py-3 pr-4 font-medium text-white">
                      {o.retailerName}
                      {stale && (
                        <span className="ml-2 text-xs text-amber-500 font-normal">(stale)</span>
                      )}
                    </td>
                    <td className="py-3 pr-4 text-gray-300">
                      {CONDITION_LABELS[o.condition] ?? o.condition}
                      {o.conditionDetail && (
                        <span className="block text-xs text-gray-500">{o.conditionDetail}</span>
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      <span className="font-semibold text-white">
                        {fmtPrice(o.priceAmount, o.currency)}
                      </span>
                      {o.shippingAmount !== null && o.shippingAmount > 0 && (
                        <span className="block text-xs text-gray-500">
                          +{fmtPrice(o.shippingAmount, o.currency)} ship
                        </span>
                      )}
                      {o.shippingAmount === 0 && (
                        <span className="block text-xs text-emerald-500">Free shipping</span>
                      )}
                    </td>
                    <td className="py-3 pr-4 hidden sm:table-cell text-gray-400">
                      {o.shippingAmount === null
                        ? '—'
                        : o.shippingAmount === 0
                          ? 'Free'
                          : fmtPrice(o.shippingAmount, o.currency)}
                    </td>
                    <td className={`py-3 pr-4 hidden md:table-cell font-medium ${stock.cls}`}>
                      {stock.label}
                    </td>
                    <td className="py-3 pr-4 hidden lg:table-cell text-gray-500 text-xs">
                      {fmtDate(o.lastSeenAt)}
                    </td>
                    <td className="py-3 text-right">
                      <a
                        href={`/go/${o.listingId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`inline-block px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                          stale
                            ? 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                            : 'bg-indigo-600 text-white hover:bg-indigo-500'
                        }`}
                      >
                        View deal ↗
                      </a>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
