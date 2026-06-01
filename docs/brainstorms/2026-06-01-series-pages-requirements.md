# Series Pages — Product Specification
**Date:** 2026-06-01  
**Status:** Specification — ready for planning  
**Priority:** Critical (highest-leverage discovery feature per audit)

---

## The Problem This Solves

The audit established that the engaged uncertain collector arrives asking:
- What is this series?
- Where should I start?
- What comes next?
- What editions exist?
- Which format should I buy?
- What does each volume collect?

No page in the current product answers any of these questions. The user either searches and gets disconnected product cards, or lands on a product page with no series context. A series page is the missing structural layer between "I heard of this series" and "I bought the right volume."

---

## Scope Boundaries

**In scope (this spec):**
- Series hub page at `/series/[slug]`
- Reading order view (volumes in sequence)
- Edition comparison (TPB vs HC vs Omnibus vs Absolute)
- "Where to start" signal
- Price data per volume
- "What does each volume collect" (CV-enriched products only)
- Internal linking from product pages and search
- SEO optimisation

**Deferred to Phase 2:**
- Separate `Series` database table
- User signals (watcher counts, follows, "X collectors own this series")
- Creator index ("Other series by Scott Snyder")
- Universe/event connections ("Also in the Absolute Universe")
- Reading guide editorial content
- Community reviews on series

**Outside scope:**
- Single-issue series tracking
- User-owned collection state
- "Buy the full series" bulk basket
- Personalised recommendations

---

## 1. UX Architecture

### Route

```
/series/[slug]
```

Slug is derived from `seriesName` normalized: "Absolute Batman" → `absolute-batman`.

The page is a **discovery hub, not a product page.** Its job is to give the collector enough context to make a decision, then route them to the right product page to buy.

### Page Sections (reading order, top to bottom)

```
┌─────────────────────────────────────────────────────────┐
│  SERIES HERO                                             │
│  Series name · Publisher · Status · Start Year           │
│  Description (one paragraph)                             │
│  [ Start Reading → Vol. 1 ]   [ N volumes · M issues ]  │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  READING ORDER                                           │
│  Vol. 1  [START HERE]  Vol. 2  Vol. 3 →                 │
│  Card per volume: cover · title · collects · price       │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  EDITION COMPARISON (conditional: 2+ formats per volume)│
│  "Vol. 1 is available in 3 editions:"                   │
│  TPB £14.99  ·  Hardcover £29.99  ·  Absolute £44.99    │
│  Brief format guide ("what's the difference?")          │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  INDIVIDUAL ISSUES (collapsed by default, expandable)    │
│  For collectors who want single issues, not trades       │
└─────────────────────────────────────────────────────────┘
```

### Navigation Into the Series Page

Entry points that must be built alongside the series page:

1. **Product page hero:** "Part of the Absolute Batman series →" link below the title
2. **Search result card:** When results are volumes in the same series, show "Series: Absolute Batman (2 volumes)" with a link
3. **Homepage popular search:** "Batman" pill → search results that show a series-level entry above individual products
4. **Direct URL:** SEO-optimised for "absolute batman reading order" queries

### Navigation Out of the Series Page

- Every volume card links to `/product/[slug]`
- "Start Reading" button links to Vol. 1's product page
- Edition comparison links go to the specific edition's product page
- Related series links (Phase 2)

---

## 2. Information Hierarchy

### Hero Information (first visible, above the fold)

| Field | Source | Required? |
|---|---|---|
| Series name | `seriesName` from products | Yes |
| Publisher | `publisher` from first/most common product | Yes |
| Status (Ongoing/Complete/Limited) | Derived or manual | Desired |
| Start year | Earliest `releaseDate` year | Yes |
| Description | `cv_metadata.synopsis` from first enriched product, or fallback | Desired |
| Series cover | Cover of Vol. 1 | Yes |
| Volume count | COUNT of products with matching series | Yes |
| Issue count | From CV (if available) | Optional |

### Volume Card Information (reading order grid)

Each card shows:
- Cover image
- Volume title (e.g. "Absolute Batman Vol. 1")
- "START HERE" badge on Vol. 1
- `collectsIssues` string (e.g. "Collects #1–6") — only when CV-enriched
- Cheapest current price (GBP, from live listings)
- In-stock indicator
- Format badge (HC / TPB / Omnibus / Absolute)
- Link to product page

