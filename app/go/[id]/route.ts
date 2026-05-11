/**
 * GET /go/{listing_id}
 *
 * Affiliate tracking redirect. Looks up a retailer_listing by id and
 * redirects to retailer_url. Returns 404 when the listing does not exist.
 *
 * This is a thin trampoline — add analytics / click logging here later.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  if (!id || !/^[0-9a-f-]{36}$/.test(id)) {
    return new NextResponse('Invalid listing id', { status: 400 })
  }

  try {
    const listing = await prisma.retailerListing.findUnique({
      where:  { id },
      select: { retailerUrl: true },
    })

    if (!listing) {
      return new NextResponse('Listing not found', { status: 404 })
    }

    return NextResponse.redirect(listing.retailerUrl, { status: 302 })
  } catch (err) {
    console.error('[/go] redirect error:', err)
    return new NextResponse('Server error', { status: 500 })
  }
}
