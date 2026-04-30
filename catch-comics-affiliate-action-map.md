# Catch Comics — Affiliate & API Action Map

> UK-first. No scraping. No brittle workarounds. Legal, low-cost, affiliate/API-friendly routes only.
> Stop whenever human approval, credentials, or legal sign-off are required.

---

## 1. Real MVP Stack — Apply for These First

These 10 sources give you the broadest coverage of UK comic, manga and GN retail with the least friction. Apply in this order.

| # | Source | Why first |
|---|--------|-----------|
| 1 | **Bookshop.org UK** | Fastest approval, free, supports indie shops, great brand story |
| 2 | **Amazon Associates UK** | Highest traffic, near-instant approval, covers Amazon + AbeBooks deep links |
| 3 | **eBay Partner Network** | Essential for second-hand, collectibles, rare back issues |
| 4 | **Awin publisher account** | Single sign-up unlocks Waterstones, WHSmith, Zavvi, MusicMagpie, Oxfam and more at once |
| 5 | **Waterstones** (via Awin) | UK's biggest bookshop, strong comic/GN/manga range |
| 6 | **World of Books** | Large used-book stock, good for back-catalogue and cheap manga |
| 7 | **MusicMagpie** (via Awin) | High volume secondhand, active comic listings |
| 8 | **Forbidden Planet** | UK's biggest specialist — direct email partnership approach |
| 9 | **Zavvi** (via Awin) | Best UK online source for manga and anime collectibles |
| 10 | **Amazon PA-API** | Unlocks real-time price + product data once Associates has 3 qualifying sales |

---

## 2. Most Useful for API / Product Data Integration

Sources where you can get structured, real-time pricing data via API or official product feed:

| Source | Route | Notes |
|--------|-------|-------|
| **Amazon PA-API** | Amazon Associates → PA-API | Returns prices, images, availability. Requires active Associates + 3 sales in 180 days. Free tier. |
| **eBay Finding API** | eBay Developer Programme | Returns live listings including second-hand. Generous free tier. Apply at developer.ebay.com. |
| **Etsy API** | developer.etsy.com | Returns product listings. Needs app review approval. Good for vintage/signed comics. |
| **Bookshop.org** | Affiliate data feed | Check after joining — they provide product data to affiliates. |
| **Awin product feeds** | Awin publisher account | Many Awin advertisers provide CSV/XML product feeds. After joining, request feeds per advertiser. |

Everything else in the 100 is affiliate-link-only or direct contact. No public APIs.

---

## 3. Affiliate-Only Sources (No API — Link and Commission Only)

These are valuable but you get a tracking link, not live price data. Use for outbound links and commission revenue rather than price comparison.

- Waterstones, WHSmith, Blackwell's, Foyles, Wordery, Speedyhen, Books2Door
- Bookshop.org UK, Hive, The Works, Zavvi, HMV, GAME
- Oxfam Online Shop, MusicMagpie, Better World Books
- AwesomeBooks, World of Books (affiliate, not API)
- Rebellion / 2000 AD Shop (if they have a programme)
- Japan Centre, Etsy (affiliate via Awin, separate from Etsy API)
- Zatu Games, Magic Madhouse, Chaos Cards

**Practical implication:** For price comparison features, API sources (Amazon, eBay, Etsy) drive the actual price data. Affiliate-only sources are best used for "Buy at Waterstones →" outbound links that earn commission.

---

## 4. Requires Direct Partnership / Contact — No Self-Serve Route

These have no known self-serve affiliate programme. You need to email them directly and negotiate.

| Source | Approach |
|--------|----------|
| **Forbidden Planet** | Email commercial/partnership team. Pitch traffic and audience fit. |
| **SciFier / FP International** | Separate contact from FP Ltd. Email independently. |
| **Reed Comics** | Direct email. Small team — keep pitch short. |
| **Gosh! Comics** | Direct email. Indie-friendly, likely receptive. |
| **Page 45** | Direct email. They have an active online shop. |
| **Rebellion / 2000 AD** | Contact via shop or press team. Pitch UK-first angle. |
| **Titan Books** | Email digital partnerships. |
| **Japan Centre** | Email trading/marketing team. |
| **Crunchyroll Store UK** | Sony-owned — formal pitch required. |
| **Indie comic publishers** (Nobrow, SelfMadeHero, Cinebook etc.) | Low volume. Contact only after MVP is live and you have traffic data. |

**Template approach:** Draft one short partnership email template covering: what Catch Comics does, your audience, what you want (product feed / affiliate link / API access), and what you offer in return (traffic, exposure, price comparison listing). Reuse for all direct-contact targets.

---

## 5. Sources That May Cost Money

| Source | Likely cost | Notes |
|--------|-------------|-------|
| **Amazon PA-API** | Free — but gated behind 3 qualifying affiliate sales | Not paid, but requires active earning to unlock |
| **Awin publisher account** | Free to join as publisher | Historically had deposits for advertisers, not publishers — verify at signup |
| **Enterprise product data feeds** | Paid / negotiated | Some larger retailers offer paid data feeds outside standard affiliate programmes — avoid until you have traffic |
| **eBay API** (high volume) | Free tier is generous; paid tiers exist | Start on free tier. Only upgrade if you hit call limits |
| **Catawiki** | Unknown | Investigate before committing |
| **Any "premium" affiliate network tier** | Varies | Stick to standard publisher tiers — no need for paid tiers at this stage |

**Verdict:** Nothing in your MVP stack should cost money. If a retailer asks for payment upfront, decline and escalate to direct negotiation.

---

## 6. Probably Not Worth Integrating Yet

