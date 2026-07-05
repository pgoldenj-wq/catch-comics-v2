# Catch Comics — Security Audit (Phase 1)

**Date:** 2026-07-05
**Auditor role:** Senior web-app security reviewer / Next.js + Vercel security engineer / cost-protection advisor
**Target:** Catch Comics — Next.js 16.2.4 on Vercel, production `https://www.catchcomics.com` (project `catch-comics-v2`)
**Launch date:** 2026-07-26
**Status:** INSPECT-ONLY. No files were modified. Awaiting your approval before any Phase 2 fix.

---

## 0. Access confirmation (what I could actually verify)

| Tool / surface | Available? | Evidence |
|---|---|---|
| Local filesystem | ✅ | Full read of repo at `C:\Users\pgold\Documents\CatchComics\catch-comics` |
| `git` + history | ✅ | `git version 2.54.0`; repo IS a git repo; 293 commits scanned |
| `gh` (GitHub CLI) | ❌ **not installed** | `gh: command not found` |
| GitHub repo (read, unauth) | ✅ partial | Public API: repo is `pgoldenj-wq/catch-comics-v2`, **`"private": false` / `"visibility": "public"`**, `pushed_at` 2026-07-05 |
| `vercel` CLI | ✅ **authed** | `vercel whoami` → `pgoldenj-wq`; `vercel project ls` + `vercel env ls` succeeded |
| Production HTTP probing | ✅ | Direct `curl` against `https://www.catchcomics.com` |
| Vercel dashboard settings (Spend Mgmt, Deployment Protection, "Sensitive" flags) | ❌ | CLI cannot read these → **NOT VERIFIED checklist** |
| GitHub org settings (Dependabot / CodeQL / secret scanning / branch protection) | ❌ | No `gh`, no `.github/` in repo → **NOT VERIFIED checklist** |

**Honesty note:** Anything I could not directly observe is in **§ NOT VERIFIED** and is neither a confirmed vulnerability nor a confirmed pass. No secret values are printed anywhere in this report.

---

## Executive summary

| Severity | Count | Items |
|---|---|---|
| 🔴 CRITICAL | **0** | — |
| 🟠 HIGH | **1** | H1 (no rate limiting on unauthenticated endpoints that trigger paid external APIs) |
| 🟡 MEDIUM | **7** | M1 JSON-LD XSS · M2 missing security headers / no CSP · M3 public-repo info disclosure · M4 dependency vulns + no GitHub scanning · M5 unbounded pagination · M6 admin-auth hardening · M7 image-optimizer cost |
| 🟢 LOW | **4** | L1 `/go` destination allowlist · L2 error-string disclosure · L3 `/api/log-error` abuse · L4 base64 admin cookie |

**Headline results (verified):**
- ✅ **No secrets are committed to git.** History scan of all 293 commits found no API keys, DB URLs, tokens, or passwords. `.env.local` was never committed.
- ✅ **No secrets leak into the client bundle** except the *intentionally public* `NEXT_PUBLIC_` Amazon associate tags (these appear in affiliate URLs by design — not secrets).
- ✅ **Founder tools are NOT reachable in production** — `smoke-test-v4.html`, `mission-control.html`, `dashboard.html`, and all `launch/*.json` return **HTTP 404** on `catchcomics.com`.
- ✅ **Admin routes are gated in production** — `proxy.ts` (Next 16 middleware) redirects `/admin` and `/api/admin/*` to `/admin/login` (verified live 307).
- ✅ **No SQL injection** in request paths — all runtime raw SQL uses Prisma tagged templates (parameterised). `$queryRawUnsafe` appears only in `scripts/`.
- ✅ **Inngest webhook is signature-verified** — `INNGEST_SIGNING_KEY` set in Production and Preview (Vercel CLI).
- ✅ **No open image-proxy SSRF** — `/_next/image` returns 400 for non-allowlisted hosts.

**There is no exposed-secret finding and no confirmed CRITICAL vulnerability.** The open items are hardening gaps and cost/abuse exposure, not an active compromise.

---

## Verified findings

### 🟠 HIGH

