# Catch Comics — Discovery Thesis Audit
**Date:** 2026-06-01  
**Scope:** Full product audit against the discovery thesis  
**Thesis:** "LOCG helps collectors manage what they already know. Catch Comics helps collectors discover what they don't know yet."

---

## Verdict

**Catch Comics is currently a price comparison site with growing comic data attached. It is not yet a discovery platform.**

This is not a failure — it is the honest current state. The infrastructure to become a discovery platform is being built (CV enrichment, knowledge graph, product page redesign). But the user experience today does not deliver on the discovery thesis for ~97% of the catalogue, and the 3% that is enriched is not yet surfaced in a way that creates a discovery-first experience.

The specific target user — the **engaged but uncertain collector** asking "what does this collect, what comes next, which edition should I buy" — lands on Catch Comics today and gets price comparison with metadata attached. That is useful. It is not yet discovery.

---

## What Discovery Questions Catch Comics Can Answer Today

| Question | Answered? | Condition |
|---|---|---|
| Where's the cheapest copy of [title I already know]? | ✅ Yes | Any product with listings |
| What format is this available in? | ✅ Yes | All products |
| Who made this? | ✅ Yes — for enriched only | ~3% of catalogue |
| What characters appear in this? | ✅ Yes — for enriched only | ~3% of catalogue |
| What's the synopsis? | ✅ Yes — for enriched only | ~3% of catalogue |
| What issues does this collect? | ⚠️ Partially — for enriched only | ~3% of catalogue |
| What other issues are in this series? | ⚠️ Partially — for enriched only | ~3% of catalogue |
| Has the price dropped recently? | ✅ Yes | Products with price history |
| What format options exist for this series? | ❌ No | No edition comparison feature |
| What comes next in this series? | ❌ No | No next-volume links anywhere |
| Which edition should I buy? | ❌ No | No edition comparison |
| What's the best starting point for this series? | ❌ No | No reading guides |
| Do I need this if I already own that? | ❌ No | No coverage/overlap tool |
| How does this connect to the wider universe? | ❌ No | No universe/crossover context |
| What should I read next after this? | ❌ No | No recommendation engine |

---

## Homepage Audit

**What it is:** Price comparison entry point with deals carousel and popular search pills.

**What it does well:**
- Clean, visually polished — better UX than most comic sites
- Live deals from DB (when available) are genuinely useful
- Popular search pills give quick access to major properties

**What it fails to do:**
- The headline copy ("Search, compare, save on comics") and tagline ("The world's only comic price comparison") position Catch Comics as a price tool, not a discovery platform. A collector asking "what should I read?" gets no answer from this page.
- Zero discovery prompts. No "New releases this month", no "Good starting points", no "If you liked X try Y", no "This week's most searched series".
- The deals carousel shows covers and prices. It does not ask or answer "what is this?" — a new user sees titles they may not recognise, with no context to help them decide whether to care.
- No editorial layer. No featured series, no curated collections, no "start here" guidance.
- Popular search pills are reactive (Batman, Spider-Man) — they serve users who already know what they want, not users who don't know where to start.

**Conclusion:** The homepage is optimised for the user who already knows what they want to buy. It does nothing for the engaged-but-uncertain collector who is at the discovery stage.

---

## Search Audit

**What it does well:**
- Solid results with covers, format badges, publisher labels
- Format filter pills (Graphic Novels / Single Issues / Manga) are well-positioned
- "Did you mean" spelling correction
- Price-hint sidecars (eBay from-price) on every result
- Format detection from title/publisher is reasonably accurate

