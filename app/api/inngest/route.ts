/**
 * POST /api/inngest
 *
 * Inngest webhook handler. Receives events from Inngest's cloud (or local
 * Dev Server during development) and dispatches them to the correct function.
 *
 * All registered functions are imported here. Adding a new function:
 *   1. Create it in lib/inngest/functions/
 *   2. Export it from lib/inngest/index.ts
 *   3. Add it to the `functions` array below
 *
 * Local dev:
 *   Run both:
 *     npm run dev
 *     npx @inngest/cli@latest dev -u http://localhost:3000/api/inngest
 *   Then visit http://localhost:8288 to trigger functions manually.
 *
 * Production:
 *   Set INNGEST_EVENT_KEY and INNGEST_SIGNING_KEY in Vercel env vars.
 *   Register this URL in the Inngest dashboard: https://app.inngest.com
 */

import { serve }           from 'inngest/next'
import { inngest }         from '@/lib/inngest/client'
import {
  syncRetailer,
  syncScheduled,
  enrichCanonical,
  cleanupStale,
  priceCheck,
  onFailure,
  bookshopLookup,
  bookshopRefresh,
}                          from '@/lib/inngest'

export const { GET, POST, PUT } = serve({
  client:    inngest,
  functions: [
    syncRetailer,
    syncScheduled,
    enrichCanonical,
    cleanupStale,
    priceCheck,
    onFailure,
    bookshopLookup,
    bookshopRefresh,
  ],
})
