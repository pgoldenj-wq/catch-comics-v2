/**
 * PATCH /api/product/[slug]/comicvine-id
 *
 * Self-healing endpoint: writes a newly-discovered Comic Vine volume ID back to
 * the canonical_products row so that the next ISR revalidation serves the
 * comicvineId from the DB (making character tags, issues, and cover fetch work
 * without another CV search).
 *
 * Called client-side by CVIssuesGrid after a successful title-based CV search.
 * Fire-and-forget — the caller does not await the response.
 *
 * Self-healing means filling a gap, never overwriting. proxy.ts gates only
 * /admin and /api/admin, so this route is public: an unconditional update let
 * anyone repoint any product at any Comic Vine volume, and comicvine_id is
 * what drives the character tags, the issue grid and the cover. A write is
 * accepted only where the column is still null — the only case the caller
 * needs — and the route is throttled like every other public endpoint that
 * reaches the database.
 *
 * Body: { comicvineId: string }
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { enforceRateLimit } from '@/lib/security/rateLimit'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const limited = await enforceRateLimit(request, 'comicvine-id', 30)
  if (limited) return limited

  const { slug } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const comicvineId =
    body && typeof body === 'object' && 'comicvineId' in body
      ? (body as Record<string, unknown>).comicvineId
      : undefined

  if (!comicvineId || typeof comicvineId !== 'string' || !/^\d+$/.test(comicvineId)) {
    return NextResponse.json(
      { error: 'comicvineId must be a non-empty numeric string' },
      { status: 400 }
    )
  }

  try {
    // The null in the WHERE makes the check and the write one statement, so
    // two callers arriving together cannot both get past it.
    const { count } = await prisma.canonicalProduct.updateMany({
      where: { canonicalSlug: slug, comicvineId: null },
      data:  { comicvineId },
    })
    if (count === 0) {
      // The product already has an id, or there is no such slug. Both are
      // fine for a fire-and-forget self-heal, and the same answer to each
      // tells a prober nothing about which it was.
      return NextResponse.json({ ok: true, updated: false })
    }
    console.log(`[product/comicvine-id] self-healed slug=${slug} → CV ${comicvineId}`)
    return NextResponse.json({ ok: true, updated: true })
  } catch (err) {
    console.error('[product/comicvine-id] PATCH failed:', err)
    return NextResponse.json({ error: 'DB update failed' }, { status: 500 })
  }
}
