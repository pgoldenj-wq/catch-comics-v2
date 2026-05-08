# 🚀 Deployment Checklist

> Every push to `main` goes live immediately on `www.catchcomics.com`. No second chances.

---

## 🗺 Deployment Architecture

```
Your machine (localhost:3000)
        ↓  git push origin dev
GitHub: dev branch
        ↓  auto-deploys
Vercel: Preview URL (catch-comics-v2.vercel.app/dev)
        ↓  merge dev → main (when ready)
Vercel: Production (www.catchcomics.com)
```

| Branch | URL | When to push |
|---|---|---|
| `dev` | Vercel preview (auto URL) | After every verified local change |
| `main` | `www.catchcomics.com` | Only after full preview verification |

---

## ✅ Pre-Deploy Checklist (before pushing to `dev`)

```
[ ] npm run check passes — zero TypeScript errors
[ ] Tested on localhost:3000 — feature works end-to-end
[ ] No console errors in browser DevTools
[ ] Both UK and US market tested (if prices/eBay involved)
[ ] No hardcoded test data, debug logs, or TODO comments in changed files
[ ] No .env.local values accidentally included in code
[ ] git status is clean — only intended files changed
[ ] Commit message is clear and specific
```

---

## ✅ Pre-Production Checklist (before merging dev → main)

```
[ ] Everything in Pre-Deploy Checklist above ✓
[ ] Verified on Vercel dev preview URL (not just localhost)
[ ] Tested on mobile width (375px viewport) if UI changed
[ ] No new env vars added without adding them to Vercel dashboard first
[ ] Checked Vercel build log on dev branch — no warnings
[ ] git log --oneline dev ^main — reviewed every commit that will ship
[ ] If eBay category/API changed: tested with 3+ different search queries
[ ] If price-hint changed: confirmed "From £X" matches detail page price
```

---

## 🚢 Deploy to Staging (dev branch)

```bash
# 1. Verify you're on dev branch
git branch

# 2. Stage and commit
git add .
git commit -m "feat: your change description"

# 3. Push to dev (triggers Vercel preview build automatically)
git push origin dev

# 4. Wait ~60 seconds, then open Vercel dashboard
# Vercel → catch-comics-v2 → Deployments → find dev branch build

# 5. Click the preview URL → test your changes
```

---

## 🌐 Deploy to Production (main branch)

```bash
# Option A: Via GitHub (recommended)
# Go to GitHub → Pull Requests → New PR (dev → main) → Merge

# Option B: Via git directly
git checkout main
git pull origin main              # get latest
git merge dev --no-ff -m "release: describe what's shipping"
git push origin main              # triggers production build

# 3. Watch Vercel dashboard — build takes ~30–60 seconds
# 4. Open www.catchcomics.com — verify the change is live
# 5. Switch back to dev for next feature
git checkout dev
```

> ⚠️ Once pushed to `main`, it's live. Vercel builds and deploys automatically.

---

## 🔑 Env Vars Management

### Required vars (must be set in Vercel dashboard AND .env.local)

| Variable | Purpose |
|---|---|
| `COMIC_VINE_API_KEY` | Comic Vine API authentication |
| `EBAY_CLIENT_ID` | eBay OAuth client ID |
| `EBAY_CLIENT_SECRET` | eBay OAuth client secret |
| `EBAY_MARKETPLACE_ID_UK` | `EBAY_GB` |
| `EBAY_MARKETPLACE_ID_US` | `EBAY_US` |

### Adding a new env var

1. Add to `.env.local` (local dev — never commit this file)
2. Go to Vercel dashboard → `catch-comics-v2` → Settings → Environment Variables
3. Add for both **Production** and **Preview** environments
4. Redeploy if you added it after the last build

### Check env vars are loaded

```bash
# Hit the prices API — it returns env debug info
curl "http://localhost:3000/api/prices?q=test&region=uk"
# Look for: "hasClientId": true, "hasClientSecret": true
```

---

## 🏗 Vercel Dashboard Reference

| Location | What's there |
|---|---|
| Vercel → `catch-comics-v2` → Deployments | All builds, current status |
| Vercel → Deployments → Functions | API route logs (console.log output) |
| Vercel → Settings → Domains | `www.catchcomics.com` and `catchcomics.com` |
| Vercel → Settings → Environment Variables | All env vars |
| Vercel → Analytics | Traffic, errors |

**Project:** `catch-comics-v2`
**Production domain:** `www.catchcomics.com`
**Production branch:** `main`
**Framework preset:** Next.js

---

## ↩️ Rollback Procedures

### Rollback via Vercel (fastest — no git required)

1. Vercel dashboard → `catch-comics-v2` → Deployments
2. Find the last known-good deployment
3. Click `⋯` → **Promote to Production**
4. Live in ~10 seconds

> Use this for immediate production incidents. Then fix in code afterward.

---

### Rollback via Git Revert (leaves clean history)

```bash
# 1. Find the bad commit hash
git log --oneline -10

# 2. Revert it (creates a new commit — safe)
git revert <bad-commit-hash>

# 3. Push to dev, verify, then merge to main
git push origin dev
# ... verify on preview ...
git checkout main && git merge dev && git push origin main
```

---

### Rollback via Hard Reset (last resort — destructive)

```bash
# ⚠️ DANGEROUS — rewrites history
# Only use if revert isn't possible and the commit is very recent

# 1. Find last good commit
git log --oneline -10

# 2. Reset to it
git reset --hard <last-good-hash>

# 3. Force push (ONLY for dev branch, NEVER for main)
git push --force origin dev

# For main: use Vercel dashboard rollback instead — never force-push main
```

---

## 🔴 Production Incident Protocol

```
1. ASSESS — is it completely down, or degraded?
2. ROLLBACK FIRST — via Vercel dashboard (10 seconds, no code changes)
3. DIAGNOSE — read Vercel function logs, browser console errors
4. COMMUNICATE — update any stakeholders if needed
5. FIX IN DEV — fix the issue locally, test, push to dev preview
6. VERIFY ON PREVIEW — confirm it's fixed on staging
7. SHIP TO PRODUCTION — merge dev → main
8. CONFIRM — verify on www.catchcomics.com post-ship
```

---

## 📋 Post-Deploy Verification Checklist

After merging to `main` and build completes:

```
[ ] www.catchcomics.com loads
[ ] Search works (try "batman" and "one piece")
[ ] Comic detail page loads (e.g. /comic/796)
[ ] Prices load for UK and US
[ ] No console errors on homepage
[ ] No console errors on search results
[ ] No console errors on detail page
[ ] Mobile layout OK (375px)
[ ] UK/US toggle works correctly
```
