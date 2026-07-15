# Wave 4B Readiness — foundations, not features

Wave 4 strengthened the product's *data spine*. Wave 4B is the retention layer (accounts, collections, price alerts). **Do not build 4B before launch.** This note records what 4 enabled, what stays unsafe, and what to test first once real users exist.

## What Wave 4 laid down (the foundations 4B needs)

| Foundation | State after Wave 4 | Why 4B needs it |
|---|---|---|
| Stable canonical product IDs | Unchanged (UUID `canonical_products.id`) — already stable | A wishlist/alert must point at a durable id |
| Edition identity | `lib/identity/edition.ts` — ISBN-first, hard negative rules, `editionMatchVerdict` | Alerts must not fire on the wrong edition (HC vs PB, Vol 1 vs #1) |
| Genuine price observations | 476k real observations, 8 retailers, 2-month span; **2,351 products chart-eligible** | A price-drop alert is only honest on real history — never fabricated |
| Price-change detection | Syncs write a `price_history` row **only on change**, `recordedAt = now` | The event a "price dropped" alert subscribes to already exists |
| Multi-retailer comparison | **198 products** with 2+ priced retailers (was 62) via Bookshop revive | "Cheapest across N retailers" is the alert's payload |
| Trust display layer | `displayPublisher` omits distributors; issue covers on R2 | A saved product must render trustworthy metadata, not feed artefacts |

## What is still unsafe for 4B (do not skip these)

- **No user model / auth.** Accounts, sessions, and GDPR-grade PII handling do not exist. 4B starts here, and it is the riskiest part — treat as its own security-reviewed workstream.
- **Notification transport.** No email/push infra. A price-drop alert needs a durable queue + a send path + unsubscribe. None exists.
- **Observation cadence is retailer-driven, not scheduled per product.** History accrues where syncs run (WoB daily; others intermittently). An alert promising "we'll tell you within a day" is only truthful for daily-synced retailers today.
- **Comparison depth is still thin** — 198 of ~35k priced products have 2+ retailers. A "best price" alert is most useful exactly where depth is weakest.

## First retention feature to test after launch — and the evidence to wait for

**Recommended first test: a logged-out "watch this product" → email-me-on-price-drop, on a hand-picked set of chart-eligible products.**

Rationale: it exercises the price-observation spine (already real), needs the *least* new surface (one email field, one confirmed opt-in, no account), and directly tests the core habit thesis — *do people come back for price movement?*

Gate it on real behaviour, not a date:
- **Clickthrough depth:** are users reaching product pages and clicking retailer links at all? (Vercel Analytics + `/go` click logs.) No outbound clicks → price alerts have no audience yet.
- **Repeat visits:** any returning sessions in week 1–2? Retention features amplify an existing habit; they don't create one.
- **Which products get attention:** if traffic concentrates on the ~2,351 chart-eligible products, alerts are viable; if it's on thin-depth long-tail, fix depth first (more retailers) before alerts.

Do not build accounts, collections, profiles, reviews, or social until a price-watch test shows people actually want to be told when a comic gets cheaper.
