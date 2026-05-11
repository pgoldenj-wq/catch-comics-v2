/**
 * Catch Comics — Edge middleware
 *
 * Guards /admin/* and /api/admin/* routes with a simple password cookie.
 * The cookie value is btoa(ADMIN_PASSWORD). Login is handled by
 * /api/admin/auth (POST to set, DELETE to clear).
 *
 * This is intentionally minimal — replace with proper auth (NextAuth, Clerk,
 * etc.) before adding sensitive data or making this public-facing.
 */

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const PUBLIC_ADMIN_PATHS = [
  '/admin/login',
  '/api/admin/auth',
]

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl

  // Only gate admin routes
  if (!pathname.startsWith('/admin') && !pathname.startsWith('/api/admin')) {
    return NextResponse.next()
  }

  // Allow login page and auth API through unconditionally
  if (PUBLIC_ADMIN_PATHS.some(p => pathname.startsWith(p))) {
    return NextResponse.next()
  }

  const password = process.env.ADMIN_PASSWORD
  if (!password) {
    // ADMIN_PASSWORD not configured — block access
    return new NextResponse('Admin not configured: set ADMIN_PASSWORD env var', {
      status: 503,
    })
  }

  const expected = btoa(password)
  const cookie   = request.cookies.get('cc_admin')?.value

  if (cookie !== expected) {
    const loginUrl = new URL('/admin/login', request.url)
    loginUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/admin/:path*', '/api/admin/:path*'],
}
