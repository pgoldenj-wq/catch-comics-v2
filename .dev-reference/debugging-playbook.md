# 🔍 Debugging Playbook

> Ordered by how often each issue occurs. Symptoms → Cause → Fix.

---

## 🚑 Emergency Triage

Before anything else:

```bash
npm run check          # Is it a TypeScript error?
git status             # Did something get accidentally changed?
git diff               # What exactly changed?
# Then: hard refresh browser Ctrl+Shift+R
# Then: rm -rf .next && npm run dev
```

---

## 🟥 P0 — Site is Down / Won't Load

### Symptom: Blank page or 500 error

**Step 1 — Is it a build error?**
```bash
npm run check
# If errors → fix TypeScript errors first
```

**Step 2 — Is it a stale build?**
```bash
rm -rf .next
npm run dev
```

**Step 3 — Is it a runtime error?**
- Open browser DevTools → Console tab
- Look for red errors → read the stack trace
- Look for failed network requests → Network tab → filter "failed"

**Step 4 — Is it a missing env var?**
```bash
# Check .env.local exists and has all required keys:
# COMIC_VINE_API_KEY
# EBAY_CLIENT_ID
# EBAY_CLIENT_SECRET
# EBAY_MARKETPLACE_ID_UK
# EBAY_MARKETPLACE_ID_US
```

---

## 🟥 P0 — Production Down

1. Go to Vercel dashboard → `catch-comics-v2` → Deployments
2. Find the last successful deployment → "Promote to Production"
3. Read the build logs on the failing deployment
4. Check: was a new env var added but not set in Vercel?

---

## 🟧 P1 — Prices Not Showing

### Symptom: Prices never load, spinner forever

**Likely cause:** eBay API error — bad token, rate limit, or env var missing

```bash
# Test the API directly
curl "http://localhost:3000/api/prices?q=batman&region=uk"
# Read the JSON response — it includes env debug info
```

Check the response for:
- `"hasClientId": false` → env var missing
- `"error": "eBay OAuth failed"` → wrong credentials
- `"listings": []` → API returned no results (category filter too strict?)
- `"error": "eBay Browse API failed: 429"` → rate limited

**Token refresh issues:**
- Token is cached in-process — restart dev server clears it
- Production: Vercel Functions are stateless, each invocation gets a new token check

---

### Symptom: Price shows on results page but different on detail page

**Cause:** `price-hint` cached stale 5-listing result (fixed — now fetches 20)

**Quick fix:**
```bash
# Restart dev server to clear in-memory cache
# Then test again
```

---

## 🟧 P1 — Search Returns Wrong Results

### Symptom: "Batman: Year One" doesn't rank #1

**Check:** `lib/parseComicQuery.ts` → `titleMatchScore()`

The `norm()` function strips punctuation before comparing. If a colon or hyphen is causing a mismatch:
```typescript
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim()
```

**Debug approach:**
```
SCOPE: lib/parseComicQuery.ts only.
Problem: Query "Batman: Year One" returns "[wrong result]" at position 1.
Expected: "Batman: Year One" at position 1.
Read the scoring function. Log what norm() produces for both strings.
Explain why the wrong result scores higher. Do not fix yet.
```

---

### Symptom: Non-comic products showing in results (e.g. "Bleach" → cleaner)

**Cause:** eBay category filter not working — check `lib/ebay.ts`

```typescript
url.searchParams.set('category_ids', '259104')
// This line must be present in searchListings()
```

---

### Symptom: Same comic appearing twice in search results

**Check:** `app/api/search/route.ts` → dedup map key

```typescript
const key = normalizeTitle(name) + '|' + pubName
// Publisher is included to allow same-title different-publisher results
```

If two identical comics are still deduplicating incorrectly, check that `publisher.name` is populated in the Comic Vine response.

---

## 🟧 P1 — Comic Detail Page Issues

### Symptom: Creator info missing (writer/artist)

**For volumes:** check `app/api/comic/[id]/route.ts` — `people` must be in field_list for volumes ✓

**For issues:** same file — `people` must be in the issue field_list (added in fix) ✓

**Issue cache:** if the issue was cached before the `people` fix, it'll still be stale
```bash
# Restart dev server to clear TTLCache
```

