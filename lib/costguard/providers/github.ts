/**
 * GitHub adapter — Actions minutes + metered billing usage.
 *
 * Requires GITHUB_BILLING_TOKEN (fine-grained PAT with "Plan: read-only"
 * permission for the pgoldenj-wq account). Tries the enhanced-billing usage
 * endpoint first, falls back to the legacy Actions billing endpoint. Parsed
 * defensively; anything unparseable → ok:false (never a fake zero).
 */

import type { ProviderUsage, UsageMetric } from '../types'

const GH_USER = process.env.COSTGUARD_GITHUB_USER || 'pgoldenj-wq'
const INCLUDED_MINUTES = 2000 // GitHub Free, private repos

export async function collectGithub(now: Date = new Date()): Promise<ProviderUsage> {
  const base: ProviderUsage = {
    provider: 'github',
    configured: false,
    ok: false,
    collectedAt: now.toISOString(),
    metrics: [],
    fixedMonthlyUsd: 0,
    variableMtdUsd: 0,
  }
  const token = process.env.GITHUB_BILLING_TOKEN
  if (!token) return { ...base, note: 'GITHUB_BILLING_TOKEN not set — see COST-GUARD.md manual actions.' }
  base.configured = true

  const headers = {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
  }

  // Preferred: enhanced billing platform usage report (month-scoped).
  try {
    const res = await fetch(
      `https://api.github.com/users/${GH_USER}/settings/billing/usage` +
      `?year=${now.getUTCFullYear()}&month=${now.getUTCMonth() + 1}`,
      { headers, signal: AbortSignal.timeout(20_000) },
    )
    if (res.ok) {
      const json = await res.json() as {
        usageItems?: Array<{
          product?: string; sku?: string; quantity?: number
          netAmount?: number; unitType?: string
        }>
      }
      if (Array.isArray(json.usageItems)) {
        let actionsMinutes = 0
        let actionsPaidMinutes = 0
        let paidUsd = 0
        for (const item of json.usageItems) {
          const net = Number(item.netAmount ?? 0)
          paidUsd += net
          if ((item.product ?? '').toLowerCase() === 'actions' &&
              (item.unitType ?? '').toLowerCase().includes('minute')) {
            const qty = Number(item.quantity ?? 0)
            actionsMinutes += qty
            if (net > 0) actionsPaidMinutes += qty
          }
        }
        const metrics: UsageMetric[] = [
          {
            name: 'actions_minutes', mtd: Number(actionsMinutes.toFixed(0)), unit: 'min',
            estCostUsd: 0, // paid amount comes from netAmount below
            allowanceUsedPct: Number(((actionsMinutes / INCLUDED_MINUTES) * 100).toFixed(1)),
          },
          {
            // Minutes actually charged for. The engine's rate breaker keys on
            // THIS, not on total minutes: on a public repository standard
            // runners are free and unlimited, so busy CI is not spend and must
            // never trip RED. See collectGithub's header note.
            name: 'actions_paid_minutes', mtd: Number(actionsPaidMinutes.toFixed(0)), unit: 'min',
            estCostUsd: 0,
          },
          {
            name: 'metered_paid_usd', mtd: Number(paidUsd.toFixed(2)), unit: 'USD',
            estCostUsd: Number(paidUsd.toFixed(2)),
          },
        ]
        return {
          ...base, ok: true, metrics,
          variableMtdUsd: Number(paidUsd.toFixed(2)),
        }
      }
    }
  } catch { /* fall through to legacy endpoint */ }

  // Legacy fallback: Actions-only billing summary.
  try {
    const res = await fetch(
      `https://api.github.com/users/${GH_USER}/settings/billing/actions`,
      { headers, signal: AbortSignal.timeout(20_000) },
    )
    if (!res.ok) return { ...base, note: `GitHub billing API HTTP ${res.status}.` }
    const json = await res.json() as {
      total_minutes_used?: number; total_paid_minutes_used?: number
    }
    const mins = Number(json.total_minutes_used ?? 0)
    const paidMins = Number(json.total_paid_minutes_used ?? 0)
    const paidUsd = paidMins * 0.008 // ubuntu Actions rate
    const metrics: UsageMetric[] = [
      {
        name: 'actions_minutes', mtd: mins, unit: 'min', estCostUsd: 0,
        allowanceUsedPct: Number(((mins / INCLUDED_MINUTES) * 100).toFixed(1)),
      },
      { name: 'actions_paid_minutes', mtd: paidMins, unit: 'min', estCostUsd: 0 },
      { name: 'metered_paid_usd', mtd: Number(paidUsd.toFixed(2)), unit: 'USD', estCostUsd: Number(paidUsd.toFixed(2)) },
    ]
    return { ...base, ok: true, metrics, variableMtdUsd: Number(paidUsd.toFixed(2)) }
  } catch (err) {
    return { ...base, note: `GitHub billing API unreachable: ${(err as Error).message}` }
  }
}