**What it fails to do:**
- **No contextual discovery signals.** Search results show: title, format, publisher, year. They do not show: "Volume 1 of 12", "Collects issues #1–6", "Written by Scott Snyder", synopsis excerpt. The result card tells you what the product IS. It doesn't help you decide if you WANT it.
- **No "this is part of a series" signal.** Searching "Absolute Batman" shows multiple results (Vol. 1, Vol. 2, etc.) but there's no "series: 2 volumes" label or hub link that ties them together. A new user doesn't know if they're looking at a complete run or an ongoing series.
- **No reading order context.** Results don't indicate series position. Seeing "Amazing Spider-Man Vol. 3" with no "Volume 3 of the 2022 Wells run, follows Vol. 2" context is unhelpful for someone who doesn't already know the run.
- **Filtering is format-only.** There's no "show me starting points only" or "show me complete series" or "show me recent runs" filter — which are exactly the questions a discovery-oriented user would ask.
- **"You searched for X, here are products named X"** — the results are a lookup engine, not a discovery engine. There's no "because you searched for Absolute Batman, you might also want..." pathway out of the results.

**Conclusion:** Search is a good product-retrieval tool. It is not a discovery tool. It serves the user who knows what they want to find. It does not serve the user who is trying to understand what to read next.

---

## Product Page Audit (`/product/[slug]`)

**What it does well (especially for enriched products):**
- Dark hero with cover, creators, characters, synopsis — editorial feel, well-executed
- IssueListGrid showing issues in the series — partial "what does this collect" answer
- IssueCountLine ("Collects N issues") — useful at a glance
- Price comparison table with retailer breakdown — strong
- Price history sparkline — genuinely useful, "should I buy now or wait" answer
- "Also Available At" chips for dynamic-link retailers
- Format/Publisher/Release Date/Status labeled rows — clean and scannable
- Character tags linking to search — creates pathways out of the page

**What it fails to do:**
- **"What comes next?"** — No next-volume link. A user who finishes reading Absolute Batman Vol. 1 and wants to buy Vol. 2 gets no signal from this page that Vol. 2 exists or how to find it. This is the single largest discovery gap on the product page.
- **"Which edition should I buy?"** — The page shows one product. It doesn't say "this is also available as a softcover TPB at £15 or as part of the Absolute Edition at £45". There's no edition comparison feature. A user who doesn't know the difference between the TPB and the Hardcover gets no guidance.
- **"Do I need this if I already own that?"** — No coverage/overlap indication. If you own Absolute Batman, does it overlap with Batman Vol. 1? No answer.
- **"You Might Also Like" is weak.** The related products query (`getRelated`) matches by `seriesName` OR `publisher + format`. This produces obvious same-series results or publisher-adjacent results, not intelligent recommendations. No "readers who looked at this also looked at..." — because there's no behavioral data yet.
- **"IssueListGrid" is a sidebar feature, not a feature.** On collected-edition pages it lives in the left 240px column, which is secondary. The user's primary question when looking at a collected edition is often "which issues does this actually contain?" — that should be more prominent.
- **No reading order.** The issues grid shows issues in a series, but doesn't indicate "start here", "this comes after", or reading dependencies.

**Conclusion:** The product page is the most discovery-capable surface in the product. For enriched products it begins to answer real questions. The two critical missing pieces are "what comes next" and "which edition should I buy."

---

## Comic/[id] Page Audit

This is the older, CV-based page that the homepage's static deals and some search results still route to. It pre-dates the canonical product architecture.

**What it does:**
- Pulls data directly from CV at runtime (no enrichment pipeline dependency)
- Shows volume or issue metadata from CV: title, publisher, year, issue count, creators, characters, description
- Shows eBay listings via PricingPanel
- Shows issues grid (from CV API) for volumes

**The two-page problem:**
There are now two product experiences:
- `/comic/[id]` — CV-backed, client-side, slower (runtime API call), design-frozen
- `/product/[slug]` — DB-backed, ISR, faster, richer (price history, multi-retailer, better UX)

Some homepage deals still route to `/comic/[id]` (the static TOP_DEALS fallback). Some search results route to `/comic/[id]` when there's no `canonicalSlug`. This creates inconsistency — users may encounter either experience for similar queries.

The `/comic/[id]` page is effectively legacy. It should eventually be superseded by `/product/[slug]` for all catalogue items. As CV enrichment coverage grows, the dependency on the live CV page shrinks.

---

