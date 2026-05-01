# Catch Comics — Launch Checklist

---

## PHASE 1 — CORE PRODUCT FUNCTION
**Objective:** Confirm every core user flow works end-to-end, no dead ends.

- [x] Search by title returns correct results
- [ ] Search by ISBN returns the exact correct item
- [ ] Search with zero results shows a clean empty state (not a blank page)
- [ ] Each result links to a working product detail page
- [ ] Top Deals page loads and displays real items with prices
- [ ] Homepage hero/search bar is functional on first load
- [ ] Navigation links all resolve (no 404s)
- [ ] Back button works correctly from product pages
- [ ] No broken routes in next.config.js redirects

> Run every flow on Chrome + Safari + Firefox before moving on.

---

## PHASE 2 — DATA & IMAGE ACCURACY
**Objective:** Every title must match its image. Zero mismatches allowed.

- [ ] Comic Vine API key is active and stored in .env.local + Vercel env vars
- [ ] Image fetch uses Comic Vine volume or issue ID — not fuzzy title match
- [ ] Test 20 searches — confirm image matches the title shown
- [ ] Fallback image exists for any item with no Comic Vine result (generic cover placeholder, not broken)
- [ ] No `<img>` tags with empty src (causes layout breaks)
- [ ] Comic Vine rate limit (200 req/hour) handled — add request queue or cache layer
- [ ] Images served via next/image with correct domain in next.config.js
- [ ] Image alt text is set to the comic title (accessibility + SEO)

> Comic Vine fuzzy matching is unreliable — always bind images to a stored ID, not a re-fetched title string.

---

## PHASE 3 — PRICING & API CONNECTIONS
**Objective:** Prices are real, always display, and never silently fail.

- [ ] eBay Browse API credentials stored in Vercel env vars (not hardcoded)
- [ ] eBay search returns price + listing URL for at least 80% of test queries
- [ ] Price display never shows £0.00, "undefined", or blank — use fallback text: "Check price →"
- [ ] If eBay returns no results, UI shows fallback (e.g. "View on eBay →" with a manual search URL)
- [ ] eBay API call is server-side (Next.js API route) — API key never exposed to client
- [ ] Basic in-memory or vercel/kv cache on eBay responses (5–15 min TTL) to avoid rate limits
- [ ] Amazon links constructed correctly: `amazon.co.uk/s?k=[ISBN or title]&tag=[affiliate-tag]`
- [ ] Test 5 Amazon links — confirm they land on relevant results with tag visible in URL
- [ ] Price sort/filter (if built) tested with mixed real + fallback data

> Don't over-engineer pricing logic. Show one real price + a "check more" link. That's enough to launch.

---

## PHASE 4 — AFFILIATE SETUP (REVENUE)
**Objective:** Every outbound link earns. Nothing leaks revenue.

- [ ] Amazon Associates account active — tag confirmed in Associates dashboard
- [ ] Amazon tag appended to every Amazon outbound link (check via URL inspector)
- [ ] eBay Partner Network account active — campaign ID stored and appended to eBay links
- [ ] Awin account approved — at least 2 UK retailer programmes joined (e.g. Forbidden Planet, Waterstones)
- [ ] Awin deeplinks tested — confirm they resolve correctly and track in Awin dashboard
- [ ] All affiliate links open in `target="_blank"` with `rel="noopener noreferrer"`
- [ ] No affiliate link goes through a redirect that strips the tag
- [ ] Manually click one affiliate link per retailer — confirm attribution appears in each dashboard

> Awin approval can take days. Apply immediately if not done. Use Amazon + eBay as primary launch revenue.

---

## PHASE 5 — PERFORMANCE (SPEED)
**Objective:** Sub-3s load on mobile. Fast search response. No wasted renders.

- [ ] Run Lighthouse on homepage — target 85+ Performance score
- [ ] Run Lighthouse on a product page — target 85+ Performance score
- [ ] All images use next/image (auto WebP, lazy load, correct sizing)
- [ ] No console.log calls left in production code
- [ ] Search input is debounced (300–500ms) — not firing on every keystroke
- [ ] API routes return within 1.5s — log slow ones and add caching
- [ ] No unused npm packages imported in page components
- [ ] `next build` completes with no warnings about large bundles

> Don't chase a perfect score. 85+ is launch-ready. Fix the big wins only.

---