### Symptom: Cover image not showing — shows letter instead

**Expected:** Comic Vine placeholder images are intentionally blanked

Check `app/api/comic/[id]/route.ts` → `isPlaceholderImage()`:
```typescript
if (url.includes('no_image')) return true
if (/\/uploads\/[^/]+\/0\/\d+\//.test(url)) return true
```

If a legitimate cover is being hidden, add its URL pattern as an exception.

### Symptom: Character pills not showing

**Cause:** `characters` field is only available on **volumes**, not single issues (Comic Vine API limitation — not a bug in our code).

---

## 🟨 P2 — UI / Visual Bugs

### Symptom: Layout looks different than localhost on production

- Check if Tailwind class names are correct (Tailwind 4 uses different some syntax)
- Check if inline styles are being overridden by Tailwind utility classes
- Hard refresh on production to clear browser cache

### Symptom: Price flickers / shows then disappears

**Cause:** `priceValue` state was being reset on re-render

Check `app/search/page.tsx` → `PriceTag` component:
- Uses `useRef` for `onPriceLoaded` callback to avoid stale closure
- Never resets `priceValue` to `undefined` once set
- Effect deps: `[query, region, index]` — `onPriceLoaded` intentionally omitted

### Symptom: React warning: "updating a style property during rerender"

**Cause:** `border` shorthand conflicts with `borderBottom` (or similar) in same style object

**Fix:** Replace `border: 'none'` with `borderTop: 'none', borderLeft: 'none', borderRight: 'none'`

Check `components/SearchBar.tsx` dropdown button styles.

### Symptom: Carousel animation jank / stops

- Check `hoverZoneRef.current` is being set correctly in `handleMouseMove`
- The `setInterval` reads from `hoverZoneRef` (not state) to avoid stale closures
- If carousel freezes: `offsetRef.current` may be outside `[SET_W, SET_W * 2]` range

---

## 🟨 P2 — API Route Errors

### Pattern for diagnosing any API route

```bash
# 1. Hit the route directly
curl "http://localhost:3000/api/[route]?param=value"

# 2. Read the JSON — look for 'error' key and '_env' debug object
# 3. Check the terminal running npm run dev — server-side console.log() shows there
# 4. Check Vercel function logs on production
```

### Common API errors

| Error | Cause | Fix |
|---|---|---|
| `"COMIC_VINE_API_KEY not set"` | Missing env var | Add to `.env.local` |
| `"eBay OAuth failed: 401"` | Bad credentials | Check Client ID / Secret |
| `"eBay Browse API failed: 429"` | Rate limited | Wait, or reduce request frequency |
| `"Comic not found"` | Wrong ID format | Ensure `i` prefix for issues |
| `status: 400` on search | Empty query | Check `q` param is set |

---

## 🔧 Debug Tools

### Browser DevTools

| Tab | Use for |
|---|---|
| Console | JS errors, our `console.log()` output |
| Network | API calls, response payloads, status codes |
| Sources | Set breakpoints in client components |
| Application → Cache | Clear localStorage/sessionStorage |

### VS Code

```bash
# Find all console.log() calls (before committing)
grep -r "console.log" app/ lib/ components/ --include="*.ts" --include="*.tsx"

# Find all TODO/FIXME
grep -r "TODO\|FIXME\|HACK" app/ lib/ components/
```

### Quick API test URLs (localhost)

```
http://localhost:3000/api/search?q=batman&region=uk
http://localhost:3000/api/prices?q=batman&region=uk
http://localhost:3000/api/price-hint?q=batman&region=uk
http://localhost:3000/api/comic/796
http://localhost:3000/api/comic/i892345
```

---

## 🔁 "It Worked Before" Checklist

When something used to work and now doesn't:

```
[ ] git log --oneline -10 — which commit broke it?
[ ] git diff HEAD~1 — what changed in the last commit?
[ ] Is the dev server up to date? (restart it)
[ ] Is the cache stale? (restart clears TTLCache)
[ ] Did an env var get accidentally deleted from .env.local?
[ ] Is the TypeScript type check passing?
[ ] Did Vercel pick up the right commit? (check dashboard)
```
