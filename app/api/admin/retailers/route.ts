/**
 * POST /api/admin/retailers — create a new retailer
 * Optionally enqueues a sync immediately (syncNow: true).
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma }                    from '@/lib/prisma'
import { RetailerPlatform }          from '@prisma/client'
import { inngest }                   from '@/lib/inngest/client'

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

  // Platforms that support automated sync via Inngest
  const SYNCABLE_PLATFORMS = ['SHOPIFY', 'BIGCOMMERCE', 'WOOCOMMERCE', 'AWIN_FEED']

  if (syncNow && SYNCABLE_PLATFORMS.includes(platform)) {
    // Enqueue via Inngest so the sync runs in the background with retries.
    // Fire-and-forget — the response returns immediately with the retailer id.
    void inngest.send({
      name: 'sync/retailer',
      data: { retailerId: retailer.id },
    }).catch(err => {
      console.error('[admin/retailers] failed to enqueue sync for', retailer.id, err)
    })
  }

  return NextResponse.json({ id: retailer.id }, { status: 201 })
}
