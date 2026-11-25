/**
 * PATCH /api/product/[slug]/comicvine-id
 *
 * Self-healing endpoint: fills in a missing Comic Vine volume id on a
 * canonical product so the next ISR revalidation can serve character tags,
 * the issue grid and the cover without another CV search.
 *
 * Called client-side by the issue grid. Fire-and-forget.
 *
 * THE CALLER DOES NOT CHOOSE THE ID.
 *
 * This route is public — proxy.ts matches only /admin/* and /api/admin/*.
 * It originally took an unconditional `update` from an unauthenticated body,
 * so one request could repoint any product at any volume. That was narrowed
 * to gap-fill only (2026-11-22), which stopped overwrites but still let an
 * anonymous caller pick the FIRST value for any of the ~125k products whose
 * comicvine_id is null — and because gap-fill then refuses to overwrite, a
 * poisoned id became permanent and uncorrectable.
 *
 * The decision that authorises the write — "does this volume's name actually
 * match this product?" — used to be computed in the browser, in
 * components/useIssueList.ts, and the server took it on trust. It is now made
 * here, on the server, from the product's own title as stored in the database
 * and a Comic Vine lookup this route performs itself. The request body is
 * ignored entirely: there is no value a caller can send that becomes data.
 *
 * Body: none required. Any body is ignored.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { enforceRateLimit } from '@/lib/security/rateLimit'
import { searchVolumeByTitle, titleSimilarity, SELF_HEAL_THRESHOLD } from '@/lib/comicvine/title-match'

/** One answer for every outcome that is not a write, so probing reveals nothing. */
const NO_CHANGE = { ok: true, updated: false } as const

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const limited = await enforceRateLimit(request, 'comicvine-id', 30)
  if (limited) return limited

  const { slug } = await params

  try {
    // The title comes from our own row, never from the caller.
    const product = await prisma.canonicalProduct.findFirst({
      where:  { canonicalSlug: slug, deletedAt: null },
      select: { comicvineId: true, seriesName: true, title: true },
    })

    // Unknown slug, or the id is already set. Both answer identically, and
    // both return before spending any Comic Vine quota.
    if (!product || product.comicvineId !== null) {
      return NextResponse.json(NO_CHANGE)
    }

    const searchTitle = (product.seriesName ?? product.title ?? '').trim()
    if (!searchTitle) return NextResponse.json(NO_CHANGE)

    // Resolve server-side. This is the same lookup /api/comic/search serves,
    // so a caller gains nothing by calling that first.
    const match = await searchVolumeByTitle(searchTitle)
    if (!match.volumeId || !match.name) return NextResponse.json(NO_CHANGE)

    // The confidence gate, re-made here rather than believed from a client.
    const similarity = titleSimilarity(searchTitle, match.name)
    if (similarity < SELF_HEAL_THRESHOLD) {
      console.warn(
        `[product/comicvine-id] refused slug=${slug}: "${match.name}" scored ` +
        `${similarity.toFixed(2)} against "${searchTitle}" (need ${SELF_HEAL_THRESHOLD})`,
      )
      return NextResponse.json(NO_CHANGE)
    }

    // The null in the WHERE keeps the check and the write a single statement,
    // so two callers arriving together cannot both get past it.
    const { count } = await prisma.canonicalProduct.updateMany({
      where: { canonicalSlug: slug, comicvineId: null },
      data:  { comicvineId: match.volumeId },
    })
    if (count === 0) return NextResponse.json(NO_CHANGE)

    console.log(
      `[product/comicvine-id] self-healed slug=${slug} → CV ${match.volumeId} ` +
      `("${match.name}", similarity ${similarity.toFixed(2)})`,
    )
    return NextResponse.json({ ok: true, updated: true })

  } catch (err) {
    console.error('[product/comicvine-id] PATCH failed:', err)
    return NextResponse.json({ error: 'DB update failed' }, { status: 500 })
  }
}
