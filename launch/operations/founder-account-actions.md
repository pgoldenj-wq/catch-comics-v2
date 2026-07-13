# Founder Account Actions — settings only Joe can flip

These cannot be changed from this repo or CLI with available tooling (verified 2026-07-13: no `gh` CLI installed; Vercel spend/security settings are dashboard-only). Each is ~2 minutes. All four are tracked as unticked items in Mission Control's Launch-ops checklist.

## GitHub — https://github.com/pgoldenj-wq/catch-comics-v2/settings/security_analysis

1. **Secret scanning** → Enable
2. **Push protection** → Enable (blocks pushes containing detected secrets)
3. **Dependabot alerts** → Enable
4. **Dependabot security updates** → Enable

Why: `.env.local` holds Neon/eBay/AWIN/CV/R2 credentials; scanning + push protection is the safety net if one ever leaks into a commit. Nothing here changes repo visibility.

## Vercel — https://vercel.com/pgoldenj-wqs-projects → Settings → Billing

5. **Spend Management → notifications**: set an alert threshold at roughly 2× your normal monthly spend (check the Usage tab for the current number first — pick from data, not from a guess).
   ⚠ Choose **notify**, not the auto-pause action — auto-pause takes production down when tripped, which is worse than a bill during launch week.
6. **Usage → enable usage alerts** (email at 75%/100% of included allowances) if shown for your plan.

## Keep as-is (deliberate)

- **Preview deployment protection (SSO): ON.** Slightly inconvenient for automation; correct for security.
- Repo visibility: unchanged.
- `RATE_LIMIT_DISABLED` env: unset (limiter active). It's the kill switch, not a tuning knob.

When all six are done, tick "GitHub security" and "Vercel spend" in Mission Control.
