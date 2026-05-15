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
  IN_STOCK:    { label: 'In stock',  cls: 'text-emerald-600' },
  LOW_STOCK:   { label: 'Low stock', cls: 'text-amber-600'   },
  PREORDER:    { label: 'Pre-order', cls: 'text-sky-600'      },
  OUT_OF_STOCK:{ label: 'OOS',       cls: 'text-red-500'      },
  UNKNOWN:     { label: 'Unknown',   cls: 'text-gray-400'     },
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
                ? 'bg-[#E8272A] text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-gray-900'
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
              <tr className="text-left text-gray-500 text-xs uppercase tracking-wide border-b border-gray-200">
                <th className="pb-2 pr-4 font-medium">Retailer</th>
                <th className="pb-2 pr-4 font-medium">Condition</th>
                <th className="pb-2 pr-4 font-medium">Price</th>
                <th className="pb-2 pr-4 font-medium hidden sm:table-cell">Shipping</th>
                <th className="pb-2 pr-4 font-medium hidden md:table-cell">Stock</th>
                <th className="pb-2 pr-4 font-medium hidden lg:table-cell">Last checked</th>
                <th className="pb-2 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visible.map((o, i) => {
                const stale  = isStale(o.lastSeenAt)
                const stock  = STOCK_LABELS[o.stockStatus] ?? STOCK_LABELS['UNKNOWN']
                const total  = o.priceAmount + (o.shippingAmount ?? 0)
                const isBest = i === 0 && visible.length > 1

                return (
                  <tr
                    key={o.listingId}
                    className={`hover:bg-gray-50 transition-colors ${stale ? 'opacity-50' : ''}`}
                  >
                    <td className="py-3 pr-4 font-medium text-gray-900">
                      <span className="flex items-center gap-2 flex-wrap">
                        {o.retailerName}
                        {isBest && (
                          <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#E8272A] text-white leading-none">
                            Best price
                          </span>
                        )}
                      </span>
                      {stale && (
                        <span className="ml-0 text-xs text-amber-600 font-normal">(stale)</span>
                      )}
                    </td>
                    <td className="py-3 pr-4 text-gray-700">
                      {CONDITION_LABELS[o.condition] ?? o.condition}
                      {o.conditionDetail && (
                        <span className="block text-xs text-gray-400">{o.conditionDetail}</span>
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      <span className="font-semibold text-gray-900">
                        {fmtPrice(o.priceAmount, o.currency)}
                      </span>
                      {o.shippingAmount !== null && o.shippingAmount > 0 && (
                        <span className="block text-xs text-gray-400">
                          +{fmtPrice(o.shippingAmount, o.currency)} ship
                        </span>
                      )}
                      {o.shippingAmount === 0 && (
                        <span className="block text-xs text-emerald-600">Free shipping</span>
                      )}
                    </td>
                    <td className="py-3 pr-4 hidden sm:table-cell text-gray-500">
                      {o.shippingAmount === null
                        ? '—'
                        : o.shippingAmount === 0
                          ? 'Free'
                          : fmtPrice(o.shippingAmount, o.currency)}
                    </td>
                    <td className={`py-3 pr-4 hidden md:table-cell font-medium ${stock.cls}`}>
                      {stock.label}
                    </td>
                    <td className="py-3 pr-4 hidden lg:table-cell text-gray-400 text-xs">
                      {fmtDate(o.lastSeenAt)}
                    </td>
                    <td className="py-3 text-right">
                      <a
                        href={`/go/${o.listingId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`inline-block px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                          stale
                            ? 'bg-gray-200 text-gray-500 hover:bg-gray-300'
                            : 'bg-[#E8272A] text-white hover:bg-[#c41f22]'
                        }`}
                      >
                        Buy at {o.retailerName} ↗
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
