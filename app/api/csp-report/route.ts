/**
 * POST /api/csp-report
 *
 * Collection sink for Content-Security-Policy-Report-Only violation reports.
 * The CSP is Report-Only (see next.config.ts) — it blocks nothing — so this
 * endpoint exists only to make the violations visible in Vercel logs while we
 * tune the policy toward an eventual enforced CSP.
 *
 * Browsers post either `{ "csp-report": {...} }` (report-uri) or an array of
 * reports (report-to / Reporting API). We log a truncated form of whatever
 * arrives and always answer 204.
 */

import { NextRequest, NextResponse } from 'next/server'
import { enforceRateLimit } from '@/lib/security/rateLimit'

export async function POST(req: NextRequest) {
  // Unauthenticated endpoint — cap it so it cannot be used to flood logs.
  const limited = await enforceRateLimit(req, 'csp-report', 60)
  if (limited) return limited

  try {
    const body = await req.json()
    console.warn('[csp-report]', JSON.stringify(body).slice(0, 2000))
  } catch {
    // Malformed body — ignore, never throw from the reporter.
  }

  return new NextResponse(null, { status: 204 })
}
