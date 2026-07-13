# Rollback Guide — two validated paths, ~2 minutes each

Production deploys automatically from `main`. Both paths below were validated against this project's setup on 2026-07-13.

## Path A — Vercel instant rollback (fastest, no git)

```bash
npx vercel ls catch-comics-v2          # list deployments — find the last good Production URL
npx vercel rollback <that-url>         # promotes it back to production immediately
npx vercel rollback status             # confirm
```

Or in the dashboard: Vercel → catch-comics-v2 → Deployments → previous Production deployment → ⋯ → **Instant Rollback**.

**Use when:** a deploy just broke production and you need it gone NOW.
**Caveat:** `main` still contains the bad commit — follow up with Path B so the next push doesn't re-deploy the breakage.

## Path B — git revert (fixes main itself)

```bash
git checkout main && git pull origin main
git log --oneline -5                   # identify the bad MERGE commit
git revert -m 1 <merge-sha>            # -m 1 = revert a merge, keeping mainline
git push origin main                   # Vercel auto-deploys the reverted state
```

For a plain (non-merge) commit, drop `-m 1`.

**Use when:** the bad change must leave `main` (always do this after Path A too).

## Known-good reference points

| Point | Ref |
|---|---|
| Wave 1+2 launch-ready state | merge `d9bc69b` (2026-07-12) |
| Pre-war-room stable tag | `PRE-MONSTER-MODE-LAUNCH-STABLE-2026-07-03` |

## After any rollback

1. `npm run launch:smoke` → PASS
2. Eyeball homepage + one product page
3. Note what was rolled back and why (one line in Mission Control notes / WEEK.md)
4. Fix the real problem on a branch; never fix-forward on `main` while prod is broken

## What rollback does NOT undo

Database contents (enrichment writes, listing syncs) are not tied to deploys. Data problems are contained by data means: `retailers.is_active = false`, `cv_match_suspect` flags, single-row cover nulls — see [incident-response.md](incident-response.md).
