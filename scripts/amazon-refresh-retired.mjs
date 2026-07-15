#!/usr/bin/env node
/**
 * amazon-refresh-retired.mjs — deliberate refusal stub.
 *
 * The Rainforest integration was retired on 2026-07-13 (founder decision;
 * account closed, key deleted). There is NO live Amazon price refresh.
 * This stub exists so `npm run enrich:amazon` fails loudly and honestly
 * instead of silently no-opping or appearing runnable.
 */
console.error(`
──────────────────────────────────────────────────────────────
  Amazon refresh is UNAVAILABLE — Rainforest was retired on
  2026-07-13 and the account is closed. Do not restore it.

  Current Amazon posture: AFFILIATE-ONLY / STORED OFFERS.
  Stored Amazon listings age out honestly under the 30-day
  freshness rules; affiliate links keep working via /go.

  Status report : npm run amazon:status
  Strategy      : launch/operations/amazon-post-rainforest-plan.md
  Future route  : Amazon Creators API once eligible
                  (10 qualifying sales in trailing 30 days).
──────────────────────────────────────────────────────────────
`)
process.exit(1)
