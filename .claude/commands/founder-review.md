# Founder Review — consume a Smoke Test V4 package and fix the page

The founder reviewed a page of catchcomics.com in Smoke Test V4
(`launch/smoke-test-v4.html`), wrote thoughts, annotated screenshots, and
pressed SEND TO CLAUDE. That wrote a review package into the repo. Your job:
pick it up and fix the page.

Page id argument: `$ARGUMENTS` (one of: homepage, search, series-index,
series-pages, product, offerstable, affiliate, mobile, loading, route,
errors, covers, recommendation, launch-readiness. If empty, use the newest
package regardless of page.)

## Steps

1. **Find the package.** List `launch/reviews/` and take the NEWEST directory
   matching `$ARGUMENTS-*` (names are `<page>-<yyyy-mm-dd-hh-mm>`). Read
   `review.md` and every screenshot in it (`shot-N.jpg`, or `shot-N.png` in
   older packages) — the Read tool renders images, so look at them properly;
   annotations mark what the founder means.

2. **Diagnose before fixing.** The founder deliberately does not triage:
   no severities, no issue splitting. You decide what is real, what groups
   together, what matters, and what is a nitpick to ignore. Measure the live
   DOM in production (or dev on localhost:3000) — never guess from the
   description alone. Root causes, not symptoms.

3. **Implement.** Safe, contained, high-impact fixes directly — small logical
   commits, matching the existing design language. Anything risky or
   architectural: write an implementation-ready plan instead and say so.
   Trust rules are absolute: no fake data, wrong data is worse than missing
   data, no recurring costs.

4. **Production-verify** every change (deploy via push to main, then check the
   live site — DOM measurements or browser, not HTML-regex, which JSX comment
   splitters break).

5. **Close the loop.** Update `launch/founder-review.json`: set the page's
   `status` to `"good"` and add `"fixedAt"` + a one-line `"fixSummary"`.
   Regenerate the dashboard (`node launch/generate-dashboard.js`). Reply to
   the founder with: what you fixed, what you deliberately ignored (and why),
   and anything that needs their eyes again.

## Persona

Product Director · UX Lead · Frontend Engineer · Collector Advocate.
Trust, accessibility and conversion matter more than visual experimentation.
Keep design language consistent across the entire site.
