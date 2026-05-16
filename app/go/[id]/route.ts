/**
 * GET /go/{listing_id}
 *
 * Click-tracking affiliate redirect.
 *
 * 1. Validates listing_id is a UUID and the listing exists (not stale > 30 days).
 * 2. Reads the anonymous session cookie (__cc_session); generates one if absent.
 * 3. Inserts a click_events row via `after()` so the write is guaranteed even
 *    after the response is flushed (does NOT block the redirect).
 * 4. Wraps retailerUrl through the retailer's affiliate network if configured.
 * 5. Returns 302 to the (possibly wrapped) destination URL.
 */

import { NextRequest, NextResponse, after } from 'next/server'
import { prisma }                           from '@/lib/prisma'
import { wrapAffiliateUrl }                 from '@/lib/affiliate'

// Listings last seen more than 30 days ago are treated as stale.
const STALE_DAYS = 30

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  // ── 1. Validate UUID format ────────────────────────────────────────────────
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) {
    return new NextResponse('Invalid listing id', { status: 400 })
  }

  // ── 2. Fetch listing + retailer ────────────────────────────────────────────
  let listing: {
    retailerUrl:      string
    lastSeenAt:       Date
    deletedAt:        Date | null
    retailer: {
      affiliateNetwork: string | null
      affiliateId:      string | null
    }
  } | null

  try {
    listing = await prisma.retailerListing.findUnique({
      where:  { id },
      select: {
        retailerUrl: true,
        lastSeenAt:  true,
        deletedAt:   true,
        retailer: {
          select: {
            affiliateNetwork: true,
            affiliateId:      true,
          },
        },
      },
    })
  } catch (err) {
    console.error('[/go] DB error fetching listing:', err)
    return new NextResponse('Server error', { status: 500 })
  }

  // Treat missing or soft-deleted listings the same — both return 404
  if (!listing || listing.deletedAt !== null) {
    return new NextResponse('Listing not found', { status: 404 })
  }

  // ── 3. Staleness check (soft — warn but still redirect) ───────────────────
  const ageMs    = Date.now() - listing.lastSeenAt.getTime()
  const ageDays  = ageMs / (1000 * 60 * 60 * 24)
  if (ageDays > STALE_DAYS) {
    console.warn(`[/go] listing ${id} is stale (${Math.round(ageDays)}d old) — redirecting anyway`)
  }

  // ── 4. Resolve / generate session token ───────────────────────────────────
  const cookieName    = '__cc_session'
  const existingToken = req.cookies.get(cookieName)?.value
  const sessionToken  = existingToken ?? crypto.randomUUID()

  // ── 5. Register click event insert with the runtime ───────────────────────
  //    `after` tells Vercel to keep the serverless function alive until the
  //    Promise resolves, even after the response has been flushed.  The user
  //    still gets the redirect instantly — there is no added latency.
  after(
    prisma.clickEvent.create({
      data: {
        listingId:   id,
        userSession: sessionToken,
        referrer:    req.headers.get('referer') ?? null,
        userAgent:   req.headers.get('user-agent') ?? null,
      },
    }).catch(err => console.error('[/go] click_event insert failed:', err))
  )

  // ── 6. Wrap URL through affiliate network if configured ───────────────────
  // clickref format: 'cc-{first 8 hex chars of listing UUID}'
  // Appears in Awin Transaction Reports for per-listing commission reconciliation.
  // Example: cc-3f7a9b2e → join on click_events.listing_id LIKE '3f7a9b2e%'
  const clickref    = `cc-${id.slice(0, 8)}`
  const destination = wrapAffiliateUrl(
    listing.retailerUrl,
    listing.retailer.affiliateNetwork,
    listing.retailer.affiliateId,
    clickref,
  )

  // ── 7. Redirect, setting session cookie if it's new ───────────────────────
  const response = NextResponse.redirect(destination, { status: 302 })

  if (!existingToken) {
    response.cookies.set(cookieName, sessionToken, {
      httpOnly: true,
      sameSite: 'lax',
      path:     '/',
      maxAge:   60 * 60 * 24 * 365, // 1 year
      secure:   process.env.NODE_ENV === 'production',
    })
  }

  return response
}
