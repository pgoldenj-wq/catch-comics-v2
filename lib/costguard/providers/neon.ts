/**
 * Neon adapter — billing-aligned consumption via the Neon public API.
 *
 * Requires NEON_API_KEY (create: Neon console → Account settings → API keys).
 * Optionally NEON_ORG_ID; when absent the org is resolved once per collection
 * from GET /users/me/organizations.
 *
 * WHY AN ENDPOINT LADDER: Neon migrated personal accounts to organizations, and
 * a personal API key must now pass `org_id`. Without it the account endpoint
 * answers 404 — which is exactly how this adapter failed in production on
 * 2026-08-06 ("Neon API HTTP 404"). Neon also runs two response shapes side by
 * side: the legacy flat rows (compute_time_seconds, …) and a v2 metrics array
 * ({metric_name, value}). Rather than bet on one, try the endpoints in order of
 * how well we can parse them and record which one answered.
 *
 * HONESTY RULE: a 200 whose body contains no metric name we recognise is a
 * FAILURE, not zero usage. Reporting a fabricated $0 would hand the engine a
 * false all-clear, which is the one thing Cost Guard must never do.
 *
 * Pricing constants mirror the Launch plan as measured on the Aug 2026 invoice
 * ($0.106/CU-hr computed from real charges; 500 GB included transfer, $0.10/GB
 * after). Estimates feed budget maths only — the engine's rate thresholds act on
 * the RAW measured units (GB, CU-hr), and nothing here is provider billing truth.
 */

import type { ProviderUsage, UsageMetric } from '../types'

const COMPUTE_USD_PER_CU_HR   = 0.106
const STORAGE_USD_PER_GB_MO   = 0.35
const TRANSFER_INCLUDED_GB    = 500
const TRANSFER_USD_PER_GB     = 0.10

const API = 'https://console.neon.tech/api/v2'

/** Totals accumulated from whichever response shape Neon returned. */
export interface NeonTotals {
  computeSeconds: number
  publicTransferBytes: number
  privateTransferBytes: number
  /** Instantaneous storage (legacy shape only). */
  storageBytes: number
  /** Time-integrated storage (v2 shape only) — units are NOT plain bytes. */
  storageByteMonths: number
  /** null when nothing recognisable was found — treat as a failed collection. */
  shape: 'legacy' | 'v2' | null
  rows: number
}

interface ConsumptionRow {
  compute_time_seconds?: number
  data_transfer_bytes?: number
  public_data_transfer_bytes?: number
  private_data_transfer_bytes?: number
  synthetic_storage_size_bytes?: number
  metrics?: Array<{ metric_name?: string; value?: number }>
  [k: string]: unknown
}

const LEGACY_KEYS = [
  'compute_time_seconds', 'data_transfer_bytes', 'public_data_transfer_bytes',
  'private_data_transfer_bytes', 'synthetic_storage_size_bytes',
] as const

/** Collect consumption rows from every container shape Neon has shipped. */
function collectRows(json: unknown): ConsumptionRow[] {
  const rows: ConsumptionRow[] = []
  const pushPeriods = (periods: unknown) => {
    if (!Array.isArray(periods)) return
    for (const p of periods) {
      const c = (p as { consumption?: unknown })?.consumption
      if (Array.isArray(c)) rows.push(...(c as ConsumptionRow[]))
    }
  }
  const root = json as Record<string, unknown> | null
  if (!root || typeof root !== 'object') return rows
  pushPeriods(root.periods)
  for (const key of ['projects', 'branches', 'consumption_history']) {
    const arr = root[key]
    if (Array.isArray(arr)) for (const entry of arr) pushPeriods((entry as { periods?: unknown })?.periods)
  }
  return rows
}

/**
 * Pure parser — exported so scripts/test-costguard.ts can pin both shapes
 * without touching the network.
 */
export function parseNeonConsumption(json: unknown): NeonTotals {
  const out: NeonTotals = {
    computeSeconds: 0, publicTransferBytes: 0, privateTransferBytes: 0,
    storageBytes: 0, storageByteMonths: 0, shape: null, rows: 0,
  }
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

  for (const row of collectRows(json)) {
    if (Array.isArray(row.metrics)) {
      let recognised = false
      for (const m of row.metrics) {
        const value = num(m?.value)
        switch (m?.metric_name) {
          case 'compute_unit_seconds':          out.computeSeconds += value; recognised = true; break
          case 'public_network_transfer_bytes': out.publicTransferBytes += value; recognised = true; break
          case 'private_network_transfer_bytes':out.privateTransferBytes += value; recognised = true; break
          case 'root_branch_bytes_month':
          case 'child_branch_bytes_month':
          case 'instant_restore_bytes_month':
          case 'snapshot_storage_bytes_month':  out.storageByteMonths += value; recognised = true; break
          default: break
        }
      }
      if (recognised) { out.shape = out.shape ?? 'v2'; out.rows += 1 }
      continue
    }
    if (!LEGACY_KEYS.some(k => row[k] !== undefined)) continue
    out.computeSeconds += num(row.compute_time_seconds)
    if (row.public_data_transfer_bytes !== undefined || row.private_data_transfer_bytes !== undefined) {
      out.publicTransferBytes  += num(row.public_data_transfer_bytes)
      out.privateTransferBytes += num(row.private_data_transfer_bytes)
    } else {
      out.publicTransferBytes += num(row.data_transfer_bytes)
    }
    const storage = num(row.synthetic_storage_size_bytes)
    if (storage > out.storageBytes) out.storageBytes = storage
    out.shape = out.shape ?? 'legacy'
    out.rows += 1
  }
  return out
}

