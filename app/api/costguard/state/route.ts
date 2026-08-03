/**
 * GET /api/costguard/state — read-only sanitized Cost Guard state + recent
 * events. Used by scripts/costguard-status.ts (Mission Control refresh) and
 * manual checks.
 *
 * Auth: bearer COSTGUARD_CRON_SECRET or the cc_admin cookie (same cookie the
 * admin area sets). Contains no credentials — but cost posture is still
 * operational data, so it is never public.
 */

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getEvents, getState } from '@/lib/costguard/store'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const secret = process.env.COSTGUARD_CRON_SECRET
  const auth = req.headers.get('authorization') ?? ''
  const bearerOk = Boolean(secret) && auth === `Bearer ${secret}`

  let cookieOk = false
  const adminPw = process.env.ADMIN_PASSWORD
  if (adminPw) {
    const cookieStore = await cookies()
    cookieOk = cookieStore.get('cc_admin')?.value === btoa(adminPw)
  }

  if (!bearerOk && !cookieOk) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const [state, events] = await Promise.all([getState(), getEvents()])
  return NextResponse.json({
    state: state ?? null,
    events: events.slice(-40),
    note: state ? undefined : 'No Cost Guard state yet — collection has never run.',
  })
}
