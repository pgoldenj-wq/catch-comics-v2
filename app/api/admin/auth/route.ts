import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'

// POST /api/admin/auth  — set cookie if password matches
export async function POST(req: NextRequest) {
  const { password } = await req.json() as { password?: string }

  const expected = process.env.ADMIN_PASSWORD
  if (!expected) {
    return NextResponse.json({ error: 'ADMIN_PASSWORD not configured' }, { status: 503 })
  }

  if (password !== expected) {
    return NextResponse.json({ error: 'Wrong password' }, { status: 401 })
  }

  const cookieStore = await cookies()
  cookieStore.set('cc_admin', btoa(expected), {
    httpOnly : true,
    sameSite : 'lax',
    path     : '/',
    // No explicit maxAge → session cookie; set maxAge for persistent login
    maxAge   : 60 * 60 * 24 * 7, // 7 days
  })

  return NextResponse.json({ ok: true })
}

// GET /api/admin/auth?action=logout — clear cookie and redirect
export async function GET(req: NextRequest) {
  const action = req.nextUrl.searchParams.get('action')
  if (action === 'logout') {
    const cookieStore = await cookies()
    cookieStore.delete('cc_admin')
    return NextResponse.redirect(new URL('/admin/login', req.url))
  }
  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
