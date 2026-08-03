/**
 * lib/costguard/config.ts — THE single server-side Cost Guard configuration.
 *
 * Every budget, threshold and job classification lives here. Numbers are
 * grounded in measured billing (see launch/operations/COST-GUARD.md):
 *   - July 2026 Neon incident: $178.94 total, $138.69 transfer (~1.89 TB).
 *   - August 2026 baseline (measured 2026-08-03): Neon ~3 GB/day transfer,
 *     ~12 CU-hr/day compute → ~$40/mo projected. Vercel on a fixed plan with
 *     ~$0 metered overage. GitHub Actions inside the free tier. R2 within or
 *     near its free tier.
 *
 * Fixed subscription fees are listed separately from variable metered spend —
 * breakers act on VARIABLE spend only, so an unavoidable base fee can never
 * trip a shutdown.
 */

import type { JobClass, ProviderId } from './types'

export interface ProviderBudget {
  /** Fixed monthly subscription fee in USD (informational only). */
  fixedMonthlyUsd: number
  /** Normal expected VARIABLE spend for a month. */
  expectedMonthlyUsd: number
  /** AMBER once the projected month-end variable spend passes this. */
  softBudgetUsd: number
  /** RED once projected variable spend passes this. */
  maxApprovedUsd: number
  /** LOCKDOWN once MTD (not merely projected) variable spend passes this. */
  catastrophicUsd: number
}

export const COSTGUARD_CONFIG = {
  /** Snapshots older than this are 'stale' — stale required data blocks GREEN. */
  freshnessMaxAgeMs: 26 * 60 * 60 * 1000, // 26h: hourly collection + slack

  /** Burn anomaly = today's burn > multiplier × trailing-7-day baseline. */
  anomalyMultiplier: 4,

  /** Consecutive abnormal samples before AMBER escalates to RED. */
  abnormalSamplesForRed: 3,

  /** Consecutive clean samples to de-escalate one level (≈ hours). */
  cleanSamplesToRecover: 6,

  /** Identical alert events are suppressed inside this window. */
  alertDedupeWindowMs: 6 * 60 * 60 * 1000,

  /** Global variable-spend budgets (sum across providers). */
  global: {
    fixedMonthlyUsd: 20,        // Vercel plan fee (Neon Launch bills usage-only today)
    expectedMonthlyUsd: 45,     // ≈ measured Aug 2026 run rate (Neon ~$40 + margin)
    softBudgetUsd: 90,
    maxApprovedUsd: 150,
    catastrophicUsd: 250,       // hard stop well below a July-style $178+ repeat
  } satisfies ProviderBudget,

  providers: {
    neon: {
      fixedMonthlyUsd: 0,
      expectedMonthlyUsd: 45,
      softBudgetUsd: 60,
      maxApprovedUsd: 90,
      catastrophicUsd: 150,
    },
    vercel: {
      fixedMonthlyUsd: 20,
      expectedMonthlyUsd: 5,
      softBudgetUsd: 15,
      maxApprovedUsd: 40,
      catastrophicUsd: 100,     // pair with Vercel Spend Management pause at $100
    },
    github: {
      fixedMonthlyUsd: 0,
      expectedMonthlyUsd: 0,    // inside the 2000 free private-repo minutes
      softBudgetUsd: 5,
      maxApprovedUsd: 10,       // pair with GitHub budget "Stop usage" at $10
      catastrophicUsd: 25,
    },
    cloudflare: {
      fixedMonthlyUsd: 0,
      expectedMonthlyUsd: 2,
      softBudgetUsd: 5,
      maxApprovedUsd: 15,
      catastrophicUsd: 30,
    },
  } satisfies Record<ProviderId, ProviderBudget>,

  /** Provider-metric rate thresholds (per-day), from measured baselines. */
  rates: {
    neonTransferGbPerDay:  { amber: 10, red: 25 },   // baseline ~3; July disaster ~61
    neonComputeCuPerDay:   { amber: 30, red: 60 },   // baseline ~12
    githubMinutesPerDay:   { amber: 45, red: 90 },   // 2000 free/mo ≈ 66/day even
    r2ClassAOpsPerDay:     { amber: 50_000, red: 250_000 },
  },

  /**
   * Job classification. Operation names are the stable ids passed to the gate.
   * 'essential' operations are never gated (customer-facing reads and the
   * /go affiliate redirect are not listed — they never call the gate at all).
   */
  jobs: {
    // Inngest cloud jobs
    'inngest:sync-retailer-scheduled': 'nonessential',
    'inngest:sync-retailer':           'nonessential',
    'inngest:bookshop-refresh':        'nonessential',
    'inngest:price-check':             'deferrable',
    'inngest:enrich-canonical':        'nonessential',
    'inngest:cleanup-stale':           'deferrable',
    'inngest:bookshop-lookup':         'deferrable',  // single user-triggered lookup
    // Founder-machine bulk scripts
    'script:sync-awin-feed':           'high-risk',
    'script:enrich-catalogue-cv':      'high-risk',
    'script:backfill-covers':          'high-risk',
    'script:ingest-cv-series':         'high-risk',
    'script:ingest-issue-covers':      'high-risk',
    'script:migrate-covers':           'high-risk',
  } satisfies Record<string, JobClass>,

  /** Default hard limits enforced by JobBudget when a spec omits its own. */
  defaultLimits: {
    maxRows: 250_000,
    maxRequests: 5_000,
    maxRuntimeMs: 6 * 60 * 60 * 1000, // 6h — the CV enrichment chunks exceed via checkpoint/resume
    statementTimeoutMs: 120_000,
  },
} as const

export type CostGuardConfig = typeof COSTGUARD_CONFIG
