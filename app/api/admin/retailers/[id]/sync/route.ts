/**
 * POST /api/admin/retailers/:id/sync
 *
 * Runs a full sync for the retailer synchronously and returns the result.
 * Creates a SyncLog entry before calling the adapter, updates it on completion.
 *
 * Note: for large catalogs this can take several minutes. The caller should
 * handle a long timeout (or switch to a background job queue later).
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma }                    from '@/lib/prisma'
import { ShopifyAdapter }            from '@/lib/adapters/shopify'

type Ctx = { params: Promise<{ id: string }> }

export async function POST(_req: NextRequest, { params }: Ctx) {
  const { id } = await params

  const retailer = await prisma.retailer.findUnique({ where: { id } })
  if (!retailer) {
    return NextResponse.json({ error: 'Retailer not found' }, { status: 404 })
  }

  if (retailer.platform !== 'SHOPIFY') {
    return NextResponse.json(
      { error: `Manual sync is only supported for SHOPIFY retailers. This retailer is ${retailer.platform}.` },
      { status: 400 },
    )
  }

  // Create a running log entry
  const log = await prisma.syncLog.create({
    data: { retailerId: id, status: 'running', startedAt: new Date() },
  })

  try {
    const adapter = new ShopifyAdapter()
    const result  = await adapter.syncRetailer(id)

    // Update log with results
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
          ? result.errors.slice(0, 5).map(e => `[${e.type}] ${e.message}`).join('\n')
          : null,
      },
    })

    return NextResponse.json({
      ok: true,
      summary: {
        productsFetched: result.productsFetched,
        listingsCreated: result.listingsCreated,
        listingsUpdated: result.listingsUpdated,
        priceChanges   : result.priceChanges,
        errors         : result.errors.length,
        durationMs     : result.durationMs,
      },
    })

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)

    await prisma.syncLog.update({
      where: { id: log.id },
      data: {
        status      : 'error',
        finishedAt  : new Date(),
        errorCount  : 1,
        errorSummary: message,
      },
    })

    return NextResponse.json({ error: message }, { status: 500 })
  }
}
