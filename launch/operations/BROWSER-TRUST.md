# Browser Trust (Playwright)

**The one question this layer answers:**
*Can a real visitor successfully use the most important journeys in a real browser?*

It does **not** replace anything that already exists. It fills the gap between
"the server returned the right bytes" and "a human looked at it and believed it".

| Layer | Question | How |
|---|---|---|
| `npm run launch:health` | Is the **data** true? | Reads the database directly |
| `npm run launch:smoke` | Do the **routes and APIs** respond honestly? | ~15 plain HTTP requests, no browser |
| **Browser Trust** | Does it **work in a browser**? | Chromium, desktop + mobile, real clicks |
| **Founder Smoke Test V4** | Would a **collector trust it**? | A human being |

---

## Commands

```bash
npm run test:e2e
```

Local. Playwright starts (or reuses) `next dev` on `:3000` and runs the whole
suite against the code you are working on. This reads the real database via
`.env.local` — bounded to one worker, ~8 tests, no retries, no writes.

```bash
npm run test:e2e:ui
```

Same thing, interactive. Watch mode, time-travel through each step, pick single
tests. This is the one to use while writing or debugging a test.

```bash
npm run test:e2e:prod
```

Production, `https://www.catchcomics.com`, **read-only tests only**. Deliberate
and on demand — it is not scheduled.

```bash
npm run test:e2e:report
```

Opens the HTML report from the last local run.

Extra Playwright flags pass straight through:

```bash
npm run test:e2e -- --project=mobile-chromium --headed
```

---

## The eight journeys

| # | Test | Desktop | Mobile |
|---|---|---|---|
| 1 | Homepage loads, no horizontal overflow, navigation visible, no uncaught errors | ✓ | – |
| 2 | A bounded sample of rail covers decode as real images | ✓ | ✓ |
| 3 | Typing "Absolute Batman" produces usable suggestions containing the flagship | ✓ | – |
| 4 | Selecting the flagship result lands on the right product page | ✓ | ✓ |
| 5 | Product page: title, cover, offer state, retailer control, `rel="sponsored"` | ✓ | ✓ |
| 6 | No always-empty Price History panel (W2-1 regression guard) | ✓ | ✓ |
| 7 | Mobile homepage + search journey: usable, nothing clipped or overflowing | – | ✓ |
| 8 | Unknown product URL shows the 404 state, not a crash | ✓ | ✓ |

Projects: `desktop-chromium` (1280×800) and `mobile-chromium` (Pixel 7 profile).
Chromium only — no Firefox, no WebKit.

### What is deliberately NOT asserted

Because it changes hourly and would make the suite lie:

* exact prices or currency amounts
* offer counts, or which retailer is cheapest
* retailer ordering
* catalogue totals or result counts
* Tailwind class names or generated selectors
* screenshot pixel baselines

Locators are accessible roles and names wherever the UI provides them. Exactly
one `data-testid` exists (`deal-cover`), because a rail cover's alt text is the
comic's title and therefore changes with the catalogue.

---

## Production safety

Every test carries the `@prod-safe` tag, and Production and CI runs use
`--grep @prod-safe`. The tag is the enforced gate: a test that writes anything
simply never earns it and therefore never runs outside LOCAL.

The suite does **not**, in any mode:

* call admin routes
* trigger Inngest, enrichment, retailer imports, or event replays
* create accounts or collections, or submit any form that writes
* follow affiliate links (it asserts the retailer link exists; it never clicks it)
* crawl catalogue ranges or visit third-party retailer sites
* touch credentials

A full run is roughly a dozen page loads. `launch:smoke` still performs the one
deliberate affiliate-redirect check; Browser Trust adds none.

**Target hostnames are allowlisted** in `tests/e2e/target.ts`: `catchcomics.com`,
`www.catchcomics.com`, and `catch-comics-*.vercel.app`. `localhost`, raw IPs,
non-HTTPS in CI, and any other domain are rejected *before a browser launches*.
CI validates the URL in a separate early step (`scripts/validate-e2e-target.ts`)
so a bad `workflow_dispatch` input fails in seconds.

---

## CI

`.github/workflows/browser-trust.yml`

* **Automatic:** on `deployment_status` where `state == success` **and**
  `environment == Preview`. Pending, failed, and Production deployments are
  ignored. The job checks out the deployed SHA and tests the deployment's own
  `target_url` — never a guessed Preview URL.
* **Manual:** `workflow_dispatch` with a target URL, for a deliberate
  Production or Preview run.
* **Never scheduled.**
* One worker, one retry, 15-minute cap, Chromium only.
* Duplicate `success` events for the same deployment are collapsed by a
  `concurrency` group keyed on the deployment SHA.
* HTML report + screenshots/traces upload on failure (7-day retention); the
  result JSON always uploads (14 days).

