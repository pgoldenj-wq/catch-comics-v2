# Founder Action List — plain English, in order

Things only you can decide or do. Everything else is in `claude-fix-prompts.md` ready to hand to Claude.

## Decisions needed (15 minutes total)

1. **Approve the new hero line.** "The world's only comic price comparison" has to go (it's falsifiable and your own brand doc flags it). Pick the replacement — suggestion: **"Compare comic, graphic novel & manga prices across UK retailers."** The homepage is design-frozen, so this is your sign-off, not Claude's.
2. ~~**Amazon rows: refresh or hide?**~~ **DECIDED & DONE (13 July):** Rainforest retired, account closed. Amazon is affiliate-only; stored offers age out honestly under the 30-day rule (all hidden by 26 July — automatic, intentional, no wall of grey rows). No action required. Revisit Amazon Creators API eligibility after launch (needs 10 qualifying sales/30 days).
3. **Pick the 12 pinned homepage cards.** The carousel currently ranks by what World of Books stocks deepest — which is how *"Asumi-chan is Interested in Lesbian Brothels!"* became your #2 storefront card. Give Claude 12 crowd-pleaser series (Saga, One Piece, AB, Invincible, Walking Dead, JJK, Naruto, Hellboy…) — it fills the rest algorithmically.
4. **"Top deals" rename.** They're prices, not deals. Approve "Live prices" or "Popular this week".

## Do-it-yourself (30 minutes total)

5. **Turn on Vercel Spend Management** (a cap + alert). Still off per security notes. 5 min.
6. **Turn on GitHub secret scanning + Dependabot** on the repo. 5 min.
7. **og-image:** if you have a brand-kit card, drop a 1200×630 PNG at `public/og-image.png` (or ask Claude to compose one from the logo). Right now every social share shows a broken image.
8. **One physical phone pass** over homepage → search "absolute batman" → AB Vol 2 product page → /series/saga. I couldn't screenshot in this session. Specifically check: do the 22 small issue covers on the product page actually show pictures, or grey #N tiles? (They're hot-linked from ComicVine and didn't load in my session.)

## Launch posture (context, no action)

- **Your data is honest; your copy oversells it.** 99.8% of priced products have exactly ONE retailer (World of Books) plus eBay. That's still useful — but it's "find the best live price", not "world's only comparison". After launch, the single highest-leverage data task is getting **Wordery or Bookshop prices live** (the adapters already exist, they're just at zero).
- **The enrichment job won't finish before launch** (~21 days left). That's fine — un-enriched products degrade honestly ("Comic", letter covers, no creators). Don't panic-run parallel enrichment; it's the riskiest thing in the repo.
- Ship order: Wave 1 blockers (2–3 days of Claude work + your 4 decisions) → Wave 2 polish if time allows → launch → retailer #2.
