---
title: "feat: Catch Comics Discovery Platform — Launch Roadmap"
status: active
created: 2026-06-02
plan_type: feat
---

# feat: Catch Comics Discovery Platform — Launch Roadmap

**Created:** 2026-06-02
**Horizon coverage:** Launch (30–60 days) · Post-Launch (3–6 months) · Long-term (6–12 months)
**Launch definition:** Soft launch to collector communities — Reddit, Discord, Facebook groups.

---

## Summary

Catch Comics has a working price-comparison engine, 5 Series Pages, and a background enrichment pipeline running. The question this roadmap answers: **what is the minimum credible discovery platform for a community soft-launch, and what should the next 12 months look like from there?**

The plan evaluates two launch paths head-to-head and recommends one. It then sequences post-launch and long-term work by user value and build cost — challenging scope at every horizon rather than treating every grilling conclusion as a committed initiative.

The central recommendation: **Option B — build 5 Collection Pages before launch**, not because of feature completeness, but because the editorial thesis is invisible without them. Series Pages prove the utility. Collections prove the platform has a point of view. The community launch audience will ask which one it is.

---

## Problem Frame

### Current state

| Surface | State |
|---|---|
| Price comparison (search + product pages) | Live and functional |
| Series Pages | 5 pages — Walking Dead, FMA, Invincible, Claymore, Overlord |
| CV enrichment | ~1,215 products enriched (2.8%) — growing passively via scheduled task |
| Collection Pages | Not built |
| Character / Creator / Publisher Pages | Not built — deferred |
| Homepage | Top Deals focus; no Series or Collection entry points |

### The decision the roadmap must make

At what point does Catch Comics become worth putting in front of real collectors? And what's the minimum additional work to get there?

The platform is already a functional utility. A collector who knows they want to read The Walking Dead can find every volume with prices from UK retailers. That's useful. The question is whether it's *discovery platform* useful — whether a collector who doesn't know what to read next can be served, and whether the community launch pitch is more than "we have prices."

Two launch paths are evaluated below. The plan takes a position, but frames the case for the alternative so the decision can be made with clear eyes.

---

## Discovery Type Framework

| Type | Name | User state at arrival |
|---|---|---|
| **A** | Serendipitous | Didn't know they wanted this — found it through curation or orbit |
| **B** | Orientation | Knows a franchise exists; needs a starting point or reading order |
| **C** | Continuation | Mid-series; needs what comes next and where to buy it |
| **D** | Commerce | Knows exactly what to buy; finding the best deal across retailers |

**Current coverage:**
- Series Pages address **B**, **C**, and **D** — they serve users who already have an answer.
- Type A (Serendipitous) is the gap. No surface says "you didn't know you wanted this, but you do."

Collection Pages are the primary Type A surface. Character and Creator Pages (deferred) are Type A at deeper coverage. Without any Type A surface, the platform's claim to be a discovery platform rests entirely on whether users happen to arrive not-knowing and leave knowing — which is hard to engineer through price comparison alone.

---

## The Launch Decision: Option A vs. Option B

This is the central decision. Everything else in the launch horizon follows from it.

---

### Option A: Expand Series Pages, then launch

**What ships:** Series Registry expanded from 5 to 25–30 high-quality series across DC, Marvel, Image, manga, and Vertigo. A `/series` index page. Updated homepage navigation.

**What this delivers:**
- Strong B, C, and D discovery for a meaningful breadth of series
- Low build cost — registry additions are trivial; the bottleneck is editorial curation and CV data verification
- Real user feedback within 30–60 days without any new page type

**What this lacks:**
- Type A (Serendipitous) discovery: a user who doesn't know which series they want has no editorial entry point
- An answer to: "how is this different from LOCG or just searching ComicVine?"

**The community launch pitch under Option A:**
> "We built reading order pages for 30 series across DC, Image, Marvel, and manga — with live prices across UK retailers on every volume. Here's The Walking Dead: [link]."

