# Pricing automation — handover, 27 November 2026

## Which retailers refresh unattended

| retailer | mechanism | unattended today? | first scheduled run |
|---|---|---|---|
| ebay.co.uk / ebay.com | live Browse API, per shopper request | **yes** | n/a — every page view; verified today |
| travellingman.com | `offer-refresh-verified-offers`, 02:00 UTC | **registered, unproven** | **28 Nov 02:00** — first ever |
| worldofbooks.com | same | **registered, unproven** | **28 Nov 02:00** — first ever |
| waterstones.com | `sync-retailer-scheduled`, hourly | **no — cron paused** | ~28 Nov 13:39, once resumed |
| scholastic.co.uk | same | **no — cron paused** | ~28 Nov 13:42, once resumed |
| letsbuybooks.com | same | **no — cron paused** | ~28 Nov 13:34, once resumed |

**No feed-based retailer has ever refreshed unattended.** Every price on the
site was put there by hand. Two of the six are now registered and will attempt
it tonight; the other three cannot until the hourly cron is resumed.

Today's manual imports pushed each Awin feed's next due time to ~13:35 on
28 Nov, so that is the earliest a genuinely-due hosted import can be observed
for those three.

## Where you will receive alerts

**Working today — GitHub Actions email.** `Retailer monitor` runs every 3 hours
on GitHub's infrastructure, independent of Inngest, and calls
`POST /api/monitor/retailers`. It is red while an incident is open and green
when all sources are fresh or legitimately not due.
→ <https://github.com/pgoldenj-wq/catch-comics-v2/actions/workflows/retailer-monitor.yml>

**Verified, not asserted.** Its first production run correctly reported the
real open incident — *"The hourly price scheduler is not running; the
dispatcher has never recorded a tick"* — and a drill forcing
`scholastic.co.uk` stale produced *"scholastic.co.uk has stopped refreshing →
Run npm run awin:ingest -- scholastic.co.uk --write"*. The drill wrote no
prices and no incident state: Scholastic still shows 18 priced offers last seen
2026-11-27 00:03, and only one `monitor.retailer_health` row exists.

**Once you add the webhook — Slack.** The endpoint already calls the real
notifier. It alerts **only on a transition**: one message when an incident
opens, one when it recovers, nothing in between, so routine runs stay silent.

### What it detects

- **scheduler-missed** — the hourly dispatcher has not ticked for 3h. Checked
  first, so one dead scheduler is not reported as five overdue retailers.
- **retailer-overdue** — one retailer late while the others are fine, which a
  site-wide smoke test cannot see. 6h grace on top of its own interval, because
  GitHub throttles schedules and Inngest ticks drift.
- **coverage-drop** — priced offers fall more than 20% with no single retailer
  looking broken.

## Deployment

The Vercel–Inngest integration **was not registering new functions on deploy**:
PR #54's two functions stayed absent through nine merges until you re-synced by
hand. That no longer matters — `Inngest sync on deploy` now registers the
deployed functions after every successful production deployment, triggered by
`deployment_status` so it never registers a build that is still compiling.

Verified on the very next deployment: `HTTP 200 {"message":"Successfully
registered"}`. It skipped the preview deployment correctly, and registration
cannot resume a paused function, so your deliberate pauses are preserved.

## Owner-only — two clicks

**1. Resume the paused crons.** This is the one blocking unattended pricing.
<https://app.inngest.com/env/production/functions>
→ resume **`sync-retailer-scheduled`** and **`price-check`**.

**2. Add the Slack webhook**, if you want alerts off GitHub email.
<https://vercel.com/pgoldenj-wqs-projects/catch-comics-v2/settings/environment-variables>
→ add `SLACK_WEBHOOK_URL` (Production) → **redeploy**, since a new variable
does not reach an existing deployment.

I handled everything else: the three imports, the monitor, the deploy sync, and
the first-run verification of both workflows.