> **Browser Trust is informational, not a required check.** Promote it to a
> required status check only after several consecutive stable runs prove it is
> not flaky.

> **A `deployment_status` workflow only runs from the default branch.** Until
> this file is merged to `main`, the automatic trigger cannot fire for any
> branch — including the branch that adds it. Pre-merge proof therefore comes
> from `workflow_dispatch`.

### ⚠ Preview deployments are currently unreachable — one founder action needed

Vercel **Deployment Protection** is enabled for Preview deployments on this
project. An anonymous request to a Preview URL gets `302 → vercel.com/sso-api`,
so no browser can reach it and **no test can run against a Preview** until this
is changed. The suite detects this and fails immediately with an explanation
rather than eight confusing locator timeouts.

Two ways to fix it — **A is recommended**:

**A. Make Preview deployments public** *(recommended)*
Vercel → Project → Settings → Deployment Protection → **Vercel Authentication:
Disabled** for Preview. These are public catalogue pages with no secrets on
them, it needs no credential anywhere, and it keeps CI traces available.

**B. Protection Bypass for Automation**
Vercel → Settings → Deployment Protection → *Protection Bypass for Automation* →
generate a secret → add it to GitHub → Settings → Secrets → Actions as
`VERCEL_AUTOMATION_BYPASS_SECRET`. The workflow already passes it through.

> If B is used, **Playwright traces are automatically disabled**. Traces record
> request headers verbatim, so leaving them on would write the bypass
> credential into a CI artifact. Screenshots and the result JSON are unaffected.
> This is why A is listed first: it costs nothing and keeps traces.

Until either is done, the automatic Preview run will fail fast with the message
above. `npm run test:e2e` and `npm run test:e2e:prod` are unaffected.

---

## Command Centre

Mission Control shows a **Browser Trust** card fed by
`launch/operations/browser-trust-latest.json`, with three actions: *Run Browser
Trust* (copies the command), *Open latest report*, *Diagnose with Claude*
(copies a sanitised failure prompt).

Opening Mission Control never runs Playwright.

Honesty rules the card enforces:

* no result file → **NOT RUN** (never green)
* any failure → **FAIL**, regardless of age
* a pass older than 48 hours → **STALE**, not PASS
* an interrupted run, or a run where nothing executed, is never upgraded to a pass

The JSON never contains secrets: error text is redacted for connection strings,
JWTs, bearer tokens and `key=value` credential forms, and truncated to 1200
characters.

---

## What Browser Trust does NOT do — still founder-led

Browser Trust can tell you a cover **loaded**. It cannot tell you the cover is
**right**. These Smoke Test V4 checks remain human judgement and are not
automated by this suite:

| V4 area | Status |
|---|---|
| Cover Quality — is this the correct edition's cover? | **Founder** |
| Product Pages — is this the right product identity? | **Founder** |
| Suspicious creators / publishers / metadata | **Founder** |
| Visual polish and subjective trust | **Founder** |
| Recommendations — is "You might also like" sensible? | **Founder** |
| Series Pages — is the reading order correct? | **Founder** |
| Discovery quality overall | **Founder** |
| Mobile on a **physical phone** | **Founder** (emulation is not this check) |
| Affiliate Flows — end-to-end click through to a retailer | **Founder** + `launch:smoke` |
| Homepage / Search / Product / Errors — do they *function*? | **Partly automated** here |
| Loading states, route transitions | **Founder** |

The Mission Control ops item *"Confirm issue-grid covers and tap behaviour on a
physical phone"* is explicitly **not** discharged by `mobile-chromium`. A Pixel 7
device profile is Chromium with a phone-shaped viewport and a touch flag; it is
not a phone.

---

## Founder workflow

**Day to day** — nothing changes. Open the Command Centre as usual; the Browser
Trust card shows the last recorded result and its age.

**Before pushing a UI change** — `npm run test:e2e`. About a minute.

**On a pull request** — the Preview deployment triggers Browser Trust
automatically. Red is informational for now; read it, do not merge past a real
failure.

**If something looks wrong in production** — `npm run test:e2e:prod`.

**When a run fails** — click *Diagnose with Claude* in the Command Centre, paste
into Claude Code. The prompt carries the failing test names, environment,
commit, sanitised errors, page URLs and artifact paths.

**Never** weaken an assertion to turn a run green. The first thing this suite
found was a genuine 16px horizontal overflow on `/search` at phone width, live
in production — a test that had been softened would have found nothing.

---

## Adding a test

Keep the suite small. Eight tests that always mean something beat forty that
get ignored. Before adding one, ask:

1. Is it a **journey a visitor takes**, not an implementation detail?
2. Will it still pass tomorrow when prices and the catalogue have changed?
3. Is it read-only? If not, it must not carry `@prod-safe`.
4. Could `launch:smoke` answer it with a plain HTTP request instead? If so, put
   it there — it is faster and cheaper.
