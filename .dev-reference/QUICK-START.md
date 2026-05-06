# 🎯 Catch Comics — Dev Reference Hub

> **Internal use only. Not part of the app.**
> Open this file in VS Code with `Ctrl+Shift+V` for rendered preview.

---

## 📂 Reference Index

| File | Purpose | Open when… |
|---|---|---|
| [terminal-cheatsheet.md](terminal-cheatsheet.md) | Every command you run | You need a command |
| [claude-prompts.md](claude-prompts.md) | Copy-paste Claude templates | Starting any AI task |
| [workflow-rules.md](workflow-rules.md) | Rules for safe development | Before a major change |
| [debugging-playbook.md](debugging-playbook.md) | Diagnose broken things | Something isn't working |
| [deployment-checklist.md](deployment-checklist.md) | Ship safely to production | Before any push |

---

## ⚡ 30-Second Startup

```bash
npm run dev          # Start local server → localhost:3000
git status           # Check what's changed
```

Then open Claude → paste your task → **diagnose first, implement second**.

---

## 🔁 Daily Workflow

```
1. npm run dev                  → start local server
2. git status                   → see where you are
3. open Claude                  → paste task from claude-prompts.md
4. DIAGNOSE ONLY first          → confirm the fix before implementing
5. test on localhost:3000        → never trust Vercel preview for first look
6. npm run check                → confirm types clean
7. git add + commit             → checkpoint commit
8. git push origin dev          → push to preview (staging)
9. verify on Vercel preview URL → then merge to main for production
```

---

## 🚨 If Something Breaks

| Symptom | First action |
|---|---|
| Nothing loads | `rm -rf .next && npm run dev` |
| Wrong data / stale | Hard refresh `Ctrl+Shift+R` |
| Types failing | `npm run check` — read the error |
| Prices wrong | Clear eBay cache — restart dev server |
| Build fails on Vercel | Check Vercel function logs, check env vars |
| Site down on www | Check Vercel → `catch-comics-v2` → Deployments |
| Need to revert | See [deployment-checklist.md](deployment-checklist.md) → Rollback section |

---

## ✅ Before Pushing to Production (merge dev → main)

- [ ] Tested every changed feature on `localhost:3000`
- [ ] `npm run check` passes with zero errors
- [ ] No console errors in browser devtools
- [ ] Verified on Vercel dev preview URL (not just localhost)
- [ ] No hardcoded test data left in code
- [ ] Env vars confirmed in Vercel dashboard if new vars added
- [ ] `git log --oneline` looks clean

---

## 🏅 Golden Rules

1. **DIAGNOSE before IMPLEMENT** — never let Claude edit files until you understand the fix
2. **localhost first** — always verify on `localhost:3000` before any push
3. **`dev` branch only** — never push direct to `main`; merge via Vercel or GitHub
4. **one concern per Claude prompt** — scoped tasks = accurate fixes
5. **`npm run check` is non-negotiable** — always run before committing
6. **checkpoint commits** — small, frequent, named commits beat one giant one
7. **design freeze** — files with `⚠ DESIGN FREEZE` at line 2 require explicit permission to change layout/spacing/colours

---

## 🏗 Stack at a Glance

| Layer | Tech |
|---|---|
| Framework | Next.js 16.2.4 (App Router) |
| Language | TypeScript 5 |
| Styling | Tailwind CSS 4 |
| Data: Comics | Comic Vine API (`4050-` volumes, `4000-` issues) |
| Data: Prices | eBay Buy Browse API (OAuth2 client credentials) |
| Data: Books | Open Library API (ISBN fallback) |
| Cache | In-memory TTLCache — 1h for prices, volumes, issues |
| Hosting | Vercel — `catch-comics-v2` project |
| Production | `www.catchcomics.com` → `main` branch |
| Staging | Vercel preview URL → `dev` branch |

---

## 📁 Key Files Map

```
app/
  page.tsx                  ← Home page + carousel
  search/page.tsx           ← Search results + PriceTag
  comic/[id]/page.tsx       ← Comic detail page
  api/
    search/route.ts         ← Comic Vine search + dedup
    prices/route.ts         ← eBay 20-listing fetch
    price-hint/route.ts     ← eBay cheapest (warms prices cache)
    comic/[id]/route.ts     ← Comic Vine volume/issue detail
    comic/[id]/issues/      ← Issue list for volumes

components/
  SearchBar.tsx             ← Shared search input
  PricingPanel.tsx          ← eBay listing cards + format pills

lib/
  ebay.ts                   ← eBay OAuth + Browse API
  cache.ts                  ← TTLCache instances
  parseComicQuery.ts        ← titleMatchScore() scoring
```
