# Catch Comics — Security Fixes (Phase 2)

**Date:** 2026-07-05
**Scope approved:** Tier A + H1 only. Small, reversible changes. No secret rotation, no CSP enforcement, no admin-auth redesign, no SEO/crawl changes, no dashboard.
**Status:** Implemented in the working tree. **Not committed / not pushed / not deployed** — awaiting your go-ahead to commit.

---

## 1. Exact fixes implemented

### A1 — JSON-LD XSS escaping (was MEDIUM M1)
- New helper `lib/security/jsonLd.ts` → `jsonLdScriptString(data)`. It runs `JSON.stringify` then escapes `<`, `>`, `&`, U+2028 and U+2029 to their `\uXXXX` forms. Output is still valid JSON (parsers/Google decode it back), but a string containing `</script>` can no longer break out of the `<script type="application/ld+json">` element.
- Applied at all four JSON-LD render sites, replacing raw `JSON.stringify`:
  - `app/product/[slug]/page.tsx` (product Book schema)
  - `app/series/page.tsx` (ItemList)
  - `app/series/[slug]/page.tsx` (BookSeries + ItemList)
- Verified by unit test: a poisoned `Batman</script><script>…` title produces no raw `<`/`>` and round-trips to the original value.

### A2 — Static security headers (was MEDIUM M2)
Added via `next.config.ts` `async headers()`, applied to `/:path*`:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: SAMEORIGIN` (anti-clickjacking)
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=(), browsing-topics=()`
- **HSTS left untouched** — Vercel already sends `Strict-Transport-Security` at the edge (confirmed live in Phase 1). Not duplicated here.

### A3 — CSP Report-Only (was MEDIUM M2)
- `Content-Security-Policy-Report-Only` added in `next.config.ts`, active on **every Vercel deployment (Preview + Production)**, gated on `VERCEL_ENV in {preview, production}` so it can be verified on a preview but is NOT sent during local `next dev` (where HMR/eval would flood the console). **Nothing is enforced** — this header only reports.
- `Reporting-Endpoints: csp-endpoint="/api/csp-report"` header added; policy carries both `report-uri /api/csp-report` (legacy) and `report-to csp-endpoint` (modern).
- New sink `app/api/csp-report/route.ts` logs truncated violation reports to Vercel logs and returns 204. It is rate-limited (see H1).
- The policy reflects the app as it runs today (`'unsafe-inline'`/`'unsafe-eval'` for Next hydration + inline JSON-LD, `img-src https:` for cover CDNs, Vercel Analytics hosts allowed). **Tightening path is documented inline in `next.config.ts`** (nonce-based scripts → drop `unsafe-eval` → narrow `img-src` → rename header to enforce).

### A4 — Pagination clamp (was MEDIUM M5)
- New helper `lib/security/http.ts` → `clampInt(raw, min, max, fallback)` (NaN/missing/Infinity → fallback).
- `app/api/search/route.ts` now clamps `page` to `[1, 10000]` and `pageSize` to `[1, 50]` (default 20). A request like `?pageSize=1000000` can no longer amplify the query/response.
- Verified by unit test (huge → cap, negative → min, `abc`/null/undefined → fallback).

### A5 — Sanitize public error responses (was LOW L2)
- `app/api/ebay/route.ts` no longer returns `error: String(err)` to the client. It logs the detail server-side (`console.error`) and returns only `{ listings: [], source: 'error' }`. Swept the rest of `app/api` — no other route leaked raw error text.

