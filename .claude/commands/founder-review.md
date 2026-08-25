# Founder Review — consume a Smoke Test V4 package and fix the page

The founder reviewed a page of catchcomics.com in Smoke Test V4
(`launch/smoke-test-v4.html`), wrote issues, attached annotated screenshots to
individual issues, and pressed SEND. The local bridge wrote a review package
into the repo and normally starts this repair session itself.

**You are usually launched automatically** by
`launch/operations/founder-review-handler.mjs` with the package path already in
your prompt. This command exists for the two cases where that did not happen:
the bridge was down (the founder used the manual fallback), or Claude Code was
not signed in when the package was written and the founder is picking it up by
hand afterwards.

Page id argument: `$ARGUMENTS` (one of: homepage, search, series-index,
series-pages, product, offerstable, affiliate, mobile, loading, route,
errors, covers, recommendation, launch-readiness. If empty, use the newest
package regardless of page.)

## Steps

1. **Find the package.** List `launch/reviews/` and take the NEWEST directory
   matching `$ARGUMENTS-*` (names are `<page>-<yyyy-mm-dd-hh-mm>-<id>`). Read
   `review.md` for the founder's own words and `review.json` for the structured
   form — `review.json` is authoritative for which screenshot belongs to which
   issue.

2. **Open every screenshot.** They are in `screenshots/`, named for the issue
   they belong to (`issue-02-shot-1.jpg` is evidence for `issue-02`;
   `page-shot-1.jpg` is about the page in general). Use the Read tool on each
   image file so you actually SEE it — the founder drew annotations onto these
   images and those marks are part of what the issue means. Never work from the
   filename or the written description alone, and never attribute a screenshot
   to an issue other than the one `review.json` assigns it to.

3. **Diagnose before fixing.** The founder deliberately does not triage: every
   issue has `"severity": null`. You decide what is real, what groups together,
   what matters, and what is a nitpick to ignore. Measure the live DOM in
   production (or dev on localhost:3000) — never guess from the description
   alone. Root causes, not symptoms.

4. **Implement.** Safe, contained, high-impact fixes directly — small logical
   commits on a focused branch, matching the existing design language. Do not
   weaken, skip or delete tests. Preserve unrelated work: this working tree
   often carries changes that are none of your business, and more than one
   session may be running in it. Anything risky or architectural: write an
   implementation-ready plan instead and say so. Trust rules are absolute: no
   fake data, wrong data is worse than missing data, no recurring costs.

5. **Verify** what you touched — typecheck, lint, the relevant test. Not a full
   audit. (When launched automatically, `git push` and `vercel` are denied to
   the session outright; deploying is the founder's call.)

6. **Close the loop.** `launch/founder-review.json` already records the page's
   verdict and a `lastReviewId` pointing at the package — the bridge writes it
   on submission. Add `"fixedAt"` and a one-line `"fixSummary"` to that page's
   entry, and set `status` to `"good"` only if you actually fixed everything.
   Regenerate the dashboard (`node launch/generate-dashboard.js`). Reply to the
   founder issue by issue: diagnosis, fix, verification, and anything left
   unresolved with the reason.

## Package shape

```
launch/reviews/<page>-<timestamp>-<id>/
  review.json          structured: issues, issue→screenshot mapping, checkpoints
  review.md            the same review as prose, for reading
  screenshots/         issue-NN-shot-N.jpg | page-shot-N.jpg
  run.json             what the automatic launch did (state, exit code, session id)
  claude-run.jsonl     transcript of the automatic run, if one happened
```

`launch/reviews/` is gitignored — packages are local founder evidence, never
committed.

## Persona

Product Director · UX Lead · Frontend Engineer · Collector Advocate.
Trust, accessibility and conversion matter more than visual experimentation.
Keep design language consistent across the entire site.
