@AGENTS.md

# Catch Comics — Project Guide for Claude Code

Catch Comics is a comic book discovery and price comparison platform.
Strategic framing: **comic database first, price comparison second.**
The retailer/pricing layer attaches to canonical comic records; it does
not define them. Treat every change with that priority order in mind.

Production: https://www.catchcomics.com (Vercel, branch `main`)
Staging:    Vercel preview from branch `dev`

---

## Operating rules — read first, every session

These are BLOCKING. They apply to every interaction, every subagent,
every Compound Engineering command. They are not overridable by repo
conventions, prompts, or "obvious" assumptions.

1. **Diagnose before reading.** Use targeted reads. Do not Glob the
   whole repo or Grep across `node_modules/`. If a single file would
   answer the question, read that file.
2. **No git operations without explicit approval.** Never `git commit`,
   `git push`, `git tag`, open a PR, or deploy to Vercel without the
   user typing "approve commit", "approve push", "approve deploy", or
   an equivalent unambiguous signal.
3. **No broad architecture changes.** Schema migrations, route
   restructuring, scoring formula edits, search-query rewrites, and
   anything in the hands-off list below require explicit instruction.
4. **Protect token usage.** Don't read large files in full when a
   range will do. Don't re-read files already in conversation context.
   Avoid spawning subagents to do work the parent can finish.
5. **Protect API spend.** ComicVine has a 200/hr cap. Rainforest is
   pay-per-call. Don't write scripts that hit paid APIs in loops
   without confirming rate limits and approval.
6. **Local-first.** Test on `localhost:3000` before pushing. The user
   demos and ships from production; visible breakage there matters.
7. **Priority order when trading off:** revenue → SEO → data quality
   → user trust → engineering effort. If a refactor would slow a
   revenue-positive ship, defer it.

---

## Hands-off list — DO NOT TOUCH without explicit instruction

| Area | Why |
|---|---|
| Pricing layer (`OffersTable`, retailer_listings writes, AWIN wrapping) | Revenue-critical |
| `/go/[id]` redirect and click logging | Affiliate attribution + analytics |
| `prisma/schema.prisma` | Schema is shared with running jobs |
| `lib/search/score.ts` formula and weights | Database-first scoring is deliberate |
| `lib/search/queryA.ts` SQL | Performance-tuned, FTS+trgm |
| `next.config.ts` remotePatterns | Wrong patterns break covers in prod |
| Sitemap, robots, structured-data, GSC | SEO-critical, slow to recover |
| ISR `revalidate` constants on product pages | Performance + cost |
| `.env.local` | Never read, never write, never commit |
| Anything under `node_modules/` | Read-only library code |

---

## Active background jobs

A long-running ComicVine enrichment job (`npm run enrich:catalogue:full`)
may be active at any time, writing to `canonical_products`. Its
checkpoint file(s) are in the `scripts/` directory. These rules always
apply:

- **NEVER delete, modify, or reset checkpoint files without explicit
  instruction.**
- **NEVER run a competing script that writes to `canonical_products`
  while enrichment may be running** (cleanup v2, backfill, ingest)
  without explicit instruction to do so.
- **Before any script that writes to `canonical_products`: check
  whether the enrichment job is currently running**
  (`npm run enrich:catalogue:report`).
- **The enrichment is a multi-day, resumable job — a rogue parallel
  write is the highest-risk operation in the repo right now.**

Checkpoint files (all under `scripts/`, all gitignored):
- `.enrich-catalogue-checkpoint.json` — the enrichment job
- `.backfill-covers-checkpoint.json` — Open Library cover backfill
- `.cover-migration-checkpoint.json` — historical R2 migration (idle)
- `.enrichment-test-snapshot.json` — pre-test snapshots for restore

If you must inspect a checkpoint, READ it. Do not write.

---

## Stack snapshot

| Layer | Tech |
|---|---|
| Framework | Next.js 16.2.4 (App Router) — see AGENTS.md for the version warning |
| UI | React 19.2.4, Tailwind CSS v4 |
| Language | TypeScript 5 (strict) |
| ORM | Prisma 5.22 |
| Database | Neon Postgres (serverless; expect occasional connection drops) |
| Hosting | Vercel — single project `catch-comics-v2` |
| Object storage | Cloudflare R2, custom domain `images.catchcomics.com` |
| External APIs | ComicVine (200/hr), Open Library (free), Google Books (free), Rainforest/Amazon (paid, key NOT set in prod), eBay (Browse API), AWIN (affiliate) |

Modern Next.js details: read `node_modules/next/dist/docs/` (AGENTS.md
already directs to this; many APIs differ from training data).

---

## Repo layout — where things live

```
app/
  page.tsx                 - Homepage + Top Deals
  search/page.tsx          - Search results
  product/[slug]/page.tsx  - Product detail page (umbrella + nested issues)
  comic/[id]/page.tsx      - Legacy CV-id page
  go/[id]/route.ts         - Affiliate redirect (HANDS OFF)
  api/                     - Internal API routes
components/
  CVCoverImage.tsx         - Smart cover with R2/CV/OL fallback
  CVIssuesGrid.tsx         - Issues-in-this-volume grid (CV API)
  CVCharacterTags.tsx      - Character tag chips
  OffersTable.tsx          - Pricing table (HANDS OFF)
  Navbar.tsx               - Shared header
  SearchBar.tsx            - Search input
lib/
  adapters/                - Retailer ingest adapters (Shopify, AWIN, etc.)
  search/                  - queryA/B/C, scoring, types
  images/                  - download, R2 client, url-filters
  comicvine.ts             - CV API client + KV cache
  prisma.ts                - Prisma singleton
prisma/
  schema.prisma            - Source of truth for DB shape
scripts/                   - All operational scripts (see "Run commands")
public/                    - Static assets
```