## PHASE 6 — UI / UX POLISH
**Objective:** Looks sharp, feels fast, nothing feels broken or unfinished.

- [ ] Loading spinner or skeleton shown during every API fetch
- [ ] Empty state designed (not a blank box) — for search, Top Deals, product page
- [ ] Error state designed (not a white screen) — for failed API calls
- [ ] Mobile layout tested on 375px (iPhone SE) and 390px (iPhone 14)
- [ ] No text overflow or truncation on small screens
- [ ] Tap targets (buttons, links) are minimum 44x44px on mobile
- [ ] Fonts load correctly (no FOUT flash of unstyled text)
- [ ] Dark/light mode consistent (if applicable — pick one and commit)
- [ ] No orphaned UI elements (e.g. buttons that do nothing yet)
- [ ] Favicon set correctly (visible in browser tab)

---

## PHASE 7 — RELIABILITY (NO BREAKAGE)
**Objective:** The site handles failures gracefully and never fully crashes.

- [ ] All API calls wrapped in try/catch — no unhandled promise rejections
- [ ] TypeScript build passes with zero tsc errors (`npx tsc --noEmit`)
- [ ] Zero red errors in browser console on any page
- [ ] Zero broken imports (run `next build` — confirm clean output)
- [ ] If Comic Vine is down, product page still renders (with placeholder image)
- [ ] If eBay API fails, price section shows fallback — page does not crash
- [ ] 404 page is custom and helpful (link back to homepage + search)
- [ ] 500 error page exists (even a basic one)
- [ ] Test site with DevTools throttled to "Slow 3G" — nothing breaks

> The goal isn't perfect error handling — it's that no single failure takes down the whole page.

---

## PHASE 8 — DOMAIN & LIVE DEPLOYMENT
**Objective:** catchcomics.com is live, fast, and correctly connected.

- [ ] Vercel project linked to catch-comics-v2 GitHub repo
- [ ] Auto-deploy on push to main branch is confirmed working
- [ ] catchcomics.com added as custom domain in Vercel dashboard
- [ ] Cloudflare DNS has correct A or CNAME record pointing to Vercel
- [ ] Cloudflare proxying (orange cloud) set correctly — check Vercel's guidance (some setups need it off)
- [ ] HTTPS active and cert valid (padlock in browser — no warnings)
- [ ] www.catchcomics.com redirects to catchcomics.com (or vice versa — pick one)
- [ ] All production env vars set in Vercel (not just .env.local)
- [ ] Test production URL — confirm it's not using dev/stub data
- [ ] Vercel deployment logs checked — no build errors on latest deploy

> Most launch failures are env vars missing in Vercel. Double-check every key from .env.local is added.

---

## PHASE 9 — MINIMUM TRUST SIGNALS
**Objective:** User lands on the site and immediately trusts it enough to click.

- [ ] Privacy Policy page exists (use a generator — e.g. Termly, free tier)
- [ ] Cookie notice shown if using analytics or any tracking
- [ ] Affiliate disclosure visible — e.g. "We may earn a commission from purchases" in footer
- [ ] Footer includes: Privacy Policy link, affiliate disclosure, contact email
- [ ] hello@catchcomics.com resolves (test by sending a real email)
- [ ] Site title and meta description are set correctly (not "My App" or blank)
- [ ] Open Graph tags set — share preview looks correct if posted to Twitter/X or WhatsApp
- [ ] No placeholder text (Lorem Ipsum, "Coming Soon", "TODO") visible anywhere

> You don't need Terms & Conditions to launch. Privacy Policy + affiliate disclosure is the minimum legal baseline.

---

## 🚀 LAUNCH CHECK (FINAL)
Run this on the day you go live. Every box must be ticked.

- [ ] `next build` passes clean — zero TypeScript errors, zero warnings
- [ ] Search works by title AND ISBN on production URL
- [ ] Every affiliate link (Amazon, eBay, Awin) opens correctly with tracking tag
- [ ] No console errors on homepage, search results, or product page
- [ ] Site loads on mobile (iPhone + Android) without layout breaks
- [ ] catchcomics.com loads over HTTPS with no cert warnings
- [ ] All Vercel env vars confirmed set (API keys, affiliate tags)
- [ ] Fallbacks working — kill an API key temporarily, confirm no crash
- [ ] Privacy Policy + affiliate disclosure live in footer
- [ ] You've used the site as a real user for 10 minutes and hit no dead ends
