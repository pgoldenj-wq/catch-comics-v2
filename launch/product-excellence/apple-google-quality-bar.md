# Apple / Google Quality-Bar Review

Scoring: **Launch-ready** · **Needs fixing before launch** · **Acceptable, should improve** · **Later**

| # | Area | Score | Judgement |
|---|---|---|---|
| 1 | First impression (5-second test) | **Needs fixing** | The hero says exactly what it is — good. But the first proof point under it ("Top deals today") leads with niche adult-adjacent manga and prices masquerading as deals, and the eyebrow claim is a falsifiable superlative. A serious team would reject the storefront's opening argument, not the layout. (LB-1, LB-7) |
| 2 | Trust (would a collector trust the data?) | **Needs fixing** | The offers table, freshness labels and honest empty states would pass Stripe review. The flagship search page mislabelling single issues as "Hardcover Edition" and £5.95 anchors on £30 hardcovers would not. Two bounded fixes close the gap. (LB-2, LB-3) |
| 3 | Stability | **Launch-ready** | No crashes found; error boundaries, graceful API degradation, soft-fail everywhere. One dev-only hydration stall noted for launch-week vigilance. |
| 4 | Clarity of actions | **Launch-ready** | Search → result → offers → retailer is legible throughout; full-row links; "Search ↗" vs priced rows distinguished honestly. |
| 5 | Polish & consistency | **Acceptable, should improve** | Strong visual system. Blemishes: "(1 listing)" vs "All (9)"; permanently empty Price History module; raw CV wiki text on series pages; scaffold SVGs in `public/`. |
| 6 | Error tolerance (missing/slow/stale data) | **Launch-ready** | The best part of the product. Missing covers → designed fallback; stale prices → greyed + labelled; no description → says so; eBay down → table degrades; DB down on sitemap → static routes. This team ships honest failure states. |
| 7 | Accessibility | **Launch-ready** | Real links, keyboard paths, aria on interactive elements, reduced-motion throughout. Above the indie bar. |
| 8 | Mobile | **Acceptable, should improve** | Dedicated mobile trees, drawer filters, 36px targets — code-clean. Needs one physical-device pass before launch (couldn't screenshot in this session). |
| 9 | Confidence to click a retailer link | **Launch-ready** | Commission-blind sort, sponsored rels, postage caveats, affiliate disclosure in footer + dedicated page, /go behaviour correct. |
| 10 | Return value (why come back tomorrow?) | **Later** | Honest gap: no alerts, no collections, no price-drop tracking yet. Strategy says this is the post-launch habit/moat work — correct sequencing, don't force it now. |
| 11 | Brand distinctiveness | **Acceptable, should improve** | Visually distinct from generic SaaS; covers celebrated; dark-hero identity consistent. The brand's *words* are the weak layer (superlatives, "deals"). |
| 12 | Operational readiness | **Launch-ready** | Mission Control with honest readiness math, Smoke Test V4 with evidence capture, security docs, rollback tag. Add: launch-day runbook page + weekly data-health run (script now exists). |

**Bottom line:** 6 launch-ready, 3 acceptable, 2 needs-fixing, 1 honestly-later. The two "needs fixing" areas are both concentrated in ~4 files and 2–3 days of work. This is a *nearly ready* product whose failure mode is overpromising, not under-engineering.