**The honest risk:** Sophisticated collectors in Reddit and Discord communities will recognise this as series navigation + price comparison. The engagement hooks — "what would you add?", "what's your reading order?" — are there, but the platform doesn't demonstrate a curatorial voice. The response is polite interest, not advocacy.

---

### Option B: Build Collection Pages before launch

**What ships:** Same Series expansion, PLUS a Collection Page MVP — 5 editorially-curated thematic lists using the same registry pattern as Series Pages.

**What this delivers:**
- Type A and B discovery: an editorial surface that says Catch Comics has a point of view
- A launch pitch with a curatorial hook, not just a utility claim
- The "editorially-selected, data-generated" thesis made visible from day one

**Architecture cost:** Low. The Collection Page follows the exact same registry pattern as Series Pages — `lib/collections/registry.ts` + `/collections/[slug]` + a simple curated product grid. One day of engineering. The cost is entirely editorial: curating 5 collections with genuine voice takes 3–5 hours each, or roughly one working week of focused content work.

**The community launch pitch under Option B:**
> "We curated the essential Batman reading list — from Year One to Absolute Batman, with prices across UK retailers on every trade. Plus reading orders for 30 series. [link]"

**The honest risk:** 1–2 extra weeks before launch. Pre-launch editorial decisions are guesses. The 5 collections chosen before seeing any user data may be the wrong 5.

---

### Recommendation: Option B — minimum viable scope

**Ship 5 Collection Pages before launch.**

**Why:**

1. **The target persona needs Type A discovery.** The engaged uncertain collector — the person who researches, opens 12 tabs, and still feels friction — doesn't arrive via "[Series] reading order." They arrive via "best Batman comics" or "where do I start with comics." Series Pages serve users who already have an answer. Collections serve users who have a question. The target persona has a question.

2. **The community launch pitch needs an editorial hook.** Posting in r/comicbooks with a price comparison tool generates polite interest. Posting with "here's our curated Batman reading list and here's why we ordered it this way" generates replies, shares, and saves. Collector communities have opinions about editorial choices — that's the engagement surface.

3. **The architecture is already free.** The Series Page registry pattern is proven and trivially extensible. Building the Collection Page equivalent is one day of engineering. The risk is not technical — it's editorial.

4. **5 collections is the right scope.** Not 10. Five tight, opinionated, well-justified collections prove the thesis without requiring three weeks of content work. The remaining collections come in the first post-launch sprint, informed by which ones generate engagement.

5. **Launching without Type A is a positioning risk, not just a feature gap.** The product strategy names "discovery platform first, utility second" as the fundamental positioning. Launching with only Series Pages inverts that — the product is utility-first, and discovery is implied rather than demonstrated.

**The case for Option A:** If the goal is to gather feedback as quickly as possible and iterate, Option A is defensible. Getting real collectors using the product two weeks earlier produces real learning. If the editorial work is a genuine bottleneck (no one to write the collection intros), Option A is the right call. The plan recommends Option B because the editorial capacity exists — if it doesn't, revert to Option A without hesitation.

---

## Launch Horizon: 30–60 days

---

### U1. Series Quality Expansion (5 → 25–30 series)

**Why it exists:** 5 Series Pages is a proof of concept. 25–30 is a product. The expansion demonstrates breadth across DC, Marvel, Image, manga, and Vertigo so the community launch is credible to collectors across all tastes.

**User problem solved:** "I've heard of [series] — where do I start, what comes next, and how much does each volume cost?"

**Discovery types:** B (orientation), C (continuation), D (commerce)

**Dependencies:** Each added series requires collected-edition products (TPB/Hardcover/Omnibus) already in the DB with correct `comicvine_id` and `volumeNumber`. Before adding a series to the registry, confirm their existence via a direct DB query (e.g. `SELECT * FROM canonical_products WHERE series_name ILIKE '%[Series]%' AND format != 'SINGLE_ISSUE'`). Do not use `ingest-cv-series` for this — that script inserts SINGLE_ISSUE rows only, which the Series Page query explicitly excludes. The collected editions must arrive via retailer feed syncs. Vol. 1 must have pricing from ≥2 UK retailers.

