# Launch Runbook — Sunday 26 July 2026

Rollback tag if everything burns: `PRE-MONSTER-MODE-LAUNCH-STABLE-2026-07-03` · current known-good: merge `d9bc69b` (Wave 1+2). See [rollback-guide.md](rollback-guide.md).

## T-minus 3 days (Thu 23 July)

- [ ] `git log origin/main -1` matches the deployed commit (`npx vercel ls catch-comics-v2` → latest Production Ready)
- [ ] `npm run launch:health` — read the Amazon block. **Deadline: all 321 Amazon offers auto-hide by 26 July.** Decision made? (resync = ~321 paid Rainforest calls via `scripts/enrich-amazon-bulk.ts` + key; or accept they disappear)
- [ ] `npm run launch:smoke` — PASS
- [ ] Mission Control: no red, ops checklist honest, countdown correct
- [ ] Smoke Test V4: Homepage, Search, Product, Affiliate, Mobile pages green (includes the new Wave-3 checks)
- [ ] **Physical phone**: product-page issue grid (covers or honest #N tiles, taps OK)
- [ ] Live homepage rail eyeball: recognisable series, no repeats > 2 per franchise, no awkward titles
- [ ] /privacy, /terms, /affiliate-disclosure, /about load
- [ ] GitHub security toggles + Vercel spend notifications ON ([founder-account-actions.md](founder-account-actions.md))
- [ ] Social card: paste catchcomics.com into Discord — og-image renders
- [ ] Launch posts drafted with FINAL URLs (marketing calendar is plan-of-record)

## Launch day (Sun 26 July)

**Before announcing (morning):**
1. `npm run launch:smoke` — must PASS. Any FAIL = do not announce; see [incident-response.md](incident-response.md).
2. `npm run launch:health` — stale % sane, WoB lastSeen = today or yesterday.
3. Open the homepage + one product page + one series page yourself, on phone and desktop.
4. Check Vercel dashboard: last deploy Ready, no error spike overnight.

**Immediately after announcing:**
- Keep Mission Control + Vercel Analytics open.
- Watch the first real search queries work (try 2–3 yourself).

**+30 minutes:**
- Click one affiliate link end-to-end (lands on retailer, awin1.com hop correct).
- Check social posts: share cards rendering, links right.
- Skim Vercel logs for 5xx or 429 storms.

**+2 hours:**
- `npm run launch:smoke` again.
- Vercel usage graph: function invocations shaped like traffic, not like a bot flood.
- hello@catchcomics.com inbox: any wrong-data reports? (Trust reports beat everything else in the queue.)

**End of day:**
- `npm run launch:health` — record the day-one numbers (deltas start meaning something).
- Note top search queries worth adding to the catalogue/series registry.
- Sleep. The limiter, honest empty states and stale-hiding work while you don't.

## First seven days (10 min/morning + [daily-operations-checklist.md](daily-operations-checklist.md))

Daily: `launch:smoke` (or check the GitHub Action email), `launch:health` deltas (stale% ↑? priced ↓? suspect ↑?), Vercel usage vs yesterday, inbox trust reports, one flagship page eyeball.
Rollback threshold: any incident from [incident-response.md](incident-response.md) that damages price/cover/affiliate trust and can't be contained within ~1 hour → roll back first, debug after.
