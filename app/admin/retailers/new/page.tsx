'use client'

import { useState, FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

const PLATFORMS = [
  { value: 'SHOPIFY',          label: 'Shopify',          disabled: false },
  { value: 'BIGCOMMERCE',      label: 'BigCommerce',      disabled: false },
  { value: 'WOOCOMMERCE',      label: 'WooCommerce',      disabled: false },
  { value: 'MANUAL',           label: 'Manual',           disabled: false },
  { value: 'DIRECT_AFFILIATE', label: 'Direct affiliate', disabled: false },
  { value: 'AWIN_FEED',        label: 'Awin feed',        disabled: false },
  { value: 'CJ_FEED',          label: 'CJ feed',          disabled: false },
  { value: 'EBAY',             label: 'eBay (disabled — special case)', disabled: true },
]

const COUNTRIES = [
  { value: 'GB', label: 'GB — United Kingdom' },
  { value: 'US', label: 'US — United States' },
  { value: 'AU', label: 'AU — Australia' },
  { value: 'CA', label: 'CA — Canada' },
  { value: 'DE', label: 'DE — Germany' },
  { value: 'FR', label: 'FR — France' },
]

const CURRENCIES = ['GBP', 'USD', 'AUD', 'CAD', 'EUR']

const AFFILIATE_NETWORKS = ['', 'Awin', 'CJ', 'Rakuten', 'ShareASale', 'Impact', 'Other']

interface TestResult {
  ok     : boolean
  message: string
}

export default function NewRetailerPage() {
  const router = useRouter()

  // Form state
  const [name,             setName]             = useState('')
  const [domain,           setDomain]           = useState('')
  const [platform,         setPlatform]         = useState('SHOPIFY')
  const [countryCode,      setCountryCode]      = useState('GB')
  const [currency,         setCurrency]         = useState('GBP')
  const [affiliateNetwork, setAffiliateNetwork] = useState('')
  const [affiliateId,      setAffiliateId]      = useState('')
  const [trustScore,       setTrustScore]       = useState(50)

  // UI state
  const [testResult,  setTestResult]  = useState<TestResult | null>(null)
  const [testing,     setTesting]     = useState(false)
  const [saving,      setSaving]      = useState(false)
  const [saveError,   setSaveError]   = useState('')
  const [testPassed,  setTestPassed]  = useState(false)

  // Domain validation — bare domain, no protocol
  function domainValid(d: string): boolean {
    return /^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(d.trim())
  }

  async function handleTestConnection() {
    if (!domainValid(domain)) {
      setTestResult({ ok: false, message: 'Enter a valid bare domain first (e.g. example.com)' })
      return
    }
    setTesting(true)
    setTestResult(null)
    setTestPassed(false)

    try {
      const res  = await fetch('/api/admin/test-connection', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ domain: domain.trim(), platform }),
      })
      const data = await res.json() as { ok: boolean; message: string }
      setTestResult(data)
      setTestPassed(data.ok)
    } catch {
      setTestResult({ ok: false, message: 'Network error — could not reach test endpoint' })
    } finally {
      setTesting(false)
    }
  }

  async function handleSave(syncNow: boolean) {
    if (!name.trim())        { setSaveError('Name is required.'); return }
    if (!domainValid(domain)){ setSaveError('Invalid domain.'); return }
    setSaving(true)
    setSaveError('')

    try {
      const res = await fetch('/api/admin/retailers', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          name:             name.trim(),
          domain:           domain.trim().toLowerCase(),
          platform,
          countryCode,
          currency,
          affiliateNetwork: affiliateNetwork || null,
          affiliateId:      affiliateId.trim() || null,
          trustScore,
          syncNow,
        }),
      })

      if (!res.ok) {
        const err = await res.json() as { error?: string }
        setSaveError(err.error ?? 'Failed to save retailer.')
        setSaving(false)
        return
      }

      const { id } = await res.json() as { id: string }
      router.push(`/admin/retailers/${id}`)
    } catch {
      setSaveError('Network error.')
      setSaving(false)
    }
  }

  const isShopify = platform === 'SHOPIFY'

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-3 mb-5">
        <Link href="/admin/retailers" className="text-gray-400 hover:text-gray-700 text-sm">
          ← Retailers
        </Link>
        <h1 className="text-xl font-bold">Add retailer</h1>
      </div>

      <div className="bg-white border border-gray-200 rounded p-6 flex flex-col gap-4">

        {/* Name */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Name</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Organic Priced Books"
            className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-gray-600"
          />
        </div>

        {/* Domain */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Domain</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={domain}
              onChange={e => { setDomain(e.target.value); setTestPassed(false); setTestResult(null) }}
              placeholder="e.g. organicpricedbooks.com"
              className="border border-gray-300 rounded px-3 py-1.5 text-sm flex-1 focus:outline-none focus:border-gray-600"
            />
            {isShopify && (
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={testing}
                className="bg-blue-600 text-white text-xs px-3 py-1.5 rounded hover:bg-blue-700 disabled:opacity-50 transition-colors whitespace-nowrap"
              >
                {testing ? 'Testing…' : 'Test connection'}
              </button>
            )}
          </div>
          {testResult && (
            <p className={`text-xs mt-1 ${testResult.ok ? 'text-green-700' : 'text-red-600'}`}>
              {testResult.ok ? '✓ ' : '✗ '}{testResult.message}
            </p>
          )}
          {isShopify && !testPassed && (
            <p className="text-xs text-gray-400">Test the connection before saving a Shopify retailer.</p>
          )}
        </div>

        {/* Platform */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Platform</label>
          <select
            value={platform}
            onChange={e => { setPlatform(e.target.value); setTestPassed(false); setTestResult(null) }}
            className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-gray-600"
          >
            {PLATFORMS.map(p => (
              <option key={p.value} value={p.value} disabled={p.disabled}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        {/* Country + Currency */}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Country</label>
            <select
              value={countryCode}
              onChange={e => setCountryCode(e.target.value)}
              className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-gray-600"
            >
              {COUNTRIES.map(c => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Currency</label>
            <select
              value={currency}
              onChange={e => setCurrency(e.target.value)}
              className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-gray-600"
            >
              {CURRENCIES.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Affiliate network + ID */}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Affiliate network <span className="font-normal text-gray-400">(optional)</span></label>
            <select
              value={affiliateNetwork}
              onChange={e => setAffiliateNetwork(e.target.value)}
              className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-gray-600"
            >
              {AFFILIATE_NETWORKS.map(n => (
                <option key={n} value={n}>{n || '— none —'}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Affiliate ID <span className="font-normal text-gray-400">(optional)</span></label>
            <input
              type="text"
              value={affiliateId}
              onChange={e => setAffiliateId(e.target.value)}
              placeholder="e.g. catchcomics-21"
              className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-gray-600"
            />
          </div>
        </div>

        {/* Trust score */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
            Trust score — <span className="font-normal text-gray-600">{trustScore} / 100</span>
          </label>
          <input
            type="range"
            min={0} max={100}
            value={trustScore}
            onChange={e => setTrustScore(Number(e.target.value))}
            className="w-full"
          />
          <p className="text-xs text-gray-400">Higher = more trusted price data. Default 50.</p>
        </div>

        {/* Error */}
        {saveError && (
          <p className="text-red-600 text-xs bg-red-50 border border-red-200 rounded px-3 py-2">{saveError}</p>
        )}

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={() => handleSave(false)}
            disabled={saving || (isShopify && !testPassed)}
            className="bg-gray-900 text-white text-sm px-4 py-2 rounded hover:bg-gray-700 disabled:opacity-40 transition-colors"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          {isShopify && (
            <button
              type="button"
              onClick={() => handleSave(true)}
              disabled={saving || !testPassed}
              className="bg-green-700 text-white text-sm px-4 py-2 rounded hover:bg-green-800 disabled:opacity-40 transition-colors"
            >
              {saving ? 'Saving…' : 'Save and sync now'}
            </button>
          )}
          <Link href="/admin/retailers" className="text-sm text-gray-500 hover:text-gray-800 py-2">
            Cancel
          </Link>
        </div>

      </div>
    </div>
  )
}