**Estimated effort:** Very low per series (5–10 minutes to add registry entry). Editorial work is the constraint: choosing the right series and verifying data quality takes 30–60 minutes per entry.

**Quality bar — more important than the count:**
- ≥3 collected-edition products with correct `comicvine_id` and `volumeNumber`
- ≥2 UK retailers with a live price on Vol. 1
- At least one product with a valid `cv_metadata.synopsis` for the description
- Correct ascending `volumeNumber` ordering (audit the sort before publishing)

**Recommended additions by tier:**

*Tier 1 — highest confidence, run first:*
Saga (Image), Watchmen (DC), The Sandman (DC/Vertigo), Y: The Last Man (DC/Vertigo),
Preacher (DC/Vertigo), V for Vendetta (DC), The Boys (Dynamite), Locke & Key (IDW),
Berserk (Dark Horse), Akira (Kodansha), Vagabond (Viz Media), Attack on Titan (Kodansha)

*Tier 2 — verify data before adding:*
Batman by Scott Snyder (DC — Court of Owls arc), Dark Knight Returns (DC),
All-Star Superman (DC), Spawn (Image), Amazing Spider-Man (classic run),
Neon Genesis Evangelion (Viz), Vinland Saga (Kodansha), Uzumaki (Viz)

**Do not add** any series where `volumeNumber` values are missing or wrong, or where fewer than 2 retailers have Vol. 1 priced. An incomplete series page is worse than no series page.

**Success metric:** 25–30 series pages live. Each passes the quality bar. At least one result per page appearing in Google Search Console within 2 weeks of launch.

---

### U2. /series Index Page

**Why it exists:** 25–30 series pages with no index is a maze. Users and crawlers need a structured entry point.

**User problem solved:** "What series does Catch Comics cover?" and "Let me browse and find something I recognise."

