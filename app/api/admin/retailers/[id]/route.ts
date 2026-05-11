/**
 * GET    /api/admin/retailers/:id — full detail (fields + sync logs + unmatched listings)
 * PATCH  /api/admin/retailers/:id — update retailer fields
 * DELETE /api/admin/retailers/:id — delete retailer (cascades listings, logs)
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma }                    from '@/lib/prisma'
import { RetailerPlatform }          from '@prisma/client'

type Ctx = { params: Promise<{ id: string }> }

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id } = await params

  const retailer = await prisma.retailer.findUnique({
    where  : { id },
    include: {
      _count  : { select: { listings: true } },
      syncLogs: {
        orderBy: { startedAt: 'desc' },
        take   : 20,
      },
    },
  })

  if (!retailer) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Matched listing count
  const matchedCount = await prisma.retailerListing.count({
    where: { retailerId: id, canonicalProductId: { not: null } },
  })

  // Top 20 unmatched listings by firstSeenAt desc
  const unmatchedListings = await prisma.retailerListing.findMany({
    where  : { retailerId: id, canonicalProductId: null },
    orderBy: { firstSeenAt: 'desc' },
    take   : 20,
    select : {
      id          : true,
      retailerSku : true,
      title       : true,
      priceAmount : true,
      stockStatus : true,
      retailerUrl : true,
      firstSeenAt : true,
    },
  })

  return NextResponse.json({
    id               : retailer.id,
    name             : retailer.name,
    domain           : retailer.domain,
    platform         : retailer.platform,
    countryCode      : retailer.countryCode,
    currency         : retailer.currency,
    isActive         : retailer.isActive,
    trustScore       : retailer.trustScore,
    affiliateNetwork : retailer.affiliateNetwork,
    affiliateId      : retailer.affiliateId,
    lastSyncedAt     : retailer.lastSyncedAt?.toISOString() ?? null,
    syncConfig       : retailer.syncConfig,
    createdAt        : retailer.createdAt.toISOString(),
    listingCount     : retailer._count.listings,
    matchedCount,
    syncLogs         : retailer.syncLogs.map(l => ({
      id             : l.id,
      startedAt      : l.startedAt.toISOString(),
      finishedAt     : l.finishedAt?.toISOString() ?? null,
      status         : l.status,
      productsFetched: l.productsFetched,
      listingsCreated: l.listingsCreated,
      listingsUpdated: l.listingsUpdated,
      priceChanges   : l.priceChanges,
      errorCount     : l.errorCount,
      errorSummary   : l.errorSummary,
    })),
    unmatchedListings: unmatchedListings.map(l => ({
      id         : l.id,
      retailerSku: l.retailerSku,
      title      : l.title,
      priceAmount: l.priceAmount.toString(),
      stockStatus: l.stockStatus,
      retailerUrl: l.retailerUrl,
      firstSeenAt: l.firstSeenAt.toISOString(),
    })),
  })
}

// ── PATCH ─────────────────────────────────────────────────────────────────────

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id } = await params
  const body = await req.json() as Partial<{
    name            : string
    platform        : string
    countryCode     : string
    currency        : string
    affiliateNetwork: string | null
    affiliateId     : string | null
    trustScore      : number
    isActive        : boolean
  }>

  const validPlatforms: string[] = Object.values(RetailerPlatform)

  if (body.platform && !validPlatforms.includes(body.platform)) {
    return NextResponse.json({ error: `Invalid platform: ${body.platform}` }, { status: 400 })
  }

  const updated = await prisma.retailer.update({
    where: { id },
    data : {
      ...(body.name             !== undefined ? { name:             body.name }                              : {}),
      ...(body.platform         !== undefined ? { platform:         body.platform as RetailerPlatform }      : {}),
      ...(body.countryCode      !== undefined ? { countryCode:      body.countryCode }                      : {}),
      ...(body.currency         !== undefined ? { currency:         body.currency }                         : {}),
      ...(body.affiliateNetwork !== undefined ? { affiliateNetwork: body.affiliateNetwork }                 : {}),
      ...(body.affiliateId      !== undefined ? { affiliateId:      body.affiliateId }                      : {}),
      ...(body.trustScore       !== undefined ? { trustScore:       body.trustScore }                       : {}),
      ...(body.isActive         !== undefined ? { isActive:         body.isActive }                         : {}),
    },
  })

  return NextResponse.json({ id: updated.id })
}

// ── DELETE ────────────────────────────────────────────────────────────────────

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { id } = await params

  // Cascade is handled at DB level (onDelete: Cascade on listings + syncLogs)
  await prisma.retailer.delete({ where: { id } })

  return NextResponse.json({ ok: true })
}