Cards are ordered by:
1. `volumeNumber` (primary, ascending)
2. `releaseDate` (secondary, when `volumeNumber` is null)
3. Alphabetical title (final fallback)

### Edition Comparison Information

Shown when a series has the same volume number in multiple formats (e.g. Vol. 1 as both TPB and Hardcover).

Per edition group:
- Volume title + issue range
- Format name and brief description (one line: "Standard paperback", "Premium oversized hardcover", etc.)
- Price from cheapest listing
- In-stock badge
- Direct link to product page

### "What Does It Collect" Information

For CV-enriched products only. Derived from `cv_metadata` issue data:
- Issue range (e.g. "#1–#6")
- Issue count

For non-enriched products: field is omitted, not shown as empty.

---

## 3. Database Requirements

### What Exists Today

The schema has on `CanonicalProduct`:
- `seriesName` — text, indexed, populated from retailer data (not authoritative)
- `volumeNumber` — nullable integer, inconsistently populated
- `issueNumber` — text, for single issues
- `comicvineId` — CV volume/issue ID
- `cvMetadata` — JSONB with synopsis, creators, issue data
- `releaseDate` — date
- `format` — enum

There is **no `Series` table**. Series are implicit, derived by grouping products on `seriesName`.

### The Core Risk: `seriesName` Noise

`seriesName` is fed from retailer data, not from CV. Naming will be inconsistent:
- "Absolute Batman" vs "Absolute Batman (2024 Series)" vs "Batman, Absolute"
- Some products may have `seriesName = null`
- Some may use the full title as the series name ("Absolute Batman Vol. 1")

**This is the gating risk for MVP.** A series page built on noisy data shows incomplete groupings and breaks the reading order. See Risks section.

### MVP (no migration required)

No schema changes needed for MVP. Series pages derive from existing `seriesName` data. Manually curate the top 20-30 series' `seriesName` values to be consistent before shipping.

Verify: the following query is the MVP backbone:
```sql
SELECT id, title, series_name, volume_number, release_date,
       format, cover_image_url, canonical_slug, cv_metadata
FROM canonical_products
WHERE series_name = $1
  AND deleted_at IS NULL
ORDER BY volume_number ASC NULLS LAST, release_date ASC NULLS LAST
```

Cheapest price join (needed for volume cards):
```sql
SELECT DISTINCT ON (cp.id)
  cp.*,
  rl.price_amount, rl.price_currency
FROM canonical_products cp
LEFT JOIN retailer_listings rl
  ON rl.canonical_product_id = cp.id
  AND rl.deleted_at IS NULL
  AND rl.price_amount > 0
  AND rl.stock_status IN ('IN_STOCK', 'LOW_STOCK', 'PREORDER')
WHERE cp.series_name = $1
  AND cp.deleted_at IS NULL
ORDER BY cp.id, rl.price_amount ASC
```

### Phase 2 Migration: `Series` Table

When `seriesName` inconsistency becomes a maintenance problem, introduce an authoritative table:

```prisma
model Series {
  id           String    @id @default(uuid()) @db.Uuid
  slug         String    @unique @db.Text
  name         String    @db.Text
  publisher    String?   @db.Text
  startYear    Int?      @map("start_year")
  /// "ongoing" | "complete" | "limited" | "unknown"
  status       String    @default("unknown") @db.VarChar(20)
  /// CV volume ID of the canonical series entry
  comicvineId  String?   @map("comicvine_id")
  description  String?   @db.Text
  coverUrl     String?   @map("cover_url") @db.Text
  createdAt    DateTime  @default(now()) @map("created_at")
  updatedAt    DateTime  @updatedAt @map("updated_at")

  products     CanonicalProduct[]

  @@index([comicvineId])
  @@map("series")
}
```

Then add `seriesId String? @map("series_id") @db.Uuid` to `CanonicalProduct` with a foreign key to `Series`.

This decouples the URL and display name from the messy retailer-derived `seriesName` field.

---

## 4. API Requirements

### `GET /api/series/[slug]`

