/**
 * Cloudflare/R2 adapter — storage + Class A/B operation volume via the
 * GraphQL Analytics API.
 *
 * Requires CLOUDFLARE_API_TOKEN (Analytics: Read) + CLOUDFLARE_ACCOUNT_ID.
 * R2 egress is free — it is deliberately NOT modelled as a billable
 * dimension. What CAN cost money: storage beyond 10 GB-month, Class A ops
 * beyond 1M/month ($4.50/M), Class B beyond 10M/month ($0.36/M). Runaway
 * write/list loops show up as Class A acceleration.
 */

import type { ProviderUsage, UsageMetric } from '../types'

const CLASS_A_INCLUDED = 1_000_000
const CLASS_B_INCLUDED = 10_000_000
const CLASS_A_USD_PER_M = 4.50
const CLASS_B_USD_PER_M = 0.36
const STORAGE_INCLUDED_GB = 10
const STORAGE_USD_PER_GB_MO = 0.015

export async function collectCloudflare(now: Date = new Date()): Promise<ProviderUsage> {
  const base: ProviderUsage = {
    provider: 'cloudflare',
    configured: false,
    ok: false,
    collectedAt: now.toISOString(),
    metrics: [],
    fixedMonthlyUsd: 0,
    variableMtdUsd: 0,
  }
  const token = process.env.CLOUDFLARE_API_TOKEN
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
  if (!token || !accountId) {
    return { ...base, note: 'CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID not set — see COST-GUARD.md.' }
  }
  base.configured = true

  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    .toISOString().slice(0, 10)
  const today = now.toISOString().slice(0, 10)

  const query = `
    query($accountTag: String!, $start: Date!, $end: Date!) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          r2OperationsAdaptiveGroups(
            filter: { date_geq: $start, date_leq: $end }
            limit: 100
          ) {
            dimensions { actionType }
            sum { requests }
          }
          r2StorageAdaptiveGroups(
            filter: { date_geq: $start, date_leq: $end }
            limit: 100
          ) {
            max { payloadSize }
          }
        }
      }
    }`

  interface GqlResponse {
    data?: {
      viewer?: {
        accounts?: Array<{
          r2OperationsAdaptiveGroups?: Array<{
            dimensions?: { actionType?: string }
            sum?: { requests?: number }
          }>
          r2StorageAdaptiveGroups?: Array<{ max?: { payloadSize?: number } }>
        }>
      }
    }
    errors?: Array<{ message?: string }>
  }

  let json: GqlResponse
  try {
    const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        query,
        variables: { accountTag: accountId, start: monthStart, end: today },
      }),
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) return { ...base, note: `Cloudflare GraphQL HTTP ${res.status}.` }
    json = await res.json() as GqlResponse
  } catch (err) {
    return { ...base, note: `Cloudflare GraphQL unreachable: ${(err as Error).message}` }
  }
  if (json.errors?.length) {
    return { ...base, note: `Cloudflare GraphQL error: ${json.errors[0]?.message ?? 'unknown'}.` }
  }

  const account = json.data?.viewer?.accounts?.[0]
  if (!account) return { ...base, note: 'Cloudflare GraphQL returned no account data.' }

  // Class A = mutating ops (PutObject, ListObjects, …); Class B = reads.
  const CLASS_A = new Set([
    'PutObject', 'CopyObject', 'CompleteMultipartUpload', 'CreateMultipartUpload',
    'ListObjects', 'ListMultipartUploads', 'UploadPart', 'UploadPartCopy',
    'ListParts', 'PutBucketEncryption', 'PutBucketCors', 'PutBucketLifecycleConfiguration',
    'DeleteObject',
  ])
  let classA = 0, classB = 0
  for (const g of account.r2OperationsAdaptiveGroups ?? []) {
    const n = Number(g.sum?.requests ?? 0)
    if (CLASS_A.has(g.dimensions?.actionType ?? '')) classA += n
    else classB += n
  }
  const storageBytes = Math.max(
    ...(account.r2StorageAdaptiveGroups ?? []).map(g => Number(g.max?.payloadSize ?? 0)),
    0,
  )
  const storageGb = storageBytes / 1024 ** 3
  const monthFrac = now.getUTCDate() / 30

  const metrics: UsageMetric[] = [
    {
      name: 'r2_class_a_ops', mtd: classA, unit: 'ops',
      estCostUsd: Number((Math.max(classA - CLASS_A_INCLUDED, 0) / 1e6 * CLASS_A_USD_PER_M).toFixed(2)),
      allowanceUsedPct: Number(((classA / CLASS_A_INCLUDED) * 100).toFixed(1)),
    },
    {
      name: 'r2_class_b_ops', mtd: classB, unit: 'ops',
      estCostUsd: Number((Math.max(classB - CLASS_B_INCLUDED, 0) / 1e6 * CLASS_B_USD_PER_M).toFixed(2)),
      allowanceUsedPct: Number(((classB / CLASS_B_INCLUDED) * 100).toFixed(1)),
    },
    {
      name: 'r2_storage_gb', mtd: Number(storageGb.toFixed(2)), unit: 'GB',
      estCostUsd: Number((Math.max(storageGb - STORAGE_INCLUDED_GB, 0) * STORAGE_USD_PER_GB_MO * monthFrac).toFixed(2)),
    },
  ]

  return {
    ...base, ok: true, metrics,
    variableMtdUsd: Number(metrics.reduce((s, m) => s + m.estCostUsd, 0).toFixed(2)),
  }
}
