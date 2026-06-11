/**
 * POST /api/log-error
 *
 * Receives client-side errors from the React error boundary (app/error.tsx)
 * and writes them to Vercel server logs where they are captured by Observability.
 *
 * This gives visibility into client-side crashes without any third-party service,
 * cookies, or additional privacy implications.
 *
 * Body: { message: string, stack?: string, digest?: string, page?: string }
 */

import { NextRequest, NextResponse } from 'next/server'

interface ErrorPayload {
  message: string
  stack?:  string
  digest?: string
  page?:   string
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as ErrorPayload

    // Sanitise — only log strings, no arbitrary data
    const message = String(body.message || 'unknown error').slice(0, 1000)
    const stack   = body.stack   ? String(body.stack).slice(0, 3000)  : undefined
    const digest  = body.digest  ? String(body.digest).slice(0, 100)  : undefined
    const page    = body.page    ? String(body.page).slice(0, 200)    : undefined

    console.error(
      '[client-error]',
      JSON.stringify({ message, digest, page, stack }, null, 2)
    )

    return NextResponse.json({ ok: true })
  } catch {
    // Never let the error logger itself throw — just acknowledge
    return NextResponse.json({ ok: true })
  }
}