**Purpose:** Serve all data for a series page.

**Slug lookup:** Normalize incoming slug back to series name. In MVP, use a lookup table (curated map of slug → exact `seriesName`). In Phase 2, query the `Series` table.

**Response shape:**

```typescript
interface SeriesResponse {
  series: {
    name:        string
    publisher:   string | null
    description: string | null
    status:      'ongoing' | 'complete' | 'limited' | 'unknown'
    startYear:   number | null
    coverUrl:    string | null
    volumeCount: number
  }
  volumes: VolumeCard[]
  editionGroups: EditionGroup[]  // populated when multi-format volumes exist
}

interface VolumeCard {
  slug:           string
  title:          string
  volumeNumber:   number | null
  format:         string
  coverUrl:       string | null
  collectsIssues: string | null   // "Collects #1–6" or null if not enriched
  releaseDate:    string | null
  lowestPrice:    number | null
  currency:       string
  inStock:        boolean
  isStartHere:    boolean         // true for the first volume in reading order
}

interface EditionGroup {
  volumeNumber:   number | null
  collectsIssues: string | null
  editions:       Array<{
    slug:         string
    format:       string
    formatLabel:  string          // "Trade Paperback", "Hardcover", etc.
    price:        number | null
    inStock:      boolean
  }>
}
```

**Caching:** ISR at 1 hour (same as product pages). Series data changes rarely; prices change more often but the series structure is stable.

**404 handling:** If no products found for slug, return `{ notFound: true }`.

### `GET /api/series` (Phase 2 only)

Series listing endpoint for `/series` browse page and navigation. Returns top series by product count + search volume. Not needed for MVP.

### Existing API Changes

**`/api/search`:** When canonical results share a `seriesName`, optionally surface a "series" type result above individual volumes. This is a search-layer enhancement, not required for the series page itself. Defer to Phase 2.

---

## 5. SEO Opportunities

Series pages are the highest-leverage SEO surface on the site. The target queries are high-intent, moderately competitive, and well-matched to structured data.

### Target Queries

| Query | Monthly intent | Current competition | Catch Comics advantage |
|---|---|---|---|
| "absolute batman reading order" | High | Reddit, fan wikis, LOCG | Reading order + prices in one place |
| "saga reading order" | High | Reddit, CBR, LOCG | Same |
| "ultimate spider-man reading order" | High | LOCG, fan sites | Same |
| "absolute batman how many volumes" | Medium | Fan sites, Wikipedia | Live data, always current |
| "where to start absolute batman" | High | Reddit, CBR | Explicit "Start Here" signal + cheapest price |
| "absolute batman tpb vs hardcover" | Medium | None well-answered | Direct edition comparison with prices |
| "invincible complete series" | High | Amazon, LOCG | Multi-retailer prices + reading order |
| "saga brian k vaughan volumes" | Medium | Publisher site, Amazon | Same |

**Key insight:** No existing site combines reading order + edition comparison + live multi-retailer prices. That combination is Catch Comics' unique SEO play. Don't try to out-content CBR's editorial. Win on structured utility.

### Page-Level SEO

**Title tag:** `[Series Name] Reading Order & Complete Buying Guide — Catch Comics`  
Example: "Absolute Batman Reading Order & Complete Buying Guide — Catch Comics"

**Meta description:** `[Series Name] has [N] volumes. Start with [Vol. 1 title] from [£X]. Compare editions — Hardcover, TPB, Omnibus — across UK retailers.`

**Canonical URL:** `/series/[slug]` (no query params)

**H1:** `[Series Name] — Complete Reading Order`

### Structured Data

Two schema types for series pages:

```json
{
  "@context": "https://schema.org",
  "@type": "BookSeries",
  "name": "Absolute Batman",
  "publisher": { "@type": "Organization", "name": "DC Comics" },
  "numberOfVolumes": 2,
  "genre": ["Comics", "Superhero"],
  "url": "https://catchcomics.com/series/absolute-batman"
}
```

Plus `ItemList` for reading order:

