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

```bash
npm run test:browser-trust
```

Proves the honesty model itself: that a browser which cannot start is recorded
as `BLOCKED` and never as product failures, and that a real failed assertion is
never relabelled as an environment problem. Pure functions plus one synthetic
preflight — no browser, no dev server, no network, no database.

---

## Three states, and only three

| Verdict | What was true | What it means |
|---|---|---|
| `PASS` | browser launched · tests ran · every assertion held | the journeys work |
| `FAIL` | browser launched · tests ran · an assertion failed | **Catch Comics has a problem** |
| `BLOCKED` | the browser or the infrastructure never started | **nothing is known about Catch Comics** |

`BLOCKED` covers a Chromium binary that is missing or that this machine cannot
open, a dev server that never comes up, and a target that cannot be reached. It
is deliberately *not* a product verdict: it never counts as a failure, never
appears as a launch blocker, and never moves the readiness score.

Two things enforce it. `scripts/run-e2e.mjs` runs a **preflight** that resolves
the exact executable Playwright will use and separates *absent* (never
downloaded) from *inaccessible* (there, but this process cannot open it) — the
distinction Playwright's own `fs.accessSync()` gate cannot make. And
`tests/e2e/command-centre-reporter.ts` classifies a finished run, so a browser
lost part-way through is still `BLOCKED` rather than a screenful of failures.

A single genuine product failure always outranks any amount of infrastructure
noise: an assertion cannot fail unless a browser ran. See
`tests/e2e/browser-trust-result.mjs`.

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
Trust*, *Open latest report*, *Diagnose with Claude* (copies a sanitised failure
prompt).

**Opening Mission Control never runs Playwright.**

### Run Browser Trust — the local action bridge

*Run Browser Trust* starts a **real** local run. Because Mission Control is a
static page and cannot start a process, `open-command-centre.ps1` also starts a
tiny local bridge: `launch/operations/browser-trust-bridge.mjs`.

The button starts the run, shows *Running…*, refuses repeat clicks, and reloads
the result card automatically when the run finishes — PASS, FAIL or BLOCKED,
truthfully. After a BLOCKED run it becomes **Retry Browser Trust**. If the
bridge is not running the button says so and copies the command instead of
pretending.

The bridge is **not** a command runner. It is deliberately tiny:

| Property | Enforced |
|---|---|
| Binds `127.0.0.1:8319` only | unreachable off this machine |
| Only `GET /status` and `POST /run` | everything else 404 |
| No request body, query or arguments are read | nothing to inject |
| Fixed argv, `shell: false` | no command interpreter involved |
| `Origin` must be the local Command Centre | blocks other pages in your browser |
| Single-flight | a second `/run` while running returns 409 |
| Reports state, timing, exit code, verdict only | no env values, no process output |
| Lives in `launch/` | not part of the Next app; never deployed to Vercel |

Start it standalone if needed: `node launch/operations/browser-trust-bridge.mjs`

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

### Normal development

Before or during UI work:

```bash
npm run test:e2e
```

For interactive debugging:

```bash
npm run test:e2e:ui
```

### Command Centre

Open the Command Centre as usual — it runs no tests on its own. The Browser
Trust card shows the last recorded result and its age.

Use **Run Browser Trust** only when a deliberate local browser check is wanted.

### Pull requests

A successful Vercel Preview triggers Browser Trust automatically.

### Production

```bash
npm run test:e2e:prod
```

after important Production UI deployments, or when Production behaviour is in
doubt.

### When a run fails

Click *Diagnose with Claude* and paste into Claude Code. The prompt carries the
failing test names, project, environment, commit, sanitised errors, page URLs
and artifact paths — and no credentials.

**Never** weaken an assertion to turn a run green. The first thing this suite
found was a genuine 16px horizontal overflow on `/search` at phone width, live
in production — a test that had been softened would have found nothing.

### When a run is BLOCKED

`BLOCKED` means the browser, the dev server or the target never got far enough
for Catch Comics to be tested. **It is not a failure of the product and it never
counts as one** — the card says so, the readiness score ignores it, and the
diagnosis prompt tells Claude to fix the machine rather than the assertions.

Retry first: the run button becomes **Retry Browser Trust**. If it keeps
happening, diagnose the machine.

Why this exists: on 2026-08-18 a run recorded **16 product failures** in 8.5
seconds without ever opening a page. Every one was
`browserType.launch: Executable doesn't exist` — while the executable was on
disk, unchanged since it had last run successfully. Playwright's gate is
`fs.accessSync()`, which returns false for *denied* exactly as it does for
*missing*, so its message cannot tell you which. A run that never started a
browser now says so.

---

## Adding a test

Keep the suite small. Eight tests that always mean something beat forty that
get ignored. Before adding one, ask:

1. Is it a **journey a visitor takes**, not an implementation detail?
2. Will it still pass tomorrow when prices and the catalogue have changed?
3. Is it read-only? If not, it must not carry `@prod-safe`.
4. Could `launch:smoke` answer it with a plain HTTP request instead? If so, put
   it there — it is faster and cheaper.
