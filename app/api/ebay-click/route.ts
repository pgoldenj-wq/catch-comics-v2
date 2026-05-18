/**
 * POST /api/ebay-click
 *
 * Lightweight eBay marketplace click logger.
 *
 * eBay listings are ephemeral (items sell, prices change) so they cannot be
 * stored as retailer_listings rows with stable UUIDs. The /go/[id] route
 * requires a DB-backed listing FK — unsuitable for live eBay results.
 *
 * Instead this route:
 *   1. Validates the payload
 *   2. Logs a structured event to stdout (captured by Vercel log drain / console)
 *   3. Returns 200 immediately
 *
 * The EPN campid on the outbound URL handles revenue attribution independently.
 * This endpoint handles analytics attribution (which canonical product → which
 * eBay listing → which click).
 *
 * Payload shape:
 *   { itemId, canonicalProductId, title, price, currency, condition }
 */

import { NextRequest, NextResponse } from 'next/server'

interface EbayClickPayload {
  itemId:             string
  canonicalProductId: string
  title:              string
  price:              number
  currency:           string
  condition:          string
}

export const runtime = 'edge' // Lightweight — no DB, no Buffer needed

export async function POST(req: NextRequest) {
  let payload: Partial<EbayClickPayload>
  try {
    payload = await req.json() as Partial<EbayClickPayload>
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 })
  }

  const { itemId, canonicalProductId, title, price, currency, condition } = payload

  if (!itemId || !canonicalProductId) {
    return NextResponse.json({ ok: false, error: 'itemId and canonicalProductId required' }, { status: 400 })
  }

  // Structured log — captured by Vercel Log Drain, Datadog, etc.
  console.log(JSON.stringify({
    event:     'ebay_click',
    itemId,
    canonicalProductId,
    title:     title   ?? '',
    price:     price   ?? 0,
    currency:  currency ?? 'GBP',
    condition: condition ?? '',
    userAgent: req.headers.get('user-agent') ?? '',
    referer:   req.headers.get('referer')   ?? '',
    ts:        new Date().toISOString(),
  }))

  return NextResponse.json({ ok: true })
}
