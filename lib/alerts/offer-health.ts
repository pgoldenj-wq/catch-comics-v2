/**
 * offer-health.ts — the three alarms that would have caught blocker B4.
 *
 * Deliberately a PURE function of a snapshot, with no database and no network,
 * so the alarms can be demonstrated against forced inputs instead of only
 * being trusted to fire someday. lib/inngest/functions/offer-health-check.ts
 * gathers the snapshot; this decides what is wrong.
 *
 * What B4 actually was: the last refresh ran on 2026-09-26, nothing ran again,
 * cleanup-stale expired every row thirty days later, and the site served zero
 * prices for a month without a single warning. Each alarm below closes one
 * link in that chain.
 */
import type { Alert } from './notify'

/** cleanup-stale soft-deletes anything unseen for this many days. */
export const SOFT_DELETE_POLICY_DAYS = 30

/** A daily job that has not succeeded in this long has missed a run. */
export const STALL_HOURS = 36

/** Warn once the oldest active offer comes this close to the sweep. */
export const EXPIRY_WARN_DAYS = 7

/** Coverage falling to this fraction of the previous reading is a warning. */
export const COVERAGE_FALL_RATIO = 0.5

export interface OfferHealthInput {
  now: Date
  /** Active listings with a real price. */
  pricedListings: number
  /** Distinct canonical products with a real price. */
  pricedProducts: number
  /** Canonical products priced at two or more independent retailers. */
  productsAtTwoRetailers: number
  /** From the previous health check, or null on the first ever run. */
  previousPricedListings: number | null
  /** Last SUCCESSFUL offer refresh, or null if one has never succeeded. */
  lastSuccessfulRefreshAt: Date | null
  /** lastSeenAt of the active priced offer closest to expiry. */
  oldestActiveLastSeenAt: Date | null
}

export interface OfferHealthVerdict {
  alerts: Alert[]
  /** Days until the closest-to-expiry offer is swept, or null when none. */
  daysToExpiry: number | null
  hoursSinceRefresh: number | null
}

const HOUR = 3_600_000
const DAY  = 86_400_000

export function evaluateOfferHealth(i: OfferHealthInput): OfferHealthVerdict {
  const alerts: Alert[] = []

  const hoursSinceRefresh = i.lastSuccessfulRefreshAt === null
    ? null
    : (i.now.getTime() - i.lastSuccessfulRefreshAt.getTime()) / HOUR

  const daysToExpiry = i.oldestActiveLastSeenAt === null
    ? null
    : SOFT_DELETE_POLICY_DAYS - (i.now.getTime() - i.oldestActiveLastSeenAt.getTime()) / DAY

  // ── 1. Stalled refresh ────────────────────────────────────────────────────
  // The direct cause of B4: the refresh simply stopped happening, and nothing
  // was watching for its absence.
  if (hoursSinceRefresh === null) {
    alerts.push({
      key: 'offer-refresh-never-succeeded',
      severity: 'critical',
      title: 'Offer refresh has never completed successfully',
      details: ['no successful offer_refresh.verified_offers run on record'],
      action: 'Confirm the Inngest function is registered and its cron is firing.',
    })
  } else if (hoursSinceRefresh > STALL_HOURS) {
    alerts.push({
      key: 'offer-refresh-stalled',
      severity: 'critical',
      title: 'Offer refresh has stalled',
      details: [
        `last success ${hoursSinceRefresh.toFixed(1)}h ago (threshold ${STALL_HOURS}h)`,
        daysToExpiry === null
          ? 'no active priced offers to expire'
          : `offers start expiring in ${daysToExpiry.toFixed(1)} days`,
      ],
      action: 'Check the Inngest run history before the 30-day sweep removes the offers.',
    })
  }

  // ── 2. Coverage at zero, or falling ───────────────────────────────────────
  // The symptom a visitor sees. Zero priced listings is the B4 end state.
  if (i.pricedListings === 0) {
    alerts.push({
      key: 'priced-coverage-zero',
      severity: 'critical',
      title: 'No priced offers on the site',
      details: [
        'priced listings 0',
        i.previousPricedListings === null
          ? 'no previous reading'
          : `previous reading ${i.previousPricedListings}`,
      ],
      action: 'The recovery pass in offer_refresh should restore verified offers on its next run.',
    })
  } else if (
    i.previousPricedListings !== null &&
    i.previousPricedListings > 0 &&
    i.pricedListings < i.previousPricedListings * COVERAGE_FALL_RATIO
  ) {
    const pct = ((1 - i.pricedListings / i.previousPricedListings) * 100).toFixed(0)
    alerts.push({
      key: 'priced-coverage-falling',
      severity: 'warning',
      title: 'Priced coverage is falling',
      details: [
        `priced listings ${i.pricedListings}, down ${pct}% from ${i.previousPricedListings}`,
        `priced products ${i.pricedProducts} · products at 2+ retailers ${i.productsAtTwoRetailers}`,
      ],
      action: 'Check whether a retailer stopped responding or went fully out of stock.',
    })
  }

  // ── 3. Approaching expiry ─────────────────────────────────────────────────
  // The last chance to act before the sweep. B4 had no such warning: the rows
  // went from fine to gone in one 03:00 transaction.
  if (daysToExpiry !== null && daysToExpiry <= EXPIRY_WARN_DAYS) {
    alerts.push({
      key: 'offers-approaching-expiry',
      severity: daysToExpiry <= 2 ? 'critical' : 'warning',
      title: 'Offers are approaching the 30-day sweep',
      details: [
        `oldest active offer last seen ${(SOFT_DELETE_POLICY_DAYS - daysToExpiry).toFixed(1)} days ago`,
        `${daysToExpiry.toFixed(1)} days until cleanup-stale soft-deletes it`,
        `${i.pricedListings} priced listings at risk`,
      ],
      action: 'A successful offer refresh resets this. If it is not running, that is the problem.',
    })
  }

  return { alerts, daysToExpiry, hoursSinceRefresh }
}