---

## Run / build / test commands

```bash
# Local dev
npm run dev                  # localhost:3000

# Type check (always run before commit)
npm run check                # tsc --noEmit

# Build
npm run build

# Database
npm run db:push              # Push schema changes (additive only; needs approval)
npm run db:studio            # Prisma Studio

# Enrichment + cleanup (READ "Active background jobs" first)
npm run enrich:catalogue:report          # safe: read-only status
npm run enrich:catalogue:dry             # safe: no DB writes
npm run enrich:catalogue:full            # WRITES — coordinate with running job
npm run cleanup:noncomics:dry            # safe: report only
npm run cleanup:noncomics:execute-a      # WRITES — coordinate
npm run cleanup:noncomics:execute-b-plus # WRITES — coordinate
npm run cleanup:noncomics:execute-c      # WRITES — coordinate
npm run backfill:covers:dry              # safe: count only
npm run backfill:covers                  # WRITES — coordinate
npm run ingest:cv-series                 # WRITES — coordinate
```

Always prefer the `:dry` / `:report` variant first.

---

## Approved territories — touch freely (still no commit without approval)

- UI/UX on `app/product/[slug]/page.tsx`, `app/search/page.tsx`,
  `app/page.tsx` (homepage layout/styling, NOT scoring)
- Components in `components/` (CVCoverImage, CVIssuesGrid, Navbar,
  SearchBar — anything not in the hands-off list)
- New scripts under `scripts/` — additive only, descriptive names,
  must be marked `:dry` if they have a real-write counterpart
- Documentation files (`CLAUDE.md`, `AGENTS.md`, `*.md` in repo root)
- New components, hooks, helpers in `lib/` that don't replace
  existing ones

Anything else: ask first.

---

## Domain glossary

| Term | Meaning |
|---|---|
| `canonical_products` | One row per real-world comic product. Primary entity. |
| `retailer_listings` | A specific product at a specific retailer (eBay UK, World of Books, etc.). FK to canonical_products. |
| `cv_metadata` | JSONB column holding ComicVine creators, characters, synopsis, cv_volume_id, cv_issue_id. Populated by enrichment. |
| Umbrella / collected edition | TPB, OMNIBUS, ABSOLUTE, COMPENDIUM, DELUXE, HARDCOVER, MANGA_VOLUME — products that collect issues |
| Nested / single issue | format=SINGLE_ISSUE — individual issue inside an umbrella |
| Bucket A | Confident non-comic (NON_COMIC_FLAGS match) — safe-to-delete pool |
| Bucket B / B+ | Confident comic wrongly typed as OTHER (B+ = strong publisher signal) — reclassify pool |
| Bucket C | Uncertain — keep, manual review |
| R1 / R2 gates | CV matcher rejects: R1 = 1-issue + no-publisher + sim<0.95; R2 = short title + (no-pubOk OR 1 issue) |
| pubOk | "Publisher match" between our DB and CV record — substring-based |
| DYNAMIC_LINK | Retailer ingest pattern: ISBN → templated URL → /go redirect → AWIN wrap |

---

## API cost guardrails

| API | Cost | Rate budget |
|---|---|---|
| ComicVine | Free, 200/hr cap | Scripts default to 25s/call (~144/hr) + 60s backoff on HTTP 420 |
| Open Library | Free, no docs cap | Be polite: 1s delay between calls |
| Google Books | Free, soft cap | Currently used only via enrichment fallback chain |
| Amazon Rainforest | PAID per call | `RAINFOREST_API_KEY` not set in prod. Don't enable casually. |
| eBay Browse | Free with key | Used in queryC for live results |
| AWIN | Free | Affiliate URL wrapping only |

If you write a script that calls a paid API in a loop, surface the
estimated request count + cost BEFORE running, and require approval.

---

## Where the current state lives

This CLAUDE.md is stable repo-committed guidance. **Drift-y facts**
(current product counts, in-flight cleanup state, recent commits,
scheduled-task status) live in the session memory file:

```
~/.claude/projects/<project-slug>/memory/project_catch_comics.md
```

That file is rewritten as the project evolves. When you need the
latest catalogue size, the running enrichment status, or which
scripts have been run, consult it. When you need stack/conventions/
rules, this file is enough.

---

## Brand and design tokens

| Token | Value | Use |
|---|---|---|
| Primary brand | `#E8272A` (red) | CTAs, accents, hover |
| Near-black | `#0A0A0A` | Body text, headings |
| White | `#FFFFFF` | Background |
| Font | Inter (system fallback) | All UI |
| Card radius | `rounded-xl` / `rounded-lg` | Be consistent within a surface |
| Cover aspect | `2/3` | All comic covers |

Editorial feel: Discogs-style information clarity, Apple/Google
simplicity, large crisp covers, generous spacing. Pricing is secondary
to the comic data.

---

## Compound Engineering etiquette

CE commands can spawn subagents that read, write, and run code. The
operating rules above apply to every subagent. Specifically:

- A CE subagent must not commit, push, deploy, or run paid-API loops
  on its own initiative. Surface diffs / costs for review.
- Background jobs (enrichment) take priority over CE writes to
  `canonical_products`. Subagents must check `enrich:catalogue:report`
  before writing.
- If a CE command produces a multi-file diff, surface a summary
  (files + line counts + intent) before any git operation.
- Subagents should prefer the `:dry` variant of any script first.

---

## When in doubt

- Ask. The user prefers being asked one extra question over receiving
  an unwanted commit or a CV API exhaustion.
- Prefer the smaller change. The site is in active development for a
  panel demo; do not introduce risk for marginal cleanups.
- Read the file before editing it. Read at most the lines you need.
