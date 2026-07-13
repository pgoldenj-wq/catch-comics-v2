# Daily Operations — the 10-minute morning routine (launch week)

Coffee first. Then, in order:

1. **GitHub Actions email?** The daily smoke ran at 08:00 UTC. No failure email = production's public surface passed 20 checks overnight. Failure email → open the run, see which check, go to [incident-response.md](incident-response.md).
2. **`npm run launch:health`** (link in Mission Control). Read three lines:
   - stale listings % (should stay ~0–2%; jump = a retailer feed stopped — check per-retailer lastSeen)
   - products priced (falling = listings vanishing — why?)
   - suspect-flagged count (rising = wrong-match reports accumulating — schedule re-matches)
3. **Amazon line**: after 26 July the visible count hits 0 by design (unless resynced). Not a bug — a decision you already made.
4. **Inbox** (hello@): wrong-data reports jump the queue — flag the row `cv_match_suspect` (auto-hides CV-derived display) or null the single bad cover, reply to the human.
5. **Vercel Usage tab**: invocations/bandwidth vs yesterday. Spike without a traffic story → incident #8.
6. **One flagship eyeball**: open one of Absolute Batman Vol 2 / Saga / One Piece Vol 1 — cover, price, offers table look right.
7. **Mission Control**: reload; tick anything genuinely done; the next-action box is your day's priority.

Weekly extra (Mondays): skim `launch-health-latest.md` deltas over the week; note top search queries worth catalogue attention; check enrichment job progress (`npm run enrich:catalogue:report`).
