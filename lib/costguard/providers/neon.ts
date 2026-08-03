/**
 * Neon adapter — billing-aligned consumption via the Neon public API.
 *
 * Requires NEON_API_KEY (create: Neon console → Account settings → API keys).
 * Uses GET /api/v2/consumption_history/account with hourly granularity for
 * the current month. Fields are parsed defensively — Neon has renamed
 * consumption metrics before; unknown fields are ignored, never invented.
 *
 * Pricing constants below mirror the Launch plan as measured on the Aug 2026
 * invoice ($0.106/CU-hr computed from real charges; 500 GB included transfer,
 * $0.10/GB after). Estimates feed budget maths only — the engine's rate
 * thresholds act on the RAW measured units (GB, CU-hr), and nothing here is
 * ever presented as provider billing truth.
 */

import type { ProviderUsage, UsageMetric } from '../types'

const COMPUTE_USD_PER_CU_HR   = 0.106
const STORAGE_USD_PER_GB_MO   = 0.35
const TRANSFER_INCLUDED_GB    = 500
const TRANSFER_USD_PER_GB     = 0.10

interface NeonPeriodConsumption {
  compute_time_seconds?: number
  active_time_seconds?: number
  data_transfer_bytes?: number
  public_data_transfer_bytes?: number
  private_data_transfer_bytes?: number
  synthetic_storage_size_bytes?: number
  written_data_bytes?: number
  [k: string]: unknown
}

export async function collectNeon(now: Date = new Date()): Promise<ProviderUsage> {
  const base: ProviderUsage = {
    provider: 'neon',
    configured: false,
    ok: false,
    collectedAt: now.toISOString(),
    metrics: [],
    fixedMonthlyUsd: 0,
    variableMtdUsd: 0,
  }
  const apiKey = process.env.NEON_API_KEY
  if (!apiKey) return { ...base, note: 'NEON_API_KEY not set — see COST-GUARD.md manual actions.' }
  base.configured = true

  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
  const url =
    'https://console.neon.tech/api/v2/consumption_history/account' +
    `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(now.toISOString())}` +
    '&granularity=hourly'

  let json: unknown
  try {
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) return { ...base, note: `Neon API HTTP ${res.status}.` }
    json = await res.json()
  } catch (err) {
    return { ...base, note: `Neon API unreachable: ${(err as Error).message}` }
  }

  // Response shape: { periods: [{ consumption: [ {timeframe_start, ...metrics} ] }] }
  let computeSeconds = 0
  let publicTransferBytes = 0
  let privateTransferBytes = 0
  let latestStorageBytes = 0
  let sawAnyMetric = false
  const periods = (json as { periods?: Array<{ consumption?: NeonPeriodConsumption[] }> })?.periods ?? []
  for (const period of periods) {
    for (const c of period.consumption ?? []) {
      sawAnyMetric = true
      computeSeconds += Number(c.compute_time_seconds ?? 0)
      if (c.public_data_transfer_bytes !== undefined || c.private_data_transfer_bytes !== undefined) {
        publicTransferBytes  += Number(c.public_data_transfer_bytes ?? 0)
        privateTransferBytes += Number(c.private_data_transfer_bytes ?? 0)
      } else {
        publicTransferBytes  += Number(c.data_transfer_bytes ?? 0)
      }
      const storage = Number(c.synthetic_storage_size_bytes ?? 0)
      if (storage > 0) latestStorageBytes = storage
    }
  }
  if (!sawAnyMetric) {
    return { ...base, note: 'Neon API responded but no consumption periods parsed — treat as stale.' }
  }

  const cuHours     = computeSeconds / 3600
  const transferGb  = publicTransferBytes / 1024 ** 3
  const privateGb   = privateTransferBytes / 1024 ** 3
  const storageGb   = latestStorageBytes / 1024 ** 3
  const monthFrac   = now.getUTCDate() / 30

  const transferOverGb = Math.max(transferGb - TRANSFER_INCLUDED_GB, 0)
  const metrics: UsageMetric[] = [
    {
      name: 'network_transfer_gb', mtd: Number(transferGb.toFixed(3)), unit: 'GB',
      estCostUsd: Number((transferOverGb * TRANSFER_USD_PER_GB).toFixed(2)),
      allowanceUsedPct: Number(((transferGb / TRANSFER_INCLUDED_GB) * 100).toFixed(1)),
    },
    {
      name: 'private_transfer_gb', mtd: Number(privateGb.toFixed(3)), unit: 'GB',
      estCostUsd: 0,
    },
    {
      name: 'compute_cu_hours', mtd: Number(cuHours.toFixed(2)), unit: 'CU-hr',
      estCostUsd: Number((cuHours * COMPUTE_USD_PER_CU_HR).toFixed(2)),
    },
    {
      name: 'storage_gb', mtd: Number(storageGb.toFixed(2)), unit: 'GB',
      estCostUsd: Number((storageGb * STORAGE_USD_PER_GB_MO * monthFrac).toFixed(2)),
    },
  ]

  return {
    ...base,
    ok: true,
    metrics,
    variableMtdUsd: Number(metrics.reduce((s, m) => s + m.estCostUsd, 0).toFixed(2)),
  }
}