#### H1 — No rate limiting on unauthenticated endpoints that trigger paid external APIs / DB load (cost + DoS abuse)
**Evidence:** No `middleware`/route rate limiting exists. `@vercel/kv` is installed but only used as a *cache* — grep for `Ratelimit`/`kv.` shows no limiter. Unauthenticated public routes:
- `app/api/ebay/route.ts:60` — live eBay Browse API call. Cached 1h per key (`ebayProductCache`, line 31), **but the cache key includes the user-supplied `title`** (line 72), so varying `title` busts the cache and drives fresh paid API calls.
- `app/api/autocomplete/route.ts` — can reach ComicVine (`cvFetch`) when local results are sparse; fires per keystroke.
- `app/api/search/route.ts:370-372` — reaches ComicVine on DB-fallback path.
- `app/api/log-error/route.ts:22` — unauthenticated log write (Vercel log ingestion cost).
- `app/go/[id]/route.ts`, `app/api/prices`, `app/api/homepage-deals`, `app/api/series-preview` — all unauthenticated DB reads.

**Why HIGH:** A solo pre-launch founder is directly exposed to bill run-up. An attacker (or a badly-behaved bot) can script `/api/ebay?title=<random>` to hammer eBay, ComicVine, and Vercel functions with no throttle. This maps exactly to your stated cost-protection concern.
**Mitigations already present (reduce but don't remove risk):** ComicVine circuit breaker (`lib/comicvine.ts:32-70`), 8s CV timeout, KV cache provisioned in prod, `api_usage_log` table (`prisma/schema.prisma:308` — audit only, does **not** block), production search is DB-first (`app/api/search/route.ts:286-311`), `robots.txt` disallows `/api/`, `/admin/`, `/go/` (`app/robots.ts:22`).
**Reference:** OWASP ASVS 11.1.4 (anti-automation), OWASP API Security Top 10 API4:2023 (Unrestricted Resource Consumption).
**Proposed fix (Phase 2):** KV-backed fixed-window limiter (you already have KV) applied to `ebay`, `autocomplete`, `search`, `log-error` — per-IP, generous limits (e.g. 30/min autocomplete, 10/min eBay), returns 429. Low white-screen risk since it only touches API routes, not page rendering. **Flagged as live-request-path — deploy carefully / behind a kill-switch env var.**

---

### 🟡 MEDIUM

#### M1 — Stored-XSS via unescaped JSON-LD (`JSON.stringify` in a `<script>` block)
**Evidence:**
- `app/product/[slug]/page.tsx:539` — `dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}` where `jsonLd.name = product.title`, `jsonLd.description = product.description`, `publisher.name`, and each offer's `seller.name = l.retailer.name` (lines 485-516).
- Same pattern: `app/series/page.tsx:81`, `app/series/[slug]/page.tsx:110` and `:114`.

`JSON.stringify` does **not** escape `<`, `>`, or `/`. A product/series title or description containing `</script><script>…` breaks out of the JSON-LD block and executes in the victim's browser.
**Why MEDIUM (not HIGH today):** the injected fields come from ComicVine/retailer feeds and the DB, not from end-users — so exploitation needs a poisoned upstream title. **This becomes HIGH the moment user-generated content (reviews, collections, community features) feeds any JSON-LD or HTML.**
**Reference:** OWASP XSS Prevention Cheat Sheet ("Safely embedding JSON in HTML"); Next.js data-security guidance.
**Proposed fix:** replace with an escaping serializer, e.g. `JSON.stringify(jsonLd).replace(/</g, '\\u003c').replace(/>/g,'\\u003e').replace(/&/g,'\\u0026')`. Two-line change, no behaviour change, zero white-screen risk.

#### M2 — Missing security response headers / no CSP
**Evidence (live `curl -D -` on `/`):** only `Strict-Transport-Security: max-age=63072000` present. **Absent:** `Content-Security-Policy`, `X-Frame-Options` / `frame-ancestors` (clickjacking), `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`. No `next.config.ts` `headers()` block (`next.config.ts` has only `images`). Root also returns `Access-Control-Allow-Origin: *` (Vercel static default; the JSON API routes do **not** echo an ACAO — verified OPTIONS on `/api/search` returned 204 with no ACAO).
**Why MEDIUM:** these are defence-in-depth controls; the concrete near-term risk is clickjacking/UI-redress on an affiliate-click site. Individually LOW–MEDIUM; grouped here because you explicitly asked for a headers/CSP plan.
**Reference:** OWASP Secure Headers Project; ASVS 14.4; Next.js CSP guidance.
**Proposed fix (staged, per your ground rules):** add static headers (`nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`) via `next.config.ts`, and ship CSP as **`Content-Security-Policy-Report-Only` first** — never a blocking CSP in the same pass.

#### M3 — Internal launch tooling & planning notes committed to a PUBLIC GitHub repo
**Evidence:** repo is public (§0). Tracked in `main` (`git ls-files launch/`): `mission-control.html`, `smoke-test-v4.html`, `smoke-test-v3.html`, `smoke-test.html`, `LAUNCH.md`, `WEEK.md`, `BACKLOG.md`, `war-room-2026-07-03.md`, `founder-review.json`, `smoke-verdict.json`, `metrics-history.json`, `generate-dashboard.js`.
**What is NOT exposed (corrected during audit):** I checked for your personal email — **`pgoldenj@gmail.com` does NOT appear in any committed file** (`git grep` on HEAD = 0 hits). The only email in these tools is `hello@catchcomics.com` (business contact). No secrets/API keys are in them.
**What IS exposed:** your full source tree, the admin-auth mechanism (`proxy.ts`, base64 cookie scheme), env-var *names*, DB schema, and internal launch planning — roadmap, known-issue backlog, go/no-go verdicts, launch date. This is competitive/reputational information disclosure, and it hands an attacker the exact admin-auth design.
**Why MEDIUM:** no secret or PII leak (so not HIGH/CRITICAL), but non-trivial disclosure. Security must not depend on source secrecy — but a public repo raises the bar on everything else (esp. M6 admin auth, and secret-scanning hygiene M4).
**Reference:** OWASP WSTG-INFO; GitHub docs on repo visibility.
**Proposed options (your call):** (a) make the repo private; or (b) accept public source but move `launch/` planning artifacts out of the repo (or into a private submodule). No code change required either way.

#### M4 — Dependency vulnerabilities + no GitHub scanning configured
**Evidence:** `npm audit --omit=dev` → **31 vulnerabilities (15 high, 16 moderate)**, all in `protobufjs` (transitive via `@grpc/proto-loader`, pulled by `@vercel/kv`/telemetry) — DoS advisories GHSA-f38q-mgvj-vph7, GHSA-wcpc-wj8m-hjx6. `fix available via npm audit fix`. No `.github/` directory exists → no Dependabot config, no CodeQL, no Actions.
**Why MEDIUM:** the specific protobufjs issues are JSON-conversion DoS with low exploitability in your request paths, but 15 "high" transitive vulns is poor supply-chain hygiene pre-launch, and a **public repo has no active secret scanning / push protection confirmed**.
**Reference:** OWASP Top 10 A06:2021 (Vulnerable Components); GitHub secret-scanning & Dependabot docs.
**Proposed fix:** run `npm audit fix` (non-breaking), enable Dependabot + secret scanning + push protection (free on public repos) — mostly dashboard toggles → **checklist**.

#### M5 — Unbounded pagination on public search
**Evidence:** `app/api/search/route.ts:296-297` — `page: parseInt(searchParams.get('page') ?? '1')` and `pageSize: parseInt(searchParams.get('pageSize') ?? '20')` are passed to `unifiedSearch` with **no upper bound and no NaN guard**. A request with `pageSize=1000000` (or `page=99999999`) could amplify DB work / response size.
**Why MEDIUM:** DB/response amplification + cost; contributes to H1. (I did not fully trace whether `lib/search` re-clamps `pageSize` internally — **flagged for confirmation**; the call site itself is uncapped.)
**Proposed fix:** clamp `pageSize` to e.g. 1–50 and `page` to a sane max; coerce NaN → default.

#### M6 — Admin authentication is intentionally minimal (single shared password, reversible cookie, no CSRF)
**Evidence:** `app/api/admin/auth/route.ts:18` sets `cc_admin = btoa(ADMIN_PASSWORD)` — base64 (reversible), not a hash. `proxy.ts:41-44` compares the cookie to `btoa(password)` (not constant-time). The POST login (`route.ts:5`) has **no CSRF token**. Cookie flags are good: `httpOnly`, `sameSite:'lax'`, `secure` in prod. `proxy.ts:8` self-documents: *"replace with proper auth … before … making this public-facing."*
**Why MEDIUM:** for a single-founder admin behind a strong password the practical risk is low (httpOnly blocks JS theft; sameSite blocks most CSRF), but the design is fragile and the mechanism is now public (M3). Not launch-blocking.
**Reference:** OWASP ASVS V2/V3 (auth & session); CSRF Prevention Cheat Sheet.
**Proposed fix (post-launch acceptable):** store a random session token server-side / signed cookie rather than base64(password); add constant-time compare; add a CSRF token or `sameSite:'strict'` on the auth POST. Verify `ADMIN_PASSWORD` strength → checklist.

#### M7 — Image optimizer as a cost vector
**Evidence:** `next.config.ts:4-19` allows `/_next/image` optimisation for several remote hosts incl. wildcards `*.r2.dev`, `pub-*.r2.dev`. Host allowlist IS enforced (verified: 400 for `evil.example`), so **no open SSRF**, but Vercel bills image optimisation per transform and the endpoint is unauthenticated/uncached-per-unique-URL.
**Why MEDIUM (cost only):** an attacker can request many unique `w`/`q`/URL combinations to run up image-optimisation usage.
**Proposed fix:** covered by Vercel Spend Management alerts (checklist) + tightening `remotePatterns` to exact R2 host once migration completes.

---

### 🟢 LOW

- **L1 — `/go` redirect has no destination allowlist.** `app/go/[id]/route.ts:108` redirects to `destination` derived from the DB `retailerUrl` (not user input; `id` is UUID-validated at line 28). No SSRF (it only sets a `Location` header, no server-side fetch). Defence-in-depth: validate the final scheme is `http(s)` and host is a known retailer/affiliate domain before redirecting, in case a retailer feed is ever poisoned. Reference: OWASP Unvalidated Redirects & Forwards Cheat Sheet.
- **L2 — Error-string disclosure.** `app/api/ebay/route.ts:123` returns `error: String(err)` to the client. Minor internal-detail leak. Fix: log server-side, return a generic message.
- **L3 — `/api/log-error` abuse.** `app/api/log-error/route.ts` — unauthenticated; writes attacker-controlled strings to server logs (values are truncated 1000/3000 chars and `JSON.stringify`-escaped, so log-injection is contained). Risk is log-flooding / cost — covered by H1 rate limiting.
- **L4 — Base64 admin cookie value.** Folded into M6; listed separately because the cookie value *is* effectively the password (base64-decodable) if it ever leaks — httpOnly mitigates.

---

## Area-by-area results (audit scope coverage)

**1. Secrets & API keys —** ✅ Clean. `.env.local` gitignored (`.gitignore` `.env*`), never committed (history scan clean). `.env.example` holds placeholders only. Client bundle scan (`.next/static`) found only the intentionally-public `NEXT_PUBLIC_AMAZON_*_ASSOCIATE_TAG` values — no server secrets. `logs/` (gitignored) contain no keys. `scripts/.seed-checkpoint.json` is tracked but holds only ISBNs. Second local key `COMIC_VINE_API_KEY_2` exists in `.env.local` only (not in Vercel) — fine. **No rotation required** on evidence seen. See §NOT VERIFIED for the residual "was a secret ever pushed then removed" question (history scan says no).

**2. GitHub posture —** Repo is **public** (verified). No `.github/` → no Actions workflows (so no workflow secret-leak risk), but also no Dependabot/CodeQL config. Dependabot alerts, secret scanning, push protection, branch protection → **NOT VERIFIED checklist** (need `gh`/dashboard).

**3. Vercel / deployment —** All 30+ env vars stored **Encrypted** (verified `vercel env ls`). Production/Preview separation exists. `INNGEST_SIGNING_KEY` set (webhook verified). KV provisioned in prod. Founder tools 404 in prod (verified). `/admin` gated (verified). **NOT VERIFIED:** Spend Management/usage alerts, Deployment Protection on Preview URLs (preview deploys may serve the app with real secrets to anyone with the URL), whether vars are flagged "Sensitive."

**4. Application security —** Covered by H1, M1, M2, M5, M6, L1–L4 above. Input validation is generally decent (UUID check on `/go`, ISBN regexes, platform allowlist on admin create). No `dangerouslySetInnerHTML` on untrusted HTML except the JSON-LD case (M1). CORS not permissive on API routes (verified). No SQL injection (verified). CSP feasibility: achievable but must be **Report-Only first** (M2).

**5. Data & privacy —** No end-user PII collected yet (anonymous `__cc_session` UUID cookie only, `app/go/[id]/route.ts:76`). `click_events` stores `referrer`/`userAgent`/session UUID — pseudonymous. Founder personal email NOT in repo (corrected, §M3). `logs/` and `launch/reviews/` gitignored. Main privacy item is M3 (public planning notes). GDPR: once collections/community/accounts arrive you'll need a lawful basis, the session cookie likely needs a consent/notice check, and `click_events` retention policy — plan pre-feature, not launch-blocking.

**6. Cost protection —** Covered by H1, M5, M7. Positives: DB-first search, eBay 1h cache, CV circuit breaker + timeout, KV cache, `api_usage_log`. Gaps: no request throttle (H1), `api_usage_log` is audit-only (no hard budget cap), cache-bustable eBay key (H1), no Vercel spend alerts confirmed (checklist).

---

## NOT VERIFIED — checklist for you to run (neither pass nor fail)

These require `gh` auth or the GitHub/Vercel dashboards, which this session cannot read. **Do not assume any of these is configured.**

**GitHub (Settings → Code security & analysis):**
- [ ] Secret scanning **enabled** (free on public repos — important since repo is public).
- [ ] Push protection **enabled** (blocks future secret commits).
- [ ] Dependabot **alerts + security updates** enabled.
- [ ] CodeQL / code scanning enabled (optional for this size).
- [ ] Branch protection on `main` (require PR review, status checks) — currently pushing directly to `main`.
- [ ] Decide repo visibility: keep **public** (accept M3) or switch to **private**.

**Vercel (dashboard):**
- [ ] **Spend Management** — set a spend limit + email alert (primary cost backstop for H1/M7).
- [ ] Usage alerts for Function invocations, Edge requests, Image Optimization.
- [ ] **Deployment Protection** on Preview deployments (Vercel Authentication) — prevents anyone with a preview URL from hitting the app with real Production/Preview secrets.
- [ ] Confirm sensitive env vars marked **"Sensitive"** (write-only, can't be re-read in dashboard).
- [ ] Confirm `ADMIN_PASSWORD` is long/random (≥ 20 chars).

---

## Proposed fix plan (for your approval — nothing applied yet)

Grouped by risk of breaking the live site. Per your ground rules: CSP ships **Report-Only first**; anything on the live request path is flagged for extra care.

**Tier A — zero white-screen risk, high value (recommend approving all):**
1. **M1** Escape JSON-LD output on product + both series pages (`<`/`>`/`&`). ~3 one-line edits.
2. **M2** Add static security headers via `next.config.ts` `headers()` (`nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy`, `Permissions-Policy`).
3. **M2** Add `Content-Security-Policy-Report-Only` (non-blocking) + a `/api/csp-report` sink; observe before ever enforcing.
4. **M4** `npm audit fix` (non-breaking transitive bumps) + commit lockfile.
5. **L2** Stop returning `String(err)` to clients on `/api/ebay`.
6. **M5** Clamp `page`/`pageSize` in `/api/search`.

**Tier B — touches live request paths, needs care (recommend, deploy behind kill-switch):**
7. **H1** KV-backed per-IP rate limiter on `ebay`, `autocomplete`, `search`, `log-error` (returns 429; env-var kill-switch so it can be disabled instantly).
8. **L1** `/go` destination scheme/host allowlist (fail-open to the raw URL only for known hosts).

**Tier C — config / process (no app code, mostly you):**
9. **M3** Decide repo visibility / relocate `launch/` planning artifacts.
10. **M4 + Vercel checklist** Enable GitHub secret scanning + push protection + Dependabot; set Vercel Spend Management + Deployment Protection.
11. **M6** Harden admin auth (session token + constant-time compare + CSRF) — **post-launch acceptable**.

---

## Launch security verdict

## 🟡 SAFE WITH KNOWN RISKS

**Justification (tied to counts):** **0 CRITICAL, 1 HIGH, 7 MEDIUM.** The acceptance rule (cannot be SAFE with any open CRITICAL) is satisfied — there is no CRITICAL and no confirmed active compromise: no committed/exposed secrets, no unauthenticated admin mutation, no SQL injection, founder tools not in production, Inngest signed. The single HIGH (H1, rate limiting / cost abuse) and the MEDIUMs are **hardening and cost-exposure gaps**, none of which white-screen the site.

**To move toward a clean "SAFE":** approve **Tier A** (all zero-risk) + **H1 rate limiting** before 2026-07-26, and complete the **Vercel Spend Management** + **GitHub secret-scanning/push-protection** checklist items. M3 (repo visibility) and M6 (admin hardening) are judgment calls that can trail launch.

---

**End of Phase 1. No files were modified. Reply with which findings you want fixed (e.g. "do Tier A + H1") and I'll proceed to Phase 2.**
