/**
 * POST /api/costguard/vercel-webhook — Vercel Spend Management notifications.
 *
 * Configure in Vercel: Team Settings → Billing → Spend Management → Webhook.
 * The URL carries NO secret:
 *   https://www.catchcomics.com/api/costguard/vercel-webhook
 *
 * AUTHENTICATION — signature only. Vercel signs each delivery with an
 * HMAC-SHA1 of the RAW request body, keyed by the signing secret it shows
 * when the webhook is created, and sends it in `x-vercel-signature`. We:
 *   1. read the raw body before any JSON parsing,
 *   2. require the signature header (missing/malformed ⇒ 401),
 *   3. recompute HMAC-SHA1 over the raw bytes with COSTGUARD_WEBHOOK_SECRET,
 *   4. compare in constant time,
 *   5. reject BEFORE parsing, persisting, changing state, applying any
 *      restriction, or writing an audit event.
 *
 * There is no query-string token, no bearer fallback and no unsigned
 * compatibility path: a secret in a URL leaks through logs, referrers and
 * proxies, and an unsigned event could force LOCKDOWN (a denial of service
 * on every bulk job). A missing signing secret fails CLOSED (503) — an
 * unsigned event is never treated as valid.
 *
 * Deliveries are idempotent: the delivery id (payload id when present, else
 * a SHA-256 of the raw body) is checked against a bounded ledger before any
 * mutation, so a redelivery never re-applies enforcement or duplicates an
 * alert.
 *
 * Effect (threshold events): ≥100% of limit → LOCKDOWN (latched), ≥50% → RED,
 * below 50% → AMBER. End-of-billing-cycle events record the reset and never
 * escalate. The Spend Management "pause project" toggle remains the
 * provider-native catastrophic backstop; this webhook is the layer above it.
 *
 * No secret value is ever logged, returned, or persisted.
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { COSTGUARD_CONFIG as CFG } from '@/lib/costguard/config'
import {
  appendEvent, getState, markDeliveryProcessed, setState,
  setVercelWebhookMemo, wasDeliveryProcessed,
} from '@/lib/costguard/store'
import type { CostGuardState, GuardState } from '@/lib/costguard/types'

export const dynamic = 'force-dynamic'

/** Constant-time hex-digest comparison; false on any length/format mismatch. */
function signatureMatches(expectedHex: string, providedHex: string): boolean {
  if (typeof providedHex !== 'string') return false
  // Must be a well-formed SHA-1 hex digest; also guarantees equal lengths so
  // timingSafeEqual cannot throw.
  if (!/^[0-9a-f]{40}$/i.test(providedHex)) return false
  const a = Buffer.from(expectedHex.toLowerCase(), 'utf8')
  const b = Buffer.from(providedHex.toLowerCase(), 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export async function POST(req: NextRequest) {
  // ── 1. Fail closed when the signing secret is absent ─────────────────────
  const secret = process.env.COSTGUARD_WEBHOOK_SECRET
  if (!secret) {
    // Never process an event we cannot verify.
    return NextResponse.json(
      { error: 'Webhook signing secret not configured' }, { status: 503 },
    )
  }

  // ── 2. Raw body FIRST — signatures are over bytes, not over parsed JSON ──
  const rawBody = await req.text()

  // ── 3. Signature required ────────────────────────────────────────────────
  const provided = req.headers.get('x-vercel-signature')
  if (!provided) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 401 })
  }
  const expected = createHmac('sha1', secret).update(rawBody, 'utf8').digest('hex')
  if (!signatureMatches(expected, provided)) {
    // Deliberately generic: no hint about which part failed.
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  // ── 4. Only now may the body be parsed ───────────────────────────────────
  let payload: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(rawBody)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return NextResponse.json({ error: 'Malformed payload' }, { status: 400 })
    }
    payload = parsed as Record<string, unknown>
  } catch {
    // Correctly signed but not valid JSON — authentic sender, unusable body.
    return NextResponse.json({ error: 'Malformed JSON' }, { status: 400 })
  }

  // ── 5. Team scoping when configured ──────────────────────────────────────
  const expectedTeam = process.env.VERCEL_TEAM_ID
  const body = payload as { teamId?: unknown; payload?: Record<string, unknown>; type?: unknown; id?: unknown }
  const p = (body.payload && typeof body.payload === 'object' ? body.payload : payload) as Record<string, unknown>
  if (expectedTeam) {
    const gotTeam = body.teamId ?? p.teamId
    if (typeof gotTeam === 'string' && gotTeam !== expectedTeam) {
      return NextResponse.json({ error: 'Unexpected team' }, { status: 403 })
    }
  }

  // ── 6. Idempotency — decided BEFORE any mutation ─────────────────────────
  const deliveryId = typeof body.id === 'string' && body.id.length > 0
    ? `id:${body.id}`
    : `body:${createHash('sha256').update(rawBody, 'utf8').digest('hex').slice(0, 32)}`
  if (await wasDeliveryProcessed(deliveryId)) {
    // Authentic replay: acknowledge without re-applying enforcement.
    return NextResponse.json({ ok: true, duplicate: true })
  }

  // ── 7. Interpret the event (shapes parsed defensively) ───────────────────
  const eventType = String(body.type ?? p.type ?? '').toLowerCase()
  const isCycleEnd = /reset|cycle|period.?end|end.?of.?(billing|cycle)/.test(eventType)

  const limitUsd = Number(p.budgetAmount ?? p.limit ?? process.env.VERCEL_SPEND_LIMIT_USD ?? 0)
  const spendUsd = Number(p.currentSpend ?? p.spend ?? p.amount ?? 0)
  const rawPct = Number(p.percentage ?? p.percent ?? NaN)
  const pctUsed = Number.isFinite(rawPct) && rawPct > 0
    ? Number(rawPct.toFixed(1))
    : limitUsd > 0
      ? Number(((spendUsd / limitUsd) * 100).toFixed(1))
      : 0

  const now = new Date().toISOString()
  await setVercelWebhookMemo({
    reportedSpendUsd: Number.isFinite(spendUsd) ? spendUsd : 0,
    limitUsd: Number.isFinite(limitUsd) ? limitUsd : 0,
    pctUsed,
    at: now,
  })

  const prev = await getState()
  const order: GuardState[] = ['GREEN', 'AMBER', 'RED', 'LOCKDOWN']
  const next: CostGuardState = prev ?? {
    state: 'AMBER', since: now, reasons: [], lockdownLatched: false, updatedAt: now,
    lastCollectionAt: null, staleProviders: [], unconfiguredProviders: [],
    totals: {
      variableMtdUsd: Number.isFinite(spendUsd) ? spendUsd : 0,
      fixedMonthlyUsd: 20,
      projectedMonthUsd: Number.isFinite(spendUsd) ? spendUsd : 0,
      burnUsdPerDay: 0, baselineUsdPerDay: null,
    },
    perProvider: [], activeRestrictions: [], counters: { abnormalSamples: 0, cleanSamples: 0 },
  }

  let target: GuardState | null = null
  if (isCycleEnd) {
    // Billing cycle rolled over: spend resets. Record it and let the engine's
    // own hysteresis de-escalate. Never escalate, never un-latch LOCKDOWN.
    next.reasons = [
      `Vercel billing cycle ended — spend counters reset (reported $${(Number.isFinite(spendUsd) ? spendUsd : 0).toFixed(2)}).`,
      ...next.reasons.filter(r => !r.startsWith('Vercel Spend Management')),
    ].slice(0, 8)
  } else {
    target = pctUsed >= 100 ? 'LOCKDOWN' : pctUsed >= 50 ? 'RED' : 'AMBER'
    if (order.indexOf(target) > order.indexOf(next.state)) {
      next.state = target
      next.since = now
    }
    next.reasons = [
      `Vercel Spend Management: $${(Number.isFinite(spendUsd) ? spendUsd : 0).toFixed(2)} = ${pctUsed}% of $${(Number.isFinite(limitUsd) ? limitUsd : 0).toFixed(2)} limit.`,
      ...next.reasons.filter(r => !r.startsWith('Vercel Spend Management')),
    ].slice(0, 8)
    if (target === 'LOCKDOWN') next.lockdownLatched = true
  }
  next.updatedAt = now
  await setState(next)

  await appendEvent(
    {
      at: now,
      kind: 'webhook',
      provider: 'vercel',
      // Unique per delivery: an authentic new event is always recorded, while
      // replays never reach here (short-circuited above).
      dedupeKey: `vercel-delivery:${deliveryId}`,
      message: isCycleEnd
        ? `Vercel billing cycle ended — spend reset recorded; state held at ${next.state}.`
        : `Vercel Spend Management webhook: ${pctUsed}% of limit → ${next.state}.`,
      detail: {
        trigger: isCycleEnd ? 'vercel-billing-cycle-end' : 'vercel-spend-management-webhook',
        measuredSpendUsd: Number.isFinite(spendUsd) ? spendUsd : 0,
        limitUsd: Number.isFinite(limitUsd) ? limitUsd : 0,
        pctUsed,
        action: isCycleEnd ? 'recorded cycle reset (no escalation)' : `state floor set to ${target}`,
        thresholdRedPct: 50,
        thresholdLockdownPct: 100,
        signatureVerified: true,
      },
    },
    CFG.alertDedupeWindowMs,
  )

  await markDeliveryProcessed(deliveryId)
  return NextResponse.json({ ok: true, state: next.state })
}
