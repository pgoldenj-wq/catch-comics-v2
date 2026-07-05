/**
 * Minimal fixed-window rate limiter for unauthenticated public endpoints.
 *
 * Purpose: stop scripted abuse from hammering paid/external APIs (eBay, Comic
 * Vine) or expensive DB work and running up the Vercel / vendor bill. Limits are
 * deliberately generous so a normal human — even several behind one NAT'd IP —
 * never hits them; only automated floods do.
 *
 * Backing store: Vercel KV (already provisioned for this project). One INCR per
 * request against a per-(route,ip,window) key with a TTL equal to the window.
 *
 * Fail-open by design: if the kill-switch is set, if KV is not configured (e.g.
 * local dev), or if KV errors, the request is ALLOWED. A limiter must never take
 * the site down — under-blocking is safe, over-blocking breaks real users.
 *
 *   Kill-switch: set RATE_LIMIT_DISABLED=1 to bypass entirely.
 *
 * Reference: OWASP API Security Top 10 API4:2023 (Unrestricted Resource
 * Consumption); OWASP ASVS 11.1.4 (anti-automation).
 */

import { kv } from '@vercel/kv'
import { NextResponse } from 'next/server'

const KV_CONFIGURED = Boolean(
  process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN,
)

function killSwitchOn(): boolean {
  return process.env.RATE_LIMIT_DISABLED === '1'
}

/** Best-effort client IP. On Vercel, x-forwarded-for is set by the platform. */
export function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0]!.trim()
  const real = req.headers.get('x-real-ip')
  if (real) return real.trim()
  return 'unknown'
}

export interface RateLimitResult {
  ok: boolean
  limit: number
  remaining: number
  /** Seconds until the current window resets (only meaningful when !ok). */
  retryAfter: number
}

/**
 * Consume one token for `identifier` in a fixed `windowSec` window.
 * Always resolves; never throws. Fail-open on any error / missing KV.
 */
export async function rateLimit(opts: {
  identifier: string
  limit: number
  windowSec: number
}): Promise<RateLimitResult> {
  const { identifier, limit, windowSec } = opts

  if (killSwitchOn() || !KV_CONFIGURED) {
    return { ok: true, limit, remaining: limit, retryAfter: 0 }
  }

  const nowSec = Math.floor(Date.now() / 1000)
  const windowStart = Math.floor(nowSec / windowSec)
  const key = `rl:${identifier}:${windowStart}`

  try {
    const count = await kv.incr(key)
    if (count === 1) {
      // First hit in this window — attach a TTL so the key self-expires.
      await kv.expire(key, windowSec)
    }
    if (count > limit) {
      const retryAfter = windowSec - (nowSec % windowSec)
      return { ok: false, limit, remaining: 0, retryAfter }
    }
    return { ok: true, limit, remaining: Math.max(0, limit - count), retryAfter: 0 }
  } catch (err) {
    // KV hiccup must never block a real user.
    console.warn('[rateLimit] KV error — failing open:', err)
    return { ok: true, limit, remaining: limit, retryAfter: 0 }
  }
}

/**
 * Convenience guard for route handlers. Returns a 429 NextResponse when the
 * caller is over the limit, or `null` to proceed. Usage:
 *
 *   const limited = await enforceRateLimit(req, 'ebay', 40)
 *   if (limited) return limited
 */
export async function enforceRateLimit(
  req: Request,
  route: string,
  limit: number,
  windowSec = 60,
): Promise<NextResponse | null> {
  const result = await rateLimit({
    identifier: `${route}:${clientIp(req)}`,
    limit,
    windowSec,
  })
  if (result.ok) return null

  return NextResponse.json(
    { error: 'Too many requests. Please slow down and try again shortly.' },
    {
      status: 429,
      headers: {
        'Retry-After': String(result.retryAfter),
        'X-RateLimit-Limit': String(result.limit),
        'X-RateLimit-Remaining': '0',
      },
    },
  )
}
