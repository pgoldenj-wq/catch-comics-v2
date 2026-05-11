/**
 * Sync dispatcher — routes a sync job to the correct platform adapter.
 *
 * Called by:
 *   - lib/inngest/functions/sync-retailer.ts  (background job)
 *   - app/api/admin/retailers/[id]/sync/route.ts  (manual "Sync now")
 *
 * Both paths create/update a SyncLog row before/after calling here.
 * This function only calls the adapter — it does not touch SyncLog directly.
 */

import { prisma }              from '@/lib/prisma'
import { ShopifyAdapter }      from '@/lib/adapters/shopify'
import { BigCommerceAdapter }  from '@/lib/adapters/bigcommerce'
import { WooCommerceAdapter }  from '@/lib/adapters/woocommerce'
import type { SyncResult }     from '@/lib/adapters/shared/matching'

// Platforms we skip in the scheduled cron (eBay is queried live; MANUAL is hand-entry).
export const SKIP_PLATFORMS = new Set(['EBAY', 'MANUAL'])

// Default refresh interval in hours, by platform.
export const DEFAULT_REFRESH_HOURS: Record<string, number> = {
  SHOPIFY:          6,
  BIGCOMMERCE:      6,
  WOOCOMMERCE:      6,
  AWIN_FEED:       24,
  CJ_FEED:         24,
  DIRECT_AFFILIATE:24,
}

/**
 * Run a full sync for a retailer and return the result.
 * Throws on unrecognised platform — let the caller handle it.
 */
export async function dispatchSync(retailerId: string): Promise<SyncResult> {
  const retailer = await prisma.retailer.findUniqueOrThrow({ where: { id: retailerId } })

  switch (retailer.platform) {
    case 'SHOPIFY': {
      const adapter = new ShopifyAdapter()
      return adapter.syncRetailer(retailerId)
    }

    case 'BIGCOMMERCE': {
      const adapter = new BigCommerceAdapter()
      return adapter.syncRetailer(retailerId)
    }

    case 'WOOCOMMERCE': {
      const adapter = new WooCommerceAdapter()
      return adapter.syncRetailer(retailerId)
    }

    case 'AWIN_FEED':
    case 'CJ_FEED':
    case 'DIRECT_AFFILIATE':
      throw new Error(
        `Feed adapter for ${retailer.platform} not yet implemented for ${retailer.domain}.`,
      )

    case 'EBAY':
    case 'MANUAL':
      throw new Error(
        `Platform ${retailer.platform} does not support scheduled sync — ` +
        `filter these out in the scheduler before calling dispatchSync.`,
      )

    default:
      throw new Error(`Unknown platform "${retailer.platform}" for retailer ${retailer.domain}`)
  }
}

/**
 * How many hours between syncs for this retailer.
 * Uses syncConfig.refreshIntervalHours if set, otherwise platform default.
 */
export function refreshIntervalHours(syncConfig: unknown, platform: string): number {
  if (
    syncConfig &&
    typeof syncConfig === 'object' &&
    'refreshIntervalHours' in syncConfig &&
    typeof (syncConfig as Record<string, unknown>).refreshIntervalHours === 'number'
  ) {
    return (syncConfig as { refreshIntervalHours: number }).refreshIntervalHours
  }
  return DEFAULT_REFRESH_HOURS[platform] ?? 24
}
