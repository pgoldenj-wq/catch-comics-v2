/**
 * Inngest functions barrel — export all functions as a single array
 * for use in app/api/inngest/route.ts serve().
 */

export { syncRetailer }    from './functions/sync-retailer'
export { syncScheduled }   from './functions/sync-scheduled'
export { enrichCanonical } from './functions/enrich-canonical'
export { cleanupStale }    from './functions/cleanup-stale'
export { priceCheck }      from './functions/price-check'
export { onFailure }        from './functions/on-failure'
