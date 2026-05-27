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
 * Body: { comicvineId: string }
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
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
    await prisma.canonicalProduct.update({
      where: { canonicalSlug: slug },
      data:  { comicvineId },
    })
    console.log(`[product/comicvine-id] self-healed slug=${slug} → CV ${comicvineId}`)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[product/comicvine-id] PATCH failed:', err)
    return NextResponse.json({ error: 'DB update failed' }, { status: 500 })
  }
}