## Information Architecture Audit

**Current IA:**

```
/                     Homepage (deals + search entry)
/search               Search results
/product/[slug]       Canonical product page (enriched)
/comic/[id]           CV-backed page (legacy)
/about, /privacy, /terms
```

**What's missing:**

| Missing Surface | Discovery Value | Why It Matters |
|---|---|---|
| `/series/[slug]` | Critical | No place to understand a series as a whole — all editions, reading order, what each collects, best starting point |
| `/publisher/[slug]` | Medium | No way to browse a publisher's catalogue or understand their publishing approach |
| Reading guide / answer pages | High | "Absolute Batman Reading Order", "Where to start with X-Men" — pages that intercept discovery queries |
| `/character/[slug]` | Medium | No way to find all comics featuring a character |
| Universe/event pages | Low–Medium | For "how does this connect to the wider universe" questions |

**The structural gap:** There is no intermediate layer between "search" and "individual product". A series page would be the most valuable missing layer. When a collector searches "Absolute Batman", what they often want is not a product card — they want to understand the series: how many volumes, what order, what each collects, which edition to start with. None of that exists as a page.

**Navigation:** The navbar has logo + search + region toggle. No browse-by-publisher, no browse-by-format, no editorial sections, no discovery entry points beyond the search bar.

---

## Discovery Workflow Audit

Tracing the "engaged but uncertain collector" through each question they'd arrive with:

### "What does this collect?"
**Workflow:** Search → Product page → Look for IssueListGrid  
**Current outcome:** Works for ~3% of enriched products. For the other 97%, the user sees a cover and price with no content information. **Verdict: Fails for most of the catalogue.**

### "What comes next?"
**Workflow:** Product page → look for next volume link → not found → search again  
**Current outcome:** No next-volume link anywhere in the product. The user must manually search "[series name] Vol. 2" and hope they find the right thing. **Verdict: Fails entirely.**

### "Which edition should I buy?"
**Workflow:** Search → get multiple results (TPB, Hardcover, Absolute) → click each to compare prices → back and forth  
**Current outcome:** The comparison is manual. There's no edition comparison surface. The user can do it themselves via multiple searches + tabs, but Catch Comics offers no help. **Verdict: Fails entirely.**

### "What's the best starting point?"
**Workflow:** Search → see multiple volumes → no signal about which to start with → leave  
**Current outcome:** No "start here" signal anywhere. Series position isn't labeled in search results ("Volume 1 of 4"). No reading guides. **Verdict: Fails entirely.**

### "Where's the cheapest copy?"
**Workflow:** Search → result card → product page → OffersTable  
**Current outcome:** Works well for products with retailer data. Price comparison is the strongest feature. **Verdict: Succeeds.**

### "Has the price changed / should I wait?"
**Workflow:** Product page → Price History sparkline  
**Current outcome:** Works when price history exists. **Verdict: Succeeds.**

---

## Where Catch Comics Outperforms Existing Solutions

1. **Price comparison across multiple retailers** — genuinely better than going to each retailer individually. No other comic site does this.
2. **Clean, modern UX** — easier to read and navigate than LOCG, ComicVine, or most retailer sites.
3. **Price history sparkline** — no other discovery-oriented comic site shows price trend. Directly useful for "should I buy now or wait."
4. **Format detection and filtering** — clear separation of hardcovers, TPBs, manga, single issues. Better than most retailers' search.
5. **eBay integration** — showing eBay prices alongside retailer prices is genuinely useful for back-issue collectors.

---

## Where It Fails Against the Discovery Thesis

1. **No series pages** — the biggest structural gap. Without a series hub, the collector has no place to understand a series as a whole.
2. **No "what comes next"** — the most frequent question a new collector has. Completely unanswered.
3. **No edition comparison** — the "which edition should I buy" question is the core decision-making problem. Unanswered.
4. **Homepage is transaction-first, not discovery-first** — sends a "price comparison tool" signal before the user even searches.
5. **Search results are lookup-only** — no synopsis, no series position, no reading context in result cards.
6. **97% of catalogue has no enrichment** — for most products, Catch Comics is not yet better than a Google search.

