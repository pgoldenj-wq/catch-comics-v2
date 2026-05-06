# 📋 Workflow Rules

> The laws that keep the codebase safe. Read before starting any session.

---

## 🔁 The Core Cycle — Never Skip Steps

```
INSPECT → PLAN → WAIT → IMPLEMENT → VERIFY → COMMIT
```

| Step | What it means |
|---|---|
| **INSPECT** | Read the files. Understand the current state. |
| **PLAN** | Describe the fix. Get confirmation if unsure. |
| **WAIT** | Don't implement until the plan is clear. |
| **IMPLEMENT** | Make the change. One concern at a time. |
| **VERIFY** | Test on `localhost:3000`. Run `npm run check`. |
| **COMMIT** | Checkpoint commit. Push to `dev` only. |

> ⚠️ **Skipping INSPECT causes 90% of bugs.** Never edit a file you haven't read.

---

## 🌿 Branch Rules

| Branch | Purpose | Who pushes |
|---|---|---|
| `main` | Production — `www.catchcomics.com` | Only via Vercel merge from `dev` |
| `dev` | Staging — Vercel preview URL | Daily development pushes |

```bash
# Always push to dev
git push origin dev

# Merge to main only when ready to ship
git checkout main && git merge dev && git push origin main
```

> ⚠️ **Never push directly to `main`.** If you do, production updates immediately.

---

## 🎨 Design Freeze

These files have `⚠ DESIGN FREEZE` at line 2. You may NOT change:

- Font sizes, colours, padding, margins, border-radius
- Component structure or layout
- Inline styles unrelated to the specific bug being fixed
- Anything not explicitly listed in the task

**Frozen files:**
- `app/page.tsx`
- `app/search/page.tsx`
- `app/comic/[id]/page.tsx`

To change design on these files, you must explicitly state:
```
"I am intentionally changing [specific style] in [file] because [reason]"
```

---

## 📐 Scope Rules for Claude Tasks

| Task type | Allowed files |
|---|---|
| UI change | Component/page only — no API routes |
| API fix | Route file only — no components |
| Search relevance | `lib/parseComicQuery.ts`, `app/api/search/route.ts` |
| Logic/data fix | Named files only — no style changes |
| Full feature | Define scope explicitly before starting |

**One concern per prompt.** If it touches more than 2–3 files, split it.

---

## 💾 Commit Rules

### Naming convention
```
feat: add carousel arrow buttons
fix: price-hint mismatch with detail page
chore: checkpoint — hero layout refactor
refactor: move FCBD filter to mapListing
docs: update dev reference files
```

### Commit frequency
- Checkpoint commit **before** every major change
- Checkpoint commit **after** every verified change
- Never leave more than 30 minutes of work uncommitted

### What to include
```bash
git add .                          # all changed files
git commit -m "fix: description"   # clear, specific message
```

---

## 🚦 Testing Rules

1. **localhost:3000 first** — always, no exceptions
2. **Check both UK and US markets** — eBay data differs per marketplace
3. **Test edge cases:** no results, slow API, missing images
4. **Check mobile width** — at least 375px viewport
5. **No console errors** — open devtools before calling it done
6. **`npm run check` must pass** — zero TypeScript errors before committing

---

## 🧊 Cache Awareness

The app uses in-memory TTLCache. On dev server restart, **all cache is cleared.**

| Cache key | TTL | Notes |
|---|---|---|
| `prices:{region}:{query}` | 1h | Full 20-listing eBay results |
| `hint:{region}:{query}` | 1h | Cheapest price only |
| `volume:{id}` | 1h | Comic Vine volume data |
| `issue:{id}` | 1h | Comic Vine issue data |
| `search:{query}:{page}` | 1h | Search result sets |

> When testing price fixes: restart dev server to flush stale cached prices.

---

## 🔌 API Behaviour

### Comic Vine
- Rate limited — don't spam requests in development
- `people` field: available on volumes AND issues (after fix)
- `characters` field: volumes only
- Placeholder images detected and replaced with letter fallback
- Issue IDs: `i` prefix in UI, `4000-` prefix in API calls
- Volume IDs: numeric in UI, `4050-` prefix in API calls

### eBay Browse API
- OAuth token auto-refreshes (7200s TTL, refreshed 5min early)
- Category 259104 = Comics & Graphic Novels (filters non-comic products)
- FCBD listings filtered at `mapListing()` level
- `sandbox` detected from `EBAY_CLIENT_ID` containing `-SBX-`
- `searchListings(query, marketplace, 20)` — always 20 listings for full fetch

---

## 🆘 When to Stop and Ask

Stop Claude immediately and re-evaluate if:

- More than 3 files are being changed for a "small" fix
- A file with `⚠ DESIGN FREEZE` is being edited without permission
- Any `git push` or deployment is suggested before localhost testing
- The change is described as "just a quick update to [unrelated file]"
- TypeScript errors appear that weren't there before

---

## 📊 Session Start Checklist

```
[ ] git status — know where you are
[ ] git pull origin dev — get latest
[ ] npm run dev — server running
[ ] Open QUICK-START.md — context fresh
[ ] Plan the task before opening Claude
```

## 📊 Session End Checklist

```
[ ] All changes tested on localhost:3000
[ ] npm run check passes
[ ] No console errors
[ ] Committed with clear message
[ ] Pushed to dev (not main)
[ ] Vercel preview URL checked
```