```json
{
  "@context": "https://schema.org",
  "@type": "ItemList",
  "name": "Absolute Batman Reading Order",
  "numberOfItems": 2,
  "itemListElement": [
    {
      "@type": "ListItem",
      "position": 1,
      "item": {
        "@type": "Book",
        "name": "Absolute Batman Vol. 1",
        "isbn": "...",
        "url": "https://catchcomics.com/product/absolute-batman-vol-1"
      }
    }
  ]
}
```

### Internal Linking SEO Value

Product pages currently have breadcrumb `Home / Search / Title`. Adding `Home / Series / Title` breadcrumbs and linking product pages to their series hub creates a hub-and-spoke internal link structure. This improves crawlability and distributes page authority across the series cluster — which is how Google understands topically related content.

---

## 6. MVP Version

**Target series at launch (all have enough enriched products to work):**
- Absolute Batman
- Ultimate Spider-Man (2024)
- Saga
- Invincible
- Batman (Tom King)
- X-Men (Gerry Duggan)
- One Piece (first ~20 volumes)

**What MVP delivers:**

1. `/series/[slug]` page with ISR
2. Series hero (name, publisher, description from first enriched product, cover from Vol. 1)
3. Reading order grid (volumes sorted by `volumeNumber` → `releaseDate`)
4. "START HERE" badge on first volume
5. Each volume card: cover, title, format badge, cheapest price, in-stock status, link to product page
6. "Collects #X–#Y" label on volumes where CV enrichment provides it
7. Edition comparison block when same `volumeNumber` exists in multiple formats
8. Product page back-link: "Part of [Series Name] →" in hero
9. SEO: title tag, meta description, BookSeries + ItemList schema
10. Graceful 404 for unknown slugs

**What MVP deliberately excludes:**

- `Series` table (not needed; uses curated `seriesName` matching)
- User signals (watchers, follows)
- Related series
- Individual issues grid
- Ongoing/complete status (manually set only for curated series)
- Admin UI for series management

**Definition of MVP success:**

A collector landing on `/series/absolute-batman` from a Google search for "absolute batman reading order" can:
1. See that the series has 2 volumes
2. Know to start with Vol. 1
3. See what each volume collects
4. See the cheapest current price for each volume
5. Click through to buy the right one

---

## 7. Phase 2 Version

**Trigger:** Ship when MVP series pages drive measurable return visits or when `seriesName` inconsistency creates enough bugs to justify the migration.

**Phase 2 additions:**

### Series Table + Admin Curation
- Introduce `Series` table (see Database Requirements)
- Admin UI: list series, edit name/description/status, manually link products
- Backfill: script to match existing `seriesName` values to `Series` rows
- Allows publisher/curator to set "status: complete", correct series names, add descriptions

### "What Does Each Volume Collect" — Full
- Pull CV issue data per volume to show exact issue numbers
- Show per-issue cover thumbnails in an expandable "Collects Issues" grid
- Cross-reference with individual `/product/[slug]` pages for those issues

### User Signals
- "X collectors are following this series" per volume card (aggregate, anonymous)
- "N people are watching Vol. 1" signal
- Requires watch/alert feature to exist (separate spec)

### Reading Guide Content
- "Why start here" one-paragraph editorial note per series
- "If you liked this, try:" related series recommendations
- Can be manually authored or derived from CV/community signals

### Series Index Page (`/series`)
- Browse all tracked series
- Filterable by publisher, format, status
- SEO surface for "complete list of [publisher] series" queries

### Series Search Integration
- When query matches a series name exactly, surface a "Series" card above product results
- Example: searching "Absolute Batman" returns a series card + individual volumes below

---

## 8. Technical Implementation Plan

### Prerequisite: `seriesName` Audit (before any code)

**Do this first.** Query the DB for all distinct `seriesName` values. Identify inconsistencies for the launch series. Manually update `series_name` to be consistent for the 7 launch series. Without this, the page will show incomplete or wrong groupings.

```sql
SELECT series_name, COUNT(*) as product_count, 
       array_agg(format) as formats,
       MIN(release_date) as earliest
FROM canonical_products 
WHERE deleted_at IS NULL AND series_name IS NOT NULL
GROUP BY series_name
ORDER BY product_count DESC
LIMIT 50;
```

Time: 0.5 days

### Step 1: Slug Registry (1 day)

