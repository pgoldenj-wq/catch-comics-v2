/**
 * Vercel adapter — honest by design.
 *
 * Vercel does not expose a stable public "current spend" REST endpoint for
 * personal/Pro accounts, so this adapter does NOT invent usage numbers.
 * Vercel protection comes from two real mechanisms instead:
 *
 *  1. Spend Management (dashboard) — warning emails, a webhook at each
 *     threshold notch, and an optional automatic project pause at the limit.
 *     The webhook posts to /api/costguard/vercel-webhook, which records the
 *     event and escalates Cost Guard state (RED at ≥50% notches, LOCKDOWN
 *     at 100%). That is push-based truth from the provider itself.
 *  2. This adapter surfaces the latest webhook-reported spend (persisted by
 *     the webhook route into the store) so the panel shows something real.
 *
 * VERCEL_SPEND_LIMIT_USD (optional env) mirrors the dashboard limit so
 * percentage maths use the real configured cap.
 */

import type { ProviderUsage } from '../types'

export interface VercelWebhookMemo {
  reportedSpendUsd: number
  limitUsd: number
  pctUsed: number
  at: string
}

export async function collectVercel(
  webhookMemo: VercelWebhookMemo | null,
  now: Date = new Date(),
): Promise<ProviderUsage> {
  const base: ProviderUsage = {
    provider: 'vercel',
    configured: false,
    ok: false,
    collectedAt: now.toISOString(),
    metrics: [],
    fixedMonthlyUsd: 20, // Pro seat — fixed, never trips breakers
    variableMtdUsd: 0,
  }

  const webhookConfigured = Boolean(process.env.COSTGUARD_WEBHOOK_SECRET)
  if (!webhookConfigured) {
    return { ...base, note: 'COSTGUARD_WEBHOOK_SECRET not set — Spend Management webhook inactive. See COST-GUARD.md.' }
  }
  base.configured = true

  // No webhook fired this month = no metered overage reported. That is a
  // real signal (Spend Management only fires on threshold crossings), but we
  // only claim ok:true because the channel is configured; spend shown is the
  // provider's own last report, never an estimate.
  const memoIsCurrentMonth = webhookMemo &&
    webhookMemo.at.slice(0, 7) === now.toISOString().slice(0, 7)
  const spend = memoIsCurrentMonth ? webhookMemo.reportedSpendUsd : 0

  return {
    ...base,
    ok: true,
    note: memoIsCurrentMonth
      ? `Spend Management reported $${spend.toFixed(2)} (${webhookMemo.pctUsed}% of limit) at ${webhookMemo.at}.`
      : 'No Spend Management webhook event this month (no metered overage reported).',
    metrics: [
      {
        name: 'spend_management_reported_usd',
        mtd: Number(spend.toFixed(2)),
        unit: 'USD',
        estCostUsd: Number(spend.toFixed(2)),
        allowanceUsedPct: memoIsCurrentMonth ? webhookMemo.pctUsed : 0,
      },
    ],
    variableMtdUsd: Number(spend.toFixed(2)),
  }
}
