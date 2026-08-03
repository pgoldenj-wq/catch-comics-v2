/**
 * POST /api/costguard/vercel-webhook — Vercel Spend Management notifications.
 *
 * Configure in Vercel: Team Settings → Billing → Spend Management →
 * "Webhook" with URL:
 *   https://www.catchcomics.com/api/costguard/vercel-webhook?token=<COSTGUARD_WEBHOOK_SECRET>
 *
 * Security: the request must carry the token query param matching
 * COSTGUARD_WEBHOOK_SECRET; when Vercel supplies an x-vercel-signature
 * header (account webhooks sign payloads with an HMAC-SHA1 of the body),
 * the signature must ALSO verify. An unsigned, untokened request is
 * rejected — we never trust an unauthenticated webhook.
 *
 * Effect: records the provider-reported spend, then escalates:
 *   ≥100% of the configured limit  → LOCKDOWN (latched)
 *   ≥50% notches                   → RED
 *   below 50%                      → AMBER
 * The Spend Management "pause project" toggle remains the provider-native
 * catastrophic backstop — this webhook is the early-warning layer above it.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { COSTGUARD_CONFIG as CFG } from '@/lib/costguard/config'
import {
  appendEvent, getState, setState, setVercelWebhookMemo,
} from '@/lib/costguard/store'
import type { CostGuardState, GuardState } from '@/lib/costguard/types'

export const dynamic = 'force-dynamic'

function signatureValid(body: string, header: string | null, secret: string): boolean {
  if (!header) return true // no signature header — token auth already passed
  try {
    const expected = createHmac('sha1', secret).update(body).digest('hex')
    return timingSafeEqual(Buffer.from(expected), Buffer.from(header))
  } catch {
    return false
  }
}

export async function POST(req: NextRequest) {
  const secret = process.env.COSTGUARD_WEBHOOK_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 })
  }
  if (req.nextUrl.searchParams.get('token') !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const bodyText = await req.text()
  if (!signatureValid(bodyText, req.headers.get('x-vercel-signature'), secret)) {
    return NextResponse.json({ error: 'Bad signature' }, { status: 401 })
  }

  // Payload shape is parsed defensively; Spend Management events carry the
  // configured limit and the percentage/amount consumed.
  let payload: Record<string, unknown> = {}
  try { payload = JSON.parse(bodyText) as Record<string, unknown> } catch { /* keep {} */ }
  const p = (payload.payload ?? payload) as Record<string, unknown>
  const limitUsd = Number(p.budgetAmount ?? p.limit ?? process.env.VERCEL_SPEND_LIMIT_USD ?? 0)
  const spendUsd = Number(p.currentSpend ?? p.spend ?? p.amount ?? 0)
  const pctUsed = limitUsd > 0
    ? Number(((spendUsd / limitUsd) * 100).toFixed(1))
    : Number(p.percentage ?? 0)

  const now = new Date().toISOString()
  await setVercelWebhookMemo({ reportedSpendUsd: spendUsd, limitUsd, pctUsed, at: now })

  // Escalate. Webhook events are provider-pushed truth — they bypass the
  // engine's sampling and set the floor state directly (engine keeps it via
  // its own hysteresis on the next cycle).
  const target: GuardState = pctUsed >= 100 ? 'LOCKDOWN' : pctUsed >= 50 ? 'RED' : 'AMBER'
  const prev = await getState()
  const order: GuardState[] = ['GREEN', 'AMBER', 'RED', 'LOCKDOWN']
  const next: CostGuardState = prev ?? {
    state: target, since: now, reasons: [], lockdownLatched: false, updatedAt: now,
    lastCollectionAt: null, staleProviders: [], unconfiguredProviders: [],
    totals: { variableMtdUsd: spendUsd, fixedMonthlyUsd: 20, projectedMonthUsd: spendUsd, burnUsdPerDay: 0, baselineUsdPerDay: null },
    perProvider: [], activeRestrictions: [], counters: { abnormalSamples: 0, cleanSamples: 0 },
  }
  if (order.indexOf(target) > order.indexOf(next.state)) {
    next.state = target
    next.since = now
  }
  next.reasons = [
    `Vercel Spend Management: $${spendUsd.toFixed(2)} = ${pctUsed}% of $${limitUsd.toFixed(2)} limit.`,
    ...next.reasons.filter(r => !r.startsWith('Vercel Spend Management')),
  ].slice(0, 8)
  if (target === 'LOCKDOWN') next.lockdownLatched = true
  next.updatedAt = now
  await setState(next)

  await appendEvent(
    {
      at: now,
      kind: 'webhook',
      provider: 'vercel',
      dedupeKey: `vercel-spend:${Math.floor(pctUsed / 10) * 10}`, // one event per 10% decile
      message: `Vercel Spend Management webhook: $${spendUsd.toFixed(2)} (${pctUsed}% of limit) → ${next.state}.`,
      detail: {
        trigger: 'vercel-spend-management-webhook',
        measuredSpendUsd: spendUsd,
        limitUsd,
        pctUsed,
        action: `state floor set to ${target}`,
        thresholdRedPct: 50,
        thresholdLockdownPct: 100,
      },
    },
    CFG.alertDedupeWindowMs,
  )

  return NextResponse.json({ ok: true, state: next.state })
}