Create `lib/series/registry.ts` — a static map of slug → canonical `seriesName`:

```typescript
export const SERIES_REGISTRY: Record<string, string> = {
  'absolute-batman':       'Absolute Batman',
  'ultimate-spider-man':   'Ultimate Spider-Man',
  'saga':                  'Saga',
  'invincible':            'Invincible',
}
```

`seriesNameToSlug(name: string): string` — normalise name to slug for generating links.  
`slugToSeriesName(slug: string): string | null` — reverse lookup for page queries.

In Phase 2, this registry is replaced by the `Series` table.

### Step 2: Series Data Function (1 day)

`lib/series/getSeriesData.ts` — queries canonical_products, groups by format, returns `SeriesResponse`.

Key logic:
- Filter by `seriesName` (case-insensitive)
- Exclude `deletedAt IS NOT NULL`
- Exclude `format = 'SINGLE_ISSUE'` from the volumes grid (keep for issues section)
- Sort by `volumeNumber ASC NULLS LAST`, then `releaseDate ASC NULLS LAST`
- Left join cheapest live listing per product
- Group products by `volumeNumber` to identify edition groups
- Pull description from first product with `cv_metadata.synopsis`

### Step 3: Series Page Route (2 days)

`app/series/[slug]/page.tsx`:
- Server component with `revalidate = 3600` (1h ISR)
- `generateStaticParams` for the launch series registry
- `generateMetadata` for SEO title/description/OG
- JSON-LD injection (`BookSeries` + `ItemList`)
- Series hero, volumes grid, edition comparison, footer

`app/series/[slug]/page.tsx` components needed:
- `SeriesHero` — name, publisher, description, cover, CTA
- `VolumeGrid` — cards in reading order with START HERE badge
- `VolumeCard` — cover, title, collects, price, link
- `EditionComparison` — only rendered when `editionGroups.length > 0`

No new API route needed for MVP — `getSeriesData` runs as a server-side data call.

### Step 4: Product Page Back-Link (0.5 days)

In `app/product/[slug]/page.tsx`, after fetching the product:
- `const seriesSlug = product.seriesName ? seriesNameToSlug(product.seriesName) : null`
- Render a "Part of [Series Name] →" link in the hero, between the title and metadata rows
- Only render if `seriesSlug` is in the registry (MVP) or has a matching `Series` record (Phase 2)

### Step 5: Search Result Back-Link (0.5 days)

In `app/search/page.tsx`, add a series link below the format badge on result cards where `canonicalSlug` exists and the product's `series_name` has a registered slug.

### Step 6: Validation (1 day)

Manual test for each launch series:
- Correct volumes in correct order
- Correct prices (spot-check against retailer sites)
- Edition comparison renders when applicable
- "Collects" string appears for enriched volumes only
- SEO metadata renders correctly in `<head>`
- JSON-LD validates at schema.org/schemaorg
- Product page back-links work

---

## 9. Risks and Dependencies

### Risk 1: `series_name` Inconsistency — HIGH PROBABILITY, HIGH IMPACT

**The problem:** `seriesName` is retailer-derived, not authoritative. Products in the same series may have different `seriesName` values. A series page built on this data will show incomplete groupings.

**Concrete example:** Saga Vol. 1 might have `seriesName = "Saga"`, but Saga Vol. 3 (sourced from a different retailer) might have `seriesName = "Saga (2012)"` or `seriesName = "Saga, Volume 3"`. The series page would show only the products that share the exact name.

**Mitigation:** 
- Do the `seriesName` audit before writing any code.
- Manually fix `seriesName` for the 7 launch series.
- The static registry approach (slug → fixed string) ensures the page query uses a clean known value, but the products themselves must have matching values.
- Build an admin view to inspect series groupings before launch.

### Risk 2: `volumeNumber` Gaps — MEDIUM PROBABILITY, MEDIUM IMPACT

**The problem:** `volumeNumber` is nullable. If several products in a series have `volumeNumber = null`, the reading order falls back to `releaseDate`, which is usually correct but not guaranteed.

**Mitigation:** Audit `volumeNumber` completeness for launch series. Manually populate missing values via a script or admin UI. Add a diagnostic: if more than 25% of volumes in a series lack `volumeNumber`, log a warning.