### H1 — Rate limiting on unauthenticated, cost-sensitive endpoints (was HIGH)
- New `lib/security/rateLimit.ts` — a KV-backed fixed-window limiter using the already-provisioned Vercel KV. One `INCR` + `EXPIRE` per request against a `rl:{route}:{ip}:{window}` key.
- **Fail-open by design:** if `RATE_LIMIT_DISABLED=1` (kill-switch), if KV isn't configured (e.g. local dev), or if KV errors, the request is **allowed**. The limiter can never take the site down.
- `enforceRateLimit(req, route, limit)` returns a `429` (`Retry-After` + `X-RateLimit-*` headers) or `null` to proceed. Wired into:

  | Endpoint | Limit / IP / min | Why |
  |---|---|---|
  | `/api/ebay` | 40 | live paid eBay Browse API |
  | `/api/search` | 120 | DB + Comic Vine fallback |
  | `/api/autocomplete` | 200 | per-keystroke; can reach Comic Vine |
  | `/api/log-error` | 60 | unauthenticated log writer |
  | `/api/csp-report` | 60 | unauthenticated log writer |

  Limits are deliberately generous — a human (even several behind one NAT'd IP) won't hit them; scripted floods (hundreds–thousands/min) are stopped.

---

## 2. Files changed

**New (6):**
- `lib/security/jsonLd.ts`
- `lib/security/http.ts`
- `lib/security/rateLimit.ts`
- `app/api/csp-report/route.ts`
- `scripts/test-security-helpers.ts` (unit checks)
- `launch/security/security-fixes.md` (this file)

**Modified (8):**
- `next.config.ts` (headers + CSP-RO)
- `app/product/[slug]/page.tsx` (JSON-LD helper + import)
- `app/series/page.tsx` (JSON-LD helper + import)
- `app/series/[slug]/page.tsx` (JSON-LD helper + import)
- `app/api/ebay/route.ts` (rate limit + error sanitize)
- `app/api/search/route.ts` (rate limit + clamp)
- `app/api/autocomplete/route.ts` (rate limit)
- `app/api/log-error/route.ts` (rate limit)

> `launch/metrics-history.json` also shows as modified in `git status`, but that predates this work (it was already dirty in the Phase 1 `git status`). Not part of these fixes.

---

## 3. Root risk each fix addresses
- **A1** → Stored XSS: externally-sourced (Comic Vine/retailer/DB) titles breaking out of the JSON-LD script tag and executing in visitors' browsers.
- **A2** → Clickjacking / MIME-sniffing / referrer leakage on all pages.
- **A3** → No CSP defence-in-depth; Report-Only starts the measurement needed to safely enforce later.
- **A4** → DB/response amplification via unbounded `pageSize`/`page`.
- **A5** → Internal error-detail disclosure to unauthenticated clients.
- **H1** → Bill run-up / resource exhaustion: scripted hammering of paid external APIs (eBay, Comic Vine) and expensive DB work.

---

## 4. Behaviour changes
- **Normal users:** none expected. JSON-LD renders identical structured data (escaped but decoded by parsers). Pagination unchanged for real requests (UI uses page≥1, pageSize=20). New headers are additive. CSP is Report-Only (blocks nothing). Rate limits are far above human usage.
- **Abusers:** endpoints in the H1 table return `429` once over the per-IP/min limit.
- **eBay error case:** client no longer receives an `error` string field (it already keyed off `listings`; the `source: 'error'` marker is retained). If eBay fails, the product page still degrades gracefully to no eBay listings.
- **Under limit for `/api/search`:** returns `429` instead of results — acceptable only under abuse-level traffic (120/min/IP).

---

## 5. Remaining risks / notes
- **Runtime verification is pending a deploy (see §Verification).** The changes typecheck clean, lint clean (no new issues), and pass unit tests, but I did **not** stand up the live dev server — locally it (a) hits the production DB/APIs, (b) gates the CSP header off by design, and (c) fail-opens the rate limiter (no local KV), so it can't faithfully verify the security behaviours anyway. A Vercel Preview deploy is the correct place to verify: CSP-Report-Only IS emitted on Preview, and KV IS bound to Preview so the rate limiter is live there.
- **Rate-limit accuracy under NAT:** per-IP limiting can group users behind a shared IP. Limits are set high to avoid false positives; monitor `429`s after deploy and raise if needed.
- **CSP will report violations, not block them** — expect noise in logs initially; that's the point. Do not flip to enforced until logs are clean (documented in `next.config.ts`).
- **Out of scope / still open from the audit:** M3 (public repo / launch notes), M4 (`npm audit` transitive vulns + GitHub scanning config), M6 (admin-auth hardening), M7 (image-optimizer cost), plus the Vercel/GitHub checklist. None were touched this pass, per your instructions.
- **Pre-existing lint error (not introduced here):** `app/product/[slug]/page.tsx:472` — `Date.now()` "impure during render" — exists verbatim in HEAD and is unrelated to these changes. Left alone (out of scope).

---

## 6. Manual toggles you still need to do (GitHub / Vercel)
These are required for H1 and the monitoring to be fully effective — I cannot set them from here:
- **Vercel → Storage:** confirm KV is bound to Production (it is, per Phase 1 `vercel env ls`). No action unless you rotated it.
- **Vercel → Settings → Environment Variables:** optional kill-switch — add `RATE_LIMIT_DISABLED=1` to instantly disable rate limiting if it ever misbehaves (leave unset for normal operation).
- **Vercel → Spend Management:** set a spend limit + alert (the real backstop behind H1).
- **GitHub → Code security & analysis:** enable secret scanning + push protection + Dependabot (free; repo is public).
- After deploy: watch Vercel logs for `[csp-report]` (CSP violations) and `429` rates.

---

## 7. Did the launch security verdict change?
**Direction: improved, pending deploy verification.** The single HIGH (H1) now has code-level mitigation, and three MEDIUMs (M1 JSON-LD, M2 headers/CSP, M5 pagination) plus one LOW (L2) are addressed. Once these are **deployed and verified on a preview**, the practical risk posture moves from *SAFE WITH KNOWN RISKS* toward the clean end of that band. It is **not** a full "SAFE" yet because: (a) these fixes aren't deployed, and (b) untouched items remain — Vercel Spend Management (the cost backstop), GitHub secret scanning, and the M3/M4/M6/M7 hardening. **Verdict stays: 🟡 SAFE WITH KNOWN RISKS**, now with fewer open code-level risks.

---

## Verification performed
- ✅ `npx tsc --noEmit` — clean (exit 0).
- ✅ `npx eslint` on all changed files — no new errors/warnings from these changes (the 1 pre-existing error + 5 warnings are in untouched code, confirmed against HEAD).
- ✅ `npx tsx scripts/test-security-helpers.ts` — 17/17 checks pass (JSON-LD breakout neutralised + round-trips; clamp caps huge/invalid input).

## Verification still to do (on a Vercel Preview deploy — recommended before production)
Deploy a preview (`git push` a branch, or `vercel` CLI), then:
1. `curl -sD - -o /dev/null https://<preview-url>/` → confirm `x-content-type-options`, `x-frame-options`, `referrer-policy`, `permissions-policy`, and `content-security-policy-report-only` are present, HSTS still there.
2. Load homepage, a search, a product page, a series page → confirm they render and JSON-LD (`<script type="application/ld+json">`) is valid.
3. Click a `/go/<id>` affiliate link → confirm it still redirects.
4. `curl "https://<preview-url>/api/ebay?title=batman"` a few times → normal 200; then hammer >40/min from one IP → expect `429` with `Retry-After`.
5. `curl "https://<preview-url>/api/search?q=batman&pageSize=1000000"` → confirm it returns normally (clamped), not a huge/expensive response.
6. Confirm the CSP header is `-Report-Only` (not enforcing) and watch logs for `[csp-report]`.
