# Monitoring & Alerts — what watches what

## Automated (no founder effort)

| Watcher | Cadence | Covers | Alerts via |
|---|---|---|---|
| GitHub Action `launch-smoke.yml` | Daily 08:00 UTC + manual | 20 public prod checks: routes, copy honesty, API shapes, headers, /go, og-image, 404s | **GitHub failure email** (the only push alert we have — keep notifications on) |
| Vercel deploy status | Every push | Build failures never reach prod | Vercel email |
| KV rate limiter | Continuous | eBay/CV quota abuse on public APIs (price-hint 120/min · comic 200/min · ebay 40/min · search · autocomplete) | Silent by design — visible as 429s in Vercel logs |
| CSP report-only | Continuous | Would-be CSP violations | `/api/csp-report` → Vercel logs |

## Manual commands (founder-run)

| Command | What it proves | When |
|---|---|---|
| `npm run launch:smoke` | Public production surface healthy | Launch day, after deploys, when worried |
| `npm run launch:health` | Data/trust state + deltas + Amazon deadline | Daily launch week, weekly after |
| `npm run enrich:catalogue:report` | Enrichment job status (read-only) | Weekly |
| Smoke Test V4 | Human-judgement checks automation can't make | Before launch, after big changes |

## Explicitly NOT monitored (known gaps, post-launch candidates)

- **Real-time error alerting** (Sentry-class). Today: Vercel logs are pull-only. Cheapest upgrade: Vercel Log Drains or Sentry free tier.
- **Uptime pinger** (the daily smoke is once a day). Cheapest upgrade: UptimeRobot free on `/` — 5-min checks, email alerts.
- **Click-through/revenue anomalies** — AWIN dashboard is the source of truth; check it weekly.
- Smoke runs add one `/go` click/day (UA `cc-launch-smoke/1`) — exclude that UA when reading click analytics.

## Honesty rules for all panels

Mission Control renders **only** what the generated JSON files contain, with timestamps; a missing/old file shows "unavailable/stale — re-run", never green. The smoke script exits non-zero on material failure — a crashed fetch is a FAIL, not a skip.
