# Catch Cost Guard — runbook

Permanent multi-provider cost monitoring, circuit breakers and hard-spend
protection. Built 2026-08-03 after the July Neon incident ($178.94, of which
$138.69 was ~1.89 TB of public network transfer from an ungated hourly sync).

**Principle: enforcement, not display.** The system refuses nonessential
work when spend misbehaves. The customer-facing site is never taken down by
Cost Guard itself — only the provider-native catastrophic pause (which you
configure deliberately, below) can do that.

---

## Where things live

| Piece | Location |
|---|---|
| Config (ALL budgets/thresholds) | `lib/costguard/config.ts` |
| State machine | `lib/costguard/engine.ts` |
| Job gate + runtime budgets | `lib/costguard/gate.ts` (+ `lib/costguard/inngest.ts`) |
| Provider adapters | `lib/costguard/providers/*.ts` |
| State/snapshots/events store | Vercel KV (`costguard:*` keys); local fallback `.costguard-state/` |
| Collection endpoint | `POST /api/costguard/collect` (bearer `COSTGUARD_CRON_SECRET`) |
| State endpoint | `GET /api/costguard/state` (bearer or admin cookie) |
| Vercel spend webhook | `POST /api/costguard/vercel-webhook` (no secret in the URL; HMAC-SHA1 `x-vercel-signature` required) |
| Hourly check + PR scan | `.github/workflows/cost-guard.yml` |
| Mission Control panel | `launch/mission-control.html` ← `launch/operations/costguard-latest.json` |
| CLI | `npm run costguard:collect` / `costguard:status` / `costguard:clear` |
| Tests | `npm run test:costguard` (simulations, no network) |
| CI hazard scan | `npm run check:cost-hazards` |

## States and what they do

| State | Trigger (examples) | Automatic action |
|---|---|---|
| GREEN | spend + burn normal, telemetry fresh | everything runs within its own limits |
| AMBER | projected > soft budget; anomaly vs baseline; stale/missing provider data | notify; bulk jobs must declare explicit limits or they are refused; public reads unaffected |
| RED | projected > approved max; sustained rate breach (e.g. Neon >25 GB/day); 3 consecutive abnormal samples; provider near budget | nonessential + high-risk jobs REFUSED (hourly retailer syncs, enrichment, backfills, bulk refreshes); deferrable + essential still run; every refusal recorded |
| LOCKDOWN | MTD > catastrophic limit; Vercel Spend Management ≥100%; verified runaway | only essential operations run; read-only dry-runs/reports stay available; latch requires founder action to clear |

Recovery: de-escalation needs 6 consecutive clean hourly samples per level.
LOCKDOWN never auto-clears:

```bash
npm run costguard:clear -- --confirm CLEAR
```

drops it to RED; hysteresis walks it down from there.

## Budgets (edit only in `lib/costguard/config.ts`)

Variable metered spend only — fixed plan fees are reported but can never
trip a breaker.

| Scope | Expected | Soft (AMBER) | Max (RED) | Catastrophic (LOCKDOWN) |
|---|---|---|---|---|
| Global | $45 | $90 | $150 | $250 |
| Neon | $45 | $60 | $90 | $150 |
| Vercel (metered) | $5 | $15 | $40 | $100 |
| GitHub | $0 | $5 | $10 | $25 |
| Cloudflare | $2 | $5 | $15 | $30 |

Rates: Neon transfer AMBER >10 GB/day, RED >25 GB/day (baseline ~3; July
disaster ~61). Neon compute AMBER >30 CU-hr/day, RED >60 (baseline ~12).

## Adding a new bulk job

Every new scheduled/bulk process MUST call the gate before any work:

```ts
import { assertJobAllowed } from '../lib/costguard/gate'
const budget = await assertJobAllowed({
  operation: 'script:my-new-job', jobClass: 'high-risk',
  estRows: 5_000, estRequests: 1_000, maxRuntimeMs: 60 * 60_000, write: true,
})
// in loops: budget.countRow() / budget.countRequest() — throws at the ceiling
```

The PR workflow runs `check-cost-hazards.mjs`, which flags unbounded
`findMany` on hot models in request paths (hard fail) and ungated bulk-write
scripts (warning). Suppress a deliberate exception with
`// costguard-allow: <reason>` on the line above.

---

## Secrets — two DIFFERENT values, never in a URL

| Variable | Where it comes from | Used for |
|---|---|---|
| `COSTGUARD_CRON_SECRET` | **you generate it** (`openssl rand -hex 32`) | bearer auth on `POST /api/costguard/collect`; must be identical in Vercel env AND the GitHub Actions repo secret |
| `COSTGUARD_WEBHOOK_SECRET` | **Vercel generates it** and shows it once when you save the Spend Management webhook | verifying the `x-vercel-signature` HMAC on each delivery |
| `VERCEL_TEAM_ID` | Vercel → Team Settings → General (not a secret) | rejecting deliveries from another team (403) |

Rules:
- **The webhook URL contains no secret**: `https://www.catchcomics.com/api/costguard/vercel-webhook`.
- **Never reuse the webhook signing secret as the cron secret** (different trust domains, different rotation).
- Neither secret may be shared, logged, committed, or pasted into a URL/query string.
- If `COSTGUARD_WEBHOOK_SECRET` is absent the endpoint returns 503 and processes nothing — it fails **closed**. An unsigned event is never valid.

### Webhook setup order (matters)

1. Generate `COSTGUARD_CRON_SECRET` yourself; put it in Vercel env + the GitHub Actions secret.
2. In Vercel → Team Settings → Billing → Spend Management, add the webhook with the bare URL above.
3. Vercel shows a **signing secret** on save — copy it.
4. Put that copied value in Vercel env as `COSTGUARD_WEBHOOK_SECRET`, add `VERCEL_TEAM_ID`, then redeploy.

## Manual actions (founder) — provider credentials and native hard caps

Cost Guard enforces with whatever telemetry exists and treats missing
telemetry as AMBER, never GREEN. To light up each provider, and to arm the
provider-native backstops, see the **"Do this now"** section in the PR /
final report. Summary of what each control truly is:

| Provider | Native control | Is it a true hard cap? |
|---|---|---|
| Neon | Spending **notifications** (org Billing page) | **No** — email alert only; Cost Guard's RED/LOCKDOWN is the enforcement |
| Vercel | Spend Management: alerts + webhook + **auto-pause project** at limit | **Yes** for compute/functions when "Pause production deployment" is enabled — the site goes down at the cap; already-incurred usage is still billed |
| GitHub | Budget with **"Stop usage when limit reached"** for Actions | **Yes** for paid Actions minutes (free included minutes unaffected) |
| Cloudflare | Notifications only for R2 usage | **No** — alert only; Cost Guard rate-detects Class A surges |

**What visitors see if the Vercel catastrophic pause fires:** the site
returns errors (paused deployment) until you raise/remove the limit in
Vercel → Settings → Billing → Spend Management and redeploy. That is the
deliberate last resort at $100 — everything before it (AMBER/RED/LOCKDOWN)
protects spend while keeping reads alive.

## Incident checklist

1. Open Mission Control → Cost Guard panel (or `npm run costguard:status`).
2. Read the reasons + events — every automatic block records trigger,
   measured value, threshold, action, timestamp.
3. Check the driving provider's own dashboard for ground truth.
4. Fix the runaway (disable the retailer, kill the script, revert the deploy).
5. Watch recovery: RED → AMBER → GREEN needs 6 clean samples per step.
6. If LOCKDOWN: `npm run costguard:clear -- --confirm CLEAR` **after** the
   cause is contained — clearing without fixing re-latches on the next cycle.
