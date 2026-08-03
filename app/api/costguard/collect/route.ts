/**
 * POST /api/costguard/collect — run a Cost Guard collection cycle.
 *
 * Called hourly by .github/workflows/cost-guard.yml. Auth: bearer
 * COSTGUARD_CRON_SECRET (same shared-secret convention as ADMIN_PASSWORD).
 * Returns the resulting state so the caller can fail visibly on RED/LOCKDOWN.
 *
 * 503 when the secret env is missing — the system is explicit about being
 * unconfigured rather than silently open or silently dead.
 */

import { NextRequest, NextResponse } from 'next/server'
import { runCollection } from '@/lib/costguard/collect'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const secret = process.env.COSTGUARD_CRON_SECRET
  if (!secret) {
    return NextResponse.json(
      { error: 'COSTGUARD_CRON_SECRET not configured' }, { status: 503 },
    )
  }
  const auth = req.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await runCollection()
    return NextResponse.json({
      state: result.state.state,
      reasons: result.state.reasons,
      totals: result.state.totals,
      staleProviders: result.state.staleProviders,
      unconfiguredProviders: result.state.unconfiguredProviders,
      storeMode: result.storeMode,
      emittedEvents: result.emittedEvents,
      at: result.snapshot.at,
    })
  } catch (err) {
    console.error('[costguard/collect] collection failed:', err)
    return NextResponse.json(
      { error: 'Collection failed', detail: (err as Error).message }, { status: 500 },
    )
  }
}