---

## Highest-Leverage Improvements (Ranked)

These are ordered by impact on the discovery thesis, not implementation effort.

### 1. Series Pages
**Impact:** Critical  
**Discovery question answered:** "What is this series? What order do I read it in? Which edition to buy? Where to start?"  
**What it is:** A page at `/series/[slug]` that aggregates all products in a series — showing volumes in order, format options per volume, what each collects, and a "start here" marker. The `series_name` field already exists on canonical products; a series page is a query over that field + CV enrichment data.  
**Why first:** Every other discovery gap is downstream of this. "What comes next" requires knowing series order. "Which edition to buy" requires seeing editions side by side. A series page solves both.

### 2. "Continue with" / Next Volume Links on Product Pages
**Impact:** High  
**Discovery question answered:** "What comes next?"  
**What it is:** A simple "Next: [Title] Vol. 2 →" link on a product page. Requires knowing series sequence (volume number from product data or CV).  
**Why second:** This is the most common question a new collector has after buying Vol. 1. It's also achievable with existing `volumeNumber` + `seriesName` data without full series pages.

### 3. Edition Comparison Block on Product Pages
**Impact:** High  
**Discovery question answered:** "Which edition should I buy?"  
**What it is:** A section on the product page showing other format options for the same work — e.g. "Also available as: Trade Paperback (£14.99) · Hardcover (£29.99) · Absolute Edition (£44.99)". Cross-references `seriesName` + `volumeNumber` across formats.  
**Why third:** The "which edition" question is the most common decision barrier. Showing editions side by side answers it without requiring a full series page.

### 4. Discovery Context in Search Result Cards
**Impact:** High  
**Discovery question answered:** "What is this? Is it relevant to me?"  
**What it is:** Adding to search result cards: a one-line synopsis excerpt (from `cv_metadata.synopsis`), and series position ("Vol. 1 of 4") for enriched products.  
**Why fourth:** The discovery experience begins at search, not at the product page. A result card that says "Vol. 1 of 4 · Collects issues #1–6 · Scott Snyder / Greg Capullo" is far more useful to the uncertain collector than the current title-only card.

### 5. Homepage Discovery Layer
**Impact:** Medium  
**Discovery question answered:** "Where do I start? What's worth reading?"  
**What it is:** Adding discovery-oriented sections to the homepage — "New releases this month", "Popular series (start with Vol. 1)", "Good starting points for new readers".  
**Why fifth:** The homepage sends "price comparison" signals. A discovery-oriented section would shift the brand positioning. Depends on having enough enriched, well-curated content to populate it credibly.

---

## Dependencies and Sequencing Notes

- Improvements 1–3 depend on series relationship data being reliable. `series_name` + `volume_number` exists in the DB but needs validation — inconsistent naming (e.g. "Absolute Batman" vs "Absolute Batman Vol. 1 (2025)") breaks automatic sequence detection.
- Improvement 4 depends on `cv_metadata.synopsis` availability (~3% today, growing).
- Improvement 5 requires enough enriched content to make it non-embarrassing. Premature at current coverage.
- The `/comic/[id]` legacy page is a debt item. As `canonicalSlug` coverage grows, it should route to `/product/[slug]`. Maintaining two product experiences creates UX inconsistency and duplicates discovery feature work.

---

## Assumptions to Validate

- `series_name` and `volume_number` are consistent enough in the DB to power series pages and next-volume links automatically. **Needs verification** — the enrichment process and retailer feeds may use different naming conventions.
- The `getRelated()` query on the product page uses `seriesName` match — which means series pages could be scaffolded on the same logic. But if `series_name` is noisy, the series page would be noisy too.
- Series pages for the top ~20 high-traffic series (Batman, Spider-Man, X-Men, Saga, Invincible, etc.) are achievable now because those are the first enriched. A series page that works for 20 series and 404s for everything else is still a meaningful early delivery.