async function getJson(url: string, key: string): Promise<{ status: number; json: unknown }> {
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) return { status: res.status, json: null }
  try {
    return { status: res.status, json: await res.json() }
  } catch {
    return { status: res.status, json: null }
  }
}

/** Resolve the organization the personal key belongs to (first membership). */
async function resolveOrgId(key: string): Promise<string | null> {
  const fromEnv = process.env.NEON_ORG_ID
  if (fromEnv) return fromEnv
  try {
    const { json } = await getJson(`${API}/users/me/organizations`, key)
    const orgs = (json as { organizations?: Array<{ id?: string }> })?.organizations
    return orgs?.[0]?.id ?? null
  } catch {
    return null
  }
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
  const range = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(now.toISOString())}&granularity=hourly`

  let orgId: string | null = null
  try {
    orgId = await resolveOrgId(apiKey)
  } catch { /* fall through — the un-scoped attempts may still work */ }

  const org = orgId ? `org_id=${encodeURIComponent(orgId)}&` : ''
  const candidates: Array<{ label: string; url: string }> = []
  if (orgId) {
    candidates.push({ label: `account?org_id (${orgId.slice(0, 4)}…)`, url: `${API}/consumption_history/account?${org}${range}` })
    candidates.push({ label: 'projects?org_id', url: `${API}/consumption_history/projects?${org}${range}` })
    candidates.push({ label: 'v2/projects?org_id', url: `${API}/consumption_history/v2/projects?${org}${range}` })
  }
  candidates.push({ label: 'account (unscoped)', url: `${API}/consumption_history/account?${range}` })

  const attempts: string[] = []
  let totals: NeonTotals | null = null
  let usedLabel = ''
  for (const c of candidates) {
    let status = 0
    try {
      const r = await getJson(c.url, apiKey)
      status = r.status
      if (r.status === 200) {
        const parsed = parseNeonConsumption(r.json)
        if (parsed.shape) { totals = parsed; usedLabel = `${c.label} [${parsed.shape}]`; break }
        attempts.push(`${c.label}→200 but unrecognised shape`)
        continue
      }
    } catch (err) {
      attempts.push(`${c.label}→${(err as Error).message}`)
      continue
    }
    attempts.push(`${c.label}→HTTP ${status}`)
  }

  if (!totals) {
    return {
      ...base,
      note: `Neon consumption unavailable. Tried: ${attempts.join('; ')}.` +
        (orgId ? '' : ' No organization resolved — set NEON_ORG_ID if the key is personal.'),
    }
  }

  const cuHours    = totals.computeSeconds / 3600
  const transferGb = totals.publicTransferBytes / 1024 ** 3
  const privateGb  = totals.privateTransferBytes / 1024 ** 3
  const monthFrac  = now.getUTCDate() / 30

  // Storage: the legacy shape reports an instantaneous size (pro-rate it); the
  // v2 shape reports a time-integrated byte-month figure (already pro-rated).
  const storageGb = totals.shape === 'v2'
    ? totals.storageByteMonths / 1024 ** 3
    : totals.storageBytes / 1024 ** 3
  const storageCost = totals.shape === 'v2'
    ? storageGb * STORAGE_USD_PER_GB_MO
    : storageGb * STORAGE_USD_PER_GB_MO * monthFrac

  const transferOverGb = Math.max(transferGb - TRANSFER_INCLUDED_GB, 0)
  const metrics: UsageMetric[] = [
    {
      name: 'network_transfer_gb', mtd: Number(transferGb.toFixed(3)), unit: 'GB',
      estCostUsd: Number((transferOverGb * TRANSFER_USD_PER_GB).toFixed(2)),
      allowanceUsedPct: Number(((transferGb / TRANSFER_INCLUDED_GB) * 100).toFixed(1)),
    },
    { name: 'private_transfer_gb', mtd: Number(privateGb.toFixed(3)), unit: 'GB', estCostUsd: 0 },
    {
      name: 'compute_cu_hours', mtd: Number(cuHours.toFixed(2)), unit: 'CU-hr',
      estCostUsd: Number((cuHours * COMPUTE_USD_PER_CU_HR).toFixed(2)),
    },
    {
      name: 'storage_gb', mtd: Number(storageGb.toFixed(2)), unit: totals.shape === 'v2' ? 'GB-mo' : 'GB',
      estCostUsd: Number(storageCost.toFixed(2)),
    },
  ]

  return {
    ...base,
    ok: true,
    note: `Neon consumption via ${usedLabel}, ${totals.rows} rows.`,
    metrics,
    variableMtdUsd: Number(metrics.reduce((s, m) => s + m.estCostUsd, 0).toFixed(2)),
  }
}
