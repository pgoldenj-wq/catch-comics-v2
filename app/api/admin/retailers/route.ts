/**
 * POST /api/admin/retailers — create a new retailer
 * Optionally enqueues a sync immediately (syncNow: true).
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma }                    from '@/lib/prisma'
import { RetailerPlatform }          from '@prisma/client'
import { ShopifyAdapter }            from '@/lib/adapters/shopify'

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    name             : string
    domain           : string
    platform         : string
    countryCode      : string
    currency         : string
    affiliateNetwork : string | null
    affiliateId      : string | null
    trustScore       : number
    syncNow          : boolean
  }

  const { name, domain, platform, countryCode, currency,
          affiliateNetwork, affiliateId, trustScore, syncNow } = body

  // Validate platform
  const validPlatforms: string[] = Object.values(RetailerPlatform)
  if (!validPlatforms.includes(platform)) {
    return NextResponse.json({ error: `Invalid platform: ${platform}` }, { status: 400 })
  }

  // Check domain uniqueness
  const existing = await prisma.retailer.findUnique({ where: { domain } })
  if (existing) {
    return NextResponse.json({ error: `A retailer with domain ${domain} already exists.` }, { status: 409 })
  }

  const retailer = await prisma.retailer.create({
    data: {
      name,
      domain,
      platform      : platform as RetailerPlatform,
      countryCode,
      currency,
      affiliateNetwork : affiliateNetwork ?? null,
      affiliateId      : affiliateId ?? null,
      trustScore,
      isActive  : true,
      syncConfig: {},
    },
  })

  if (syncNow && platform === 'SHOPIFY') {
    // Fire sync in background (don't await — client gets the id immediately)
    const adapter = new ShopifyAdapter()
    void (async () => {
      const log = await prisma.syncLog.create({
        data: { retailerId: retailer.id, status: 'running', startedAt: new Date() },
      })
      try {
        const result = await adapter.syncRetailer(retailer.id)
        await prisma.syncLog.update({
          where: { id: log.id },
          data: {
            status:          result.errors.length > 0 ? 'error' : 'success',
            finishedAt:      new Date(),
            productsFetched: result.productsFetched,
            listingsCreated: result.listingsCreated,
            listingsUpdated: result.listingsUpdated,
            priceChanges:    result.priceChanges,
            errorCount:      result.errors.length,
            errorSummary:    result.errors.length > 0
              ? result.errors.slice(0, 3).map(e => e.message).join(' | ')
              : null,
          },
        })
      } catch (err) {
        await prisma.syncLog.update({
          where: { id: log.id },
          data: {
            status:       'error',
            finishedAt:   new Date(),
            errorCount:   1,
            errorSummary: err instanceof Error ? err.message : String(err),
          },
        })
      }
    })()
  }

  return NextResponse.json({ id: retailer.id }, { status: 201 })
}