**Discovery types:** B (orientation), A (serendipitous — scanning a grid of series titles may surface one the user didn't know they wanted)

**Dependencies:** U1 (the expanded registry determines the content)

**Estimated effort:** Very low — static page rendering from `SERIES_REGISTRY`, grouped by publisher or broad category.

**Implementation note:** Update `app/sitemap.ts` to include the `/series` index and all `/series/[slug]` entries sourced from `SERIES_REGISTRY`. The 5 existing Series Pages are also not yet in the sitemap — this update covers all of them. Without sitemap inclusion, Google depends on crawling internal links, which don't exist until U4 ships.

**Success metric:** `/series` accessible from the homepage, all series linked, browsable on mobile without horizontal scrolling.

---

### U3. Collection Pages MVP (5 collections)

**Why it exists:** Collections are the Type A discovery surface and the editorial thesis made tangible. Five collections at launch demonstrate that Catch Comics has curatorial intent, not just data. See the full collection design and selection rationale below.

**User problem solved:** "I want to get into [franchise/theme/character] but don't know where to start" — needs an opinionated, ranked entry point with prices attached.

**Discovery types:** A (serendipitous — discovering titles in this editorial orbit), B (orientation — editorial guidance on where to start)

**Architecture:** Mirror `lib/series/registry.ts` exactly. New file `lib/collections/registry.ts` with a `COLLECTIONS_REGISTRY` keyed by slug. Each entry holds:
- Editorial title and intro (2–3 paragraphs, genuine voice — not synopses)
- Ordered list of items referencing existing `canonicalSlug` values or `cvVolumeId`
- Optional per-item editorial note explaining why this item is included

New route: `app/collections/[slug]/page.tsx`, rendered at ISR cadence (same as Series Pages). Data fetching queries existing `CanonicalProduct` and `RetailerListing` tables — no schema changes.

Collection items should resolve to individual `CanonicalProduct` rows by `canonicalSlug` (not by `cvVolumeId` — that would pull all editions of a series, producing a different UI shape). The fetch is `prisma.canonicalProduct.findMany({ where: { canonicalSlug: { in: slugs } } })` with listings included, rendering individual product cards in editorial order.

**No admin UI for MVP.** Registry file edited like code. Admin UI deferred to U7.

**Also includes:** the `/collections` index page — static render from `COLLECTIONS_REGISTRY` listing all collections. Update `app/sitemap.ts` to include `/collections` and all `/collections/[slug]` entries.

**Pre-launch sequence:** Run the DB verification audit against every planned anchor item *before* writing editorial copy. For each item, confirm `canonicalSlug` exists with at least one live `RetailerListing`. Writing 5 collection intros around items that turn out to be missing from the DB requires editorial rework — audit first, write second.

**Success metric:** 5 collection pages live (plus /collections index), each with 5–12 items showing live prices, accessible from the homepage. Google Search Console impressions on target queries within 4 weeks.

---

### U4. Homepage and Navigation Update

**Why it exists:** The homepage currently leads with Top Deals. With Series Pages and Collections live, a new visitor should immediately understand this is a discovery platform, not a deals aggregator.

**User problem solved:** First-time visitors should leave knowing what the product is in under 10 seconds.

**Discovery types:** A, B, D

**Dependencies:** U1, U2, U3 — nothing to point to until they're live

**Estimated effort:** Low — UI changes to homepage and navbar to expose `/series` and `/collections` entry points with brief descriptive copy.

**Success metric:** `/series` and `/collections` accessible within one click from the homepage. Series and Collections visible in the first viewport on desktop without scrolling.

---

## Post-Launch Horizon: 3–6 months

---

### U5. Expand Collections to 15–20 (data-driven)

**Why it exists:** The 5 launch collections are editorial bets. Post-launch analytics will show which collection topics generate engagement, which items are clicked, and what search queries arrive. Expand based on that signal — not based on what seemed like good ideas before launch.

**User problem solved:** Continued Type A editorial guidance as the catalogue grows and user intent becomes understood.

**Discovery types:** A (primary), B

**Dependencies:** U3 live + 4–6 weeks of Google Search Console data and click data from launch

**Estimated effort:** Low per collection once the registry pattern is established. The bottleneck is editorial, not engineering.

**Success metric:** Collections contributing measurable organic impressions in GSC within 60 days of going live; at least 2 collections appearing on page 1 for target queries.

---

### U6. Series Pages 30 → 50+ (demand-driven)

**Why it exists:** The launch set of 25–30 covers the most-searched series. Post-launch search data reveals the gaps — series users are arriving for that aren't covered yet.

**User problem solved:** Coverage for long-tail series queries that arrive after launch.

**Discovery types:** B, C, D

**Dependencies:** CV enrichment pipeline reaching ~15–20% catalogue coverage (more products enriched = more series become viable without manual ingest)

**Estimated effort:** Very low per series. The bottleneck is data quality (enrichment coverage per series) not engineering.

**Challenge this:** Don't expand to 50 mechanically. Each new series should meet the same quality bar as the launch set. 40 quality series pages are better than 70 thin ones.

**Success metric:** 50+ series pages live, series pages appearing in GSC for "[series name] reading order" queries.

---

### U7. Collection Registry 2.0 — Database-Backed

**Why it exists:** At 25+ collections, a TypeScript registry file requires a code deploy for every editorial change — adding an item, fixing a typo, reordering entries. This initiative moves collections to a DB-backed model with a basic admin interface.

**User problem solved:** Editorial velocity — updates without engineering involvement.

**Discovery types:** Infrastructure improvement; enables all types indirectly

**Dependencies:** U3 + U5 (registry pattern proven, collection count approaching painful threshold); existing admin auth at `/admin`

**Schema change:** New `Collection` table and `CollectionItem` table. Migration from TypeScript registry via seed script.

**Challenge this:** This is only needed when the pain of deploying for content changes is real. With a single editor and 20–25 collections, a registry file is fine. Don't build the admin UI until you feel the friction. If the edit/deploy cycle takes 10 minutes and happens twice a week, that's not painful enough to justify a full admin interface. Revisit when it's happening daily.

**Estimated effort:** High — DB schema change, admin UI, migration.

**Success metric:** Non-technical editor can add and update collections without a code deploy.

---

### U8. Price Alert — First Habit-Forming Feature

**Why it exists:** Price comparison is a single-session utility. A price alert creates a reason to return. This is the first step on the Utility → Habit ladder: "You watched this — it just dropped to £12.99 at Forbidden Planet."

**User problem solved:** "I want to buy this when the price drops — remind me."

**Discovery types:** D (commerce), but habit formation increases return visits that enable all other discovery types

**Dependencies:** A user identity layer — at minimum, an email-only opt-in with no account required. Do not build full auth just for alerts.

**Challenge this:** Don't build this pre-launch or in the first post-launch month. Validate the demand first. Launch, get collectors using the product, and check: are users asking "can you alert me when this goes on sale?" in community posts? If yes, build it. If not, the demand may be lower than assumed. The Utility → Habit ladder requires real utility usage to be established before adding habit mechanics.

**Estimated effort:** High — even a lightweight email-only alert requires a scheduler, delivery, and deduplication.

**Success metric:** X% of product page visitors opt into at least one alert; alert email open rate ≥ 35%.

---

### U9. SEO Infrastructure Pass

**Why it exists:** With 50+ series pages and 15–20 collections indexed, there are enough landing pages to justify systematic optimisation — structured data audit, internal linking, sitemap generation, Core Web Vitals.

**User problem solved:** Organic search acquisition — collectors arriving from Google searching for reading orders and recommendations.

**Discovery types:** All types, by determining which users arrive and via which queries

**Dependencies:** Enough indexed pages to produce meaningful GSC data (U1–U6 complete, 4–6 weeks post-launch)

**Estimated effort:** Medium — audit and targeted fixes, not a rebuild. Series Pages already have BookSeries + ItemList JSON-LD.

**Internal linking strategy:** Collections should link to Series Pages for any series they feature. Series Pages should link to Collections that include content from that series ("This series appears in: Essential Vertigo"). This creates a discovery graph between surfaces and distributes link equity.

**Success metric:** Series and Collection pages appearing for target queries in GSC. Organic impressions growing month-over-month within 90 days of the optimisation pass.

---

## Long-Term Horizon: 6–12 months

---

### U10. Wishlist / Collection Tracking

**Why it exists:** This is the pivotal moment on the Utility → Habit → Identity ladder. "Want this / Own this" tracking turns the catalogue from a reference into a collector's personal record. The collection stops being data and starts being identity.

**User problem solved:** "I want to track what I've read, what I'm still missing, and what I want next."

**Discovery types:** C (continuation — "what's next in my incomplete run?"), A (serendipitous — completing a collection surfaces adjacent gaps)

**Dependencies:** User identity layer from U8, stable catalogue coverage, real usage post-launch demonstrating return-visit intent

**Challenge this:** Build when retention data shows collectors returning but lacking a reason to invest deeper. Don't build speculatively — the ladder requires habit to be established (from U8 and organic return visits) before adding identity mechanics. Wishlist built before habit is proved is premature.

**Estimated effort:** Very high — identity model, data model, UI, email/notification layer.

**Success metric:** X% of monthly active users have ≥1 wishlist item; meaningful improvement in DAU/MAU ratio vs. pre-wishlist baseline.

---

### U11. Character Pages MVP

**Why it exists:** Character Pages are the richest Type A discovery surface — "I like Batman; what else in his orbit should I read?" CV data stores `characters` in `cv_metadata`. At meaningful enrichment coverage (~30–40% of catalogue), character-aggregated pages become genuinely useful rather than token.

**User problem solved:** Orbit discovery through a character the collector already loves.

**Discovery types:** A (primary), B

**Dependencies:** CV enrichment at ~30–40% coverage. At 2.8% today, a Batman page would surface a handful of products. This gates on data quality, not engineering capacity — do not build Character Pages until enrichment is meaningfully deep.

**Estimated effort:** Medium — new page type following established registry/query patterns, but data freshness management across many series is harder to handle than per-series pages.

**Success metric:** Character pages for the 20 most-searched characters live and indexed, each with ≥10 product results, appearing for "[character] comics" queries.

---

### U12. Creator Pages MVP

**Why it exists:** Creator-orbit discovery ("I loved Grant Morrison's JLA — what else should I read?") is a strong Type A surface for sophisticated collectors. CV `creators` data is already stored in `cv_metadata`.

**User problem solved:** "I've found a writer or artist I love — what have they done that I can buy?"

**Discovery types:** A (primary)

**Dependencies:** CV enrichment at ~30%+ coverage (same gate as U11). Character Pages and Creator Pages share no engineering artifact — both follow the same cv_metadata query pattern the Series Page registry already established. If enrichment data is sufficient for both simultaneously, they can be built in parallel rather than sequenced.

**Estimated effort:** Medium — follows Character Page architecture with creator as the aggregation axis.

**Success metric:** Creator pages for the 25 most-searched writers and artists live; traffic for "[creator name] comics" queries measurable in GSC.

---

### U13. Aggregate Interest Signals

**Why it exists:** "37 collectors are watching this" is trust, social proof, and the first step toward community without forums or chat. It turns anonymous behavioral data into a discovery signal. See strategy: "aggregated anonymous signals — never 'Joe Golden is watching this.'"

**User problem solved:** "Am I the only person interested in this, or is there a community around it?"

**Discovery types:** A (serendipitous — a product watched by 37 collectors is inherently more interesting to discover than one watched by 2)

**Dependencies:** Price alerts (U8) and wishlist (U10) providing behavioral data; meaningful MAU — numbers only become credible when they're large enough to feel real. "2 collectors are watching this" is not compelling.

**Challenge this:** Do not build this before the behavioral signals exist or before MAU is large enough for the numbers to carry weight. At launch-level traffic, aggregate signals will be too small to be useful and may feel like fabricated social proof.

**Estimated effort:** Low-medium UI; High infrastructure (requires behavioral data from U8 + U10 as input).

**Success metric:** Visible on product, series, and collection pages; measurable click-through improvement on pages with high watcher counts vs. control.

---

## Collection Design

### Registry Architecture (MVP)

For launch, the Collection Page uses the same TypeScript registry pattern as Series Pages. One file, `lib/collections/registry.ts`, holds the full collection definition including editorial content. Pages are statically generated via `generateStaticParams` and revalidated via ISR.

No DB changes. No admin UI. Collections reference existing `canonicalSlug` values verified against the DB before publishing.

**When to move to DB-backed (U7):** When editorial updates are happening faster than deploys are comfortable — roughly when collections exceed 25 and are being updated more than once or twice a week. Not before.

### Collection SEO Strategy

Series Pages target navigational and continuation queries:
- `"[series name] reading order"` — user knows the series, wants to navigate it
- `"[series name] complete collection"` — completionist intent

Collection Pages should target **orientation and serendipitous intent**:
- `"best [character] comics"` → Best Batman Stories
- `"where to start with [publisher/imprint]"` → Where to Start with Image Comics
- `"[creator] comics"` → Scott Snyder's Batman
- `"best [genre] comics"` → Best Horror Comics
- `"essential [imprint] comics"` → Essential Vertigo

These are lower-competition than broad comic queries, serve real pre-purchase research intent, and are exactly the kind of question the "engaged uncertain collector" persona is asking.

**JSON-LD:** Use `ItemList` schema for Collection Pages (same as Series Pages already prove works). Each collection item maps to a `ListItem → Book`. This is already proven to index well.

**Internal linking:** Collections link to Series Pages for featured series. Series Pages link back to Collections that include them. This creates a discovery graph between the two surfaces — a series that appears in 3 collections accumulates internal link equity proportionally.

### First 5 Collections for Launch

Each evaluated on: editorial strength (do we have something genuine to say?), data coverage (are the products in the DB with live prices?), search demand (is there a real query to rank for?), and differentiation (does this say something about Catch Comics' voice?).

---

**Collection 1 — Essential Batman: The Stories That Defined the Dark Knight**

*Why:* Batman is the single highest-value editorial entry point for a UK collector. The query "best Batman comics" has sustained, high search demand. More importantly, the spread from Year One (1987) to Absolute Batman (2025) demonstrates the depth of the Catch Comics catalogue. This collection should be opinionated — not "every notable Batman story ever" but "the 8–10 trades that every Batman reader should own, and here's why."

*Target query:* `"best Batman comics"`, `"essential Batman reading list"`

*Anchor items:* Batman: Year One · The Dark Knight Returns · The Killing Joke · Batman: The Long Halloween · Hush · Batman: Court of Owls (Snyder) · Batman: Zero Year (Snyder) · Absolute Batman (Snyder, 2025)

*Editorial hook:* "Each of these stories rewrote what Batman could mean. Read them in publication order and watch one character evolve across 40 years."

---

**Collection 2 — Where to Start with Image Comics**

*Why:* Image Comics is the "indie gateway" answer — the publisher collectors recommend when someone says "I only read Marvel, what else is worth reading?" Walking Dead and Invincible are the two best-enriched series in the current DB. This collection converts the existing strength of those series pages into an editorial statement about a whole publisher.

*Target query:* `"where to start with Image Comics"`, `"best Image Comics series"`

*Anchor items:* The Walking Dead · Invincible · Saga · Spawn · The Boys · Locke & Key

*Editorial hook:* "Image Comics was founded on the idea that creators should own what they make. Every series on this list only exists because Image exists."

---

**Collection 3 — Scott Snyder's Batman: The Complete Arc**

*Why:* Absolute Batman (2024/25) is generating search activity right now. Collectors who've read it want to understand where it sits in Snyder's larger Batman work. A "complete arc" collection captures that intent and connects a new release back to the existing series catalogue. It's also a demonstration that Catch Comics pays attention to what's current — not just archival.

*Target query:* `"scott snyder batman reading order"`, `"absolute batman reading order"`

*Anchor items:* Batman: Court of Owls · Batman: City of Owls · Batman: Death of the Family · Batman: Zero Year · Batman: Endgame · Batman: Superheavy · Absolute Batman

*Editorial hook:* "Snyder and Capullo built their Batman mythology across seven years. Absolute Batman isn't a reboot — it's a culmination. Start at Court of Owls."

---

**Collection 4 — Essential Vertigo: The Comics That Changed What Comics Could Be**

*Why:* Vertigo is the collector credibility signal. A recommendation engine that includes Sandman, Preacher, Y: The Last Man, and Transmetropolitan is signalling to a sophisticated audience that this is a serious curation, not just a popularity contest. This collection also provides a rich editorial opportunity — the Vertigo thesis is genuinely interesting.

*Target query:* `"best Vertigo comics"`, `"essential Vertigo reading list"`

*Anchor items:* Sandman · Preacher · Y: The Last Man · V for Vendetta · Transmetropolitan · American Vampire · The Invisibles · Swamp Thing (Moore)

*Editorial hook:* "Vertigo ran from 1993 to 2019 and published comics that couldn't have been published anywhere else. The imprint is gone. These books are permanent."

---

**Collection 5 — The Best Horror Comics**

*Why:* Horror is the strongest cross-publisher, cross-genre collection because it genuinely surprises. A collector who knows they like The Walking Dead may not know they'd like Uzumaki or From Hell. This collection is the purest Type A discovery play — serendipitous overlap between familiar and unfamiliar.

*Target query:* `"best horror comics"`, `"scary comics to read"`

*Anchor items:* The Walking Dead · Locke & Key · From Hell · Uzumaki · 30 Days of Night · The Department of Truth · Wytches

*Editorial hook:* "Horror comics do something film and prose horror can't — the silence between panels is yours to fill. These are the stories that prove it."

---

**Post-launch collection additions (to be informed by launch data, not pre-decided):**
Neil Gaiman's Comics · Grant Morrison's DC Universe · Where to Start with Marvel · Essential Manga for Comic Readers · The Best Sci-Fi Comics · Brian K. Vaughan's Complete Works

---

## Scope Boundaries

### In scope for launch
- Series Pages expanded to 25–30 high-quality series (U1)
- `/series` index page (U2)
- Collection Pages MVP — 5 collections, registry-based (U3)
- `/collections` index page
- Homepage navigation surfacing both discovery surfaces (U4)

### Deferred to post-launch
- Series Pages 30 → 50+ (demand-driven, not a launch prerequisite)
- Collections 5 → 15–20 (engagement-data-driven)
- Collection Registry 2.0 / admin UI (U7) — build when the deploy-for-content-change pain is real
- Price alerts / wishlist / user identity (U8, U10) — validate demand before building infrastructure
- SEO infrastructure pass (U9) — needs indexed pages and post-launch data first

### Explicitly deferred (grilling decision, not revisiting here)
- Publisher Pages
- Character Pages (U11) — viable only at ~30–40% CV enrichment coverage
- Creator Pages (U12)
- Community features — discussion, public profiles, social graphs

### Outside this product's identity
- VC-scale network-effect features before utility is proven
- Community-first builds before the product earns return visits
- Features that optimise affiliate commission at the expense of editorial trust
- Anything that reverses the positioning hierarchy: discovery first, utility second, community third

### Deferred to follow-up work
- Cover backfill (15,965 null covers) — cleanup-v2 should run first to avoid backfilling soon-to-be-deleted products
- CV enrichment cleanup-v2 pass (expanded NON_COMIC_FLAGS for academic pollution)
- R2 migration checkpoint cleanup

---

## Risks and Dependencies

| Risk | Severity | Mitigation |
|---|---|---|
| New series added to registry but products not enriched → empty or thin pages | High | Run `ingest-cv-series` for each Tier 1 addition before publishing. Enforce quality bar: ≥3 products, ≥2 retailer prices on Vol. 1 |
| Collection items not in DB or prices not live at launch | High | Verify every collection item `canonicalSlug` exists with at least one live listing before publishing. Manual pre-launch audit required |
| Editorial voice in collections reads as generic or SEO-fill | High | Each collection needs a specific POV — an argument, not just a list. "These are the stories that redefined what Batman could be" is an argument. A CV synopsis dump is not |
| Community response: "this is just ComicVine with prices" | Medium | Option B mitigates this by leading with an editorial collection. Option A has no answer to this challenge |
| CV enrichment rate doesn't cover target series by launch | Low | Targeted per-series ingest (`ingest-cv-series`) is fast and bypasses the bulk enrichment queue for priority series |
| Google indexing delay means SEO benefit is invisible at community launch | Low | Community launch doesn't depend on Google ranking. Index the pages now; SEO benefit accrues over 4–8 weeks post-launch. These are separate timelines |
| Collection editorial work blocked by capacity | Medium | If no one is available to write 5 collection intros, revert to Option A. Do not ship collections with AI-generated filler — the editorial voice IS the product |
| `volumeNumber` ordering wrong on newly added series | Medium | Audit the sort output (volumeNumber ASC → releaseDate ASC) manually on each new series page before publishing |

---

## Open Questions

1. **What is the target launch date?** If fewer than 3 weeks away, Option A may be the correct call regardless of this recommendation. The 5-collection editorial work requires 1 focused week. If that week isn't available, launch without Collections.

2. **Who writes the editorial intros for collections?** Each collection needs 2–3 paragraphs of genuine voice — not a CV synopsis, not a list of facts. This is the highest-risk dependency in Option B. If the editorial capacity isn't there, Option A is the right path.

3. **Are the priority series already priced by UK retailers?** The quality bar requires ≥2 retailers with a live price on Vol. 1 for each new series. Worth auditing the Tier 1 addition list against current retailer listings before committing to the expansion set.

4. **How will launch effectiveness be measured?** The soft launch to collector communities should have a defined signal to watch: community post engagement, site visits in the week after posting, return visit rate in the following 2 weeks. Without a measurement plan, the post-launch roadmap has no feedback signal to work from.