### Risk 3: Edition Grouping False Positives — MEDIUM PROBABILITY, MEDIUM IMPACT

**The problem:** Two products with the same `volumeNumber` may not actually be the same content in different formats. Example: "Batman Vol. 1" HC from one arc and "Batman Vol. 1" TPB from a different arc, both labelled volume 1 by different retailers.

**Mitigation:** For the 7 launch series, manually verify edition groups are correct. In Phase 2, the `Series` table with explicit edition relationships replaces automatic `volumeNumber` matching.

### Risk 4: CV Rate Limits Affect "Collects" Data — LOW PROBABILITY, LOW IMPACT

**The problem:** The "Collects #X–#Y" string depends on CV enrichment. At 2.8% catalogue coverage, most series volumes won't have this data yet.

**Mitigation:** The page degrades gracefully — unenriched volumes show cover + price + format but no "Collects" label. This is expected behaviour and explicitly acceptable. As enrichment progresses, the string appears automatically via ISR revalidation.

### Risk 5: Series Page 404s Damage SEO — LOW PROBABILITY, HIGH IMPACT

**The problem:** If Catch Comics links to `/series/[slug]` from product pages or search, but the series page 404s (because the slug isn't registered or the series has no products), Google sees dead internal links. This hurts SEO.

**Mitigation:** Only render back-links to series pages when the slug is in the registry. Use `generateStaticParams` to pre-build known good pages. Return a proper 404 with `notFound()` for unknown slugs rather than an empty page.

### Dependency: CV Enrichment Coverage

Series pages for the 7 launch series are achievable now. Expanding to 50+ series requires either (a) more CV enrichment coverage, or (b) the Phase 2 `Series` table with manually curated data. The enrichment pipeline is the path-to-scale for discovery features, not a blocker for MVP.

---

## 10. Estimated Effort

### MVP

| Task | Effort |
|---|---|
| `seriesName` audit + cleanup for 7 launch series | 0.5 days |
| Slug registry (`lib/series/registry.ts`) | 0.5 days |
| `getSeriesData` query function | 1 day |
| Series page route + components | 2 days |
| Product page back-link | 0.5 days |
| Search result back-link | 0.5 days |
| SEO metadata + JSON-LD | 0.5 days |
| Manual testing + validation | 1 day |
| **MVP total** | **6–7 days** |

### Phase 2 Additions

| Task | Effort |
|---|---|
| `Series` schema + migration | 0.5 days |
| Series backfill + admin curation UI | 2–3 days |
| Full "What does this collect" expansion | 1–2 days |
| User signals (watcher counts) | 1–2 days |
| Series index page (`/series`) | 1 day |
| Search integration (series result card) | 1–2 days |
| **Phase 2 total** | **6–10 days** |

### Sequencing Recommendation

Do the `seriesName` audit before starting Phase 1 code. It's the gating risk. Everything else is straightforward Next.js server component work building on patterns already established in the product page.

The 7 launch series should be chosen for maximum discovery value (high search volume) and data completeness (already have CV coverage). The four the user specified — Absolute Batman, Ultimate Spider-Man, Saga, Invincible — are the right starting point. Add 3 more from: X-Men (current run), One Piece (Viz), The Walking Dead, Hellboy.

---

## Open Questions Before Planning

1. **Who owns `seriesName` corrections?** Manual DB edits via script, or does this need an admin UI first? Recommendation: script for MVP, admin UI in Phase 2.

2. **What is the `series_name` for multi-publisher series?** e.g. Hellboy runs across several mini-series with different names. Does Catch Comics show one series page or many? Recommendation: one page per `seriesName` value for MVP; manual curation handles edge cases in Phase 2.

3. **Edition comparison copy:** "What's the difference between TPB and Hardcover?" — this needs short format explanation text. Hardcoded strings in the component, or a CMS field? Recommendation: hardcoded for MVP (6 format types × 1–2 sentences = manageable).

4. **"Status: Ongoing vs Complete"** — requires manual tagging or a reliable heuristic. Is it worth including in MVP or should it be Phase 2 only? Recommendation: Phase 2 only for accuracy.