Skip these until you have live traffic and a clear user need:

| Source | Reason to skip |
|--------|----------------|
| Facebook Marketplace | No public API, no affiliate. Not suitable. |
| Gumtree, Preloved | Classifieds with no integration route. |
| Vinted | Fashion-primary. No useful API for comics. |
| Depop | No standard affiliate. Fashion-focused. |
| Whatnot | Live auction. No standard UK affiliate. |
| The Saleroom, Easy Live Auction | Niche. Low comic volume. |
| All indie publishers (Avery Hill, Soaring Penguin, Knockabout etc.) | Very low volume. Not worth until you have traffic. |
| TCG/miniature shops (Element Games, Goblin Gaming, Wayland, Leisure) | Minimal comics overlap. Investigate only if you expand to TCG. |
| BHF eBay Store | Covered already by eBay Partner Network. |
| Publishers (Penguin, HarperCollins, Hachette etc.) | They don't sell direct in meaningful volume. Use retailer affiliates instead. |

---

## 7. Exact Manual Workflow

Follow this sequence every session. Do not skip steps.

### Step 1 — Read the security reminder
Open `catch-comics-affiliate-bookmarks.html` in your browser and re-read the warning banner. Never paste credentials into Claude.

### Step 2 — Apply for Awin publisher account (one-time)
1. Go to https://www.awin.com/gb/publishers/
2. Sign up with your Catch Comics business details
3. Once approved, search the advertiser directory for: Waterstones, WHSmith, Zavvi, MusicMagpie, Oxfam Online Shop, World of Books, AwesomeBooks, Wordery, Speedyhen, Foyles, The Works, Blackwell's, Better World Books
4. Apply to each advertiser individually inside the Awin dashboard
5. Record status in the dashboard HTML for each

### Step 3 — Apply for Amazon Associates UK (one-time)
1. Go to https://affiliate-program.amazon.co.uk/
2. Apply with your Catch Comics website URL
3. Once approved, note your Associate tag in `.env.local`:
   ```
   AMAZON_ASSOCIATE_TAG=your-tag-20
   ```
4. After 3 qualifying sales, apply for PA-API access from the Associates dashboard
5. Store PA-API keys in `.env.local` only — never in code or Git

### Step 4 — Apply for eBay Partner Network (one-time)
1. Go to https://partnernetwork.ebay.co.uk/
2. Sign up and verify your site
3. Apply for eBay Finding API access at https://developer.ebay.com/
4. Store keys in `.env.local`

### Step 5 — Apply for Bookshop.org UK (one-time, fastest)
1. Go to https://uk.bookshop.org/pages/affiliate
2. Apply — approval is usually fast
3. Generates affiliate links you can append to book pages

### Step 6 — Direct outreach to Forbidden Planet
1. Find the commercial/partnerships contact on forbiddenplanet.com
2. Send a short email: introduce Catch Comics, your UK audience, and request either an affiliate link programme or a product data feed
3. Log the date and response in the dashboard notes field
4. **Stop and wait** — do not agree to terms, payments, or legal documents without reading them yourself

### Step 7 — Direct outreach to specialist comic shops
After your Awin + Amazon + eBay applications are in, email the following in batches of 3–5 per week:
- Gosh! Comics, Reed Comics, Page 45, Rebellion/2000AD, Japan Centre
- Use a single standard template — keep it to 3 short paragraphs

### Step 8 — Update the dashboard after every action
- Open `catch-comics-affiliate-bookmarks.html`
- Change status from "Not started" → "Applied" / "Approved" / "Rejected" / "Needs follow-up"
- Add any notes about contacts, dates, or conditions
- Status saves automatically to your browser's localStorage

### Step 9 — Build integrations only after approval
- Never write API integration code before you have credentials
- Once approved: store all keys in `.env.local`
- Tell Claude: "I now have [service] API credentials stored in .env.local — please help me write the integration code"
- Claude will write code that reads from `process.env` — never hardcoded values

### Step 10 — Checkpoint commit after each integration
After adding any working API or affiliate integration:
```bash
git add -p   # stage only relevant files, never .env.local
git commit -m "feat: add [service] affiliate/API integration"
git push origin main
git tag checkpoint-[service]-[date]
git push origin --tags
```

---

## Quick Reference: Which 10 to Apply to First

**By highest commercial value (revenue potential):**
1. Amazon UK (Associates + PA-API)
2. eBay UK (Partner Network + API)
3. Waterstones (Awin)
4. Forbidden Planet (direct)
5. World of Books (affiliate)
6. MusicMagpie (Awin)
7. WHSmith (Awin)
8. Zavvi (Awin)
9. Bookshop.org UK
10. AbeBooks (via Amazon Associates)

**By easiest / fastest to apply:**
1. Bookshop.org UK (simplest form, fastest approval)
2. Amazon Associates (automated approval)
3. eBay Partner Network (automated approval)
4. Awin publisher account (covers ~10 retailers at once)
5. World of Books (direct affiliate page)
6. MusicMagpie (via Awin once joined)
7. Waterstones (via Awin once joined)
8. Zavvi (via Awin once joined)
9. Oxfam Online Shop (via Awin once joined)
10. Better World Books (direct affiliate page)

**Most likely to cost money:**
- Nothing in the MVP stack should cost money
- Amazon PA-API is free but gated — just needs 3 affiliate sales first
- eBay API free tier is generous for MVP use
- Awin is free for publishers
- Watch out for: any retailer offering a "premium" product feed for a monthly fee — avoid until post-launch

---

*Last updated: 2026-04-30 · Catch Comics planning file — do not commit to GitHub*
