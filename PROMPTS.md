# Catch Comics — Prompt Templates

Copy the relevant template, fill in the brackets, paste into Claude Code.

---

## BUG DIAGNOSIS
```
DIAGNOSE ONLY — do not edit any files.

Bug: [exact description]
Expected: [what should happen]
Actual: [what happens]
URL: [e.g. localhost:3000/comic/12345]

Read the relevant files and tell me:
1. Which file and line is likely causing this
2. What the fix would be (describe only, do not implement)
3. Any other files affected

Files to check: [list]
Do NOT edit anything.
```

---

## SMALL UI CHANGE
```
SCOPE: UI only. Do not touch API routes, scoring, or logic files.
⚠ Do not change any styles, spacing, or colours not mentioned below.

Change: [exact description]
File: [single file]
Section: [component name or line range]

Read the file first. Show me the current code at that section.
Then implement. Stop before git push — I will verify on localhost first.
```

---

## API FIX
```
SCOPE: Backend only. Do not touch any component or page files.

Problem: [description]
Endpoint: /api/[...]
File: [single file]

Expected response: [JSON]
Actual response: [JSON or error]

Read the file, identify the issue, implement the fix.
Run: npm run check
Report files changed. Stop before git push.
```

---

## SEARCH RELEVANCE
```
SCOPE: lib/parseComicQuery.ts and/or app/api/search/route.ts only.

Problem: Query "[X]" returns "[Y]" at position [N].
Expected: "[Z]" at position 1.

Do not change any other files.
Read the scoring function. Explain why the wrong result ranks higher.
Then fix it. Stop before git push.
```

---

## DO NOT TOUCH DESIGN MODE
```
CONSTRAINT: Logic/data fix only.
You may NOT change:
- font sizes, colours, padding, margins, border-radius
- component structure or layout
- any inline styles unrelated to the bug
- any file not listed below

Files in scope: [list]
Task: [description]
```

---

## PRODUCTION ISSUE
```
DIAGNOSE ONLY.

Issue: [description] on www.catchcomics.com
Works on localhost: [yes/no]
Last commit pushed: [hash or message]

Check:
1. Is Vercel using the correct commit?
2. Are env vars likely missing?
3. Build error or runtime error?

Do not edit any files. Give me a diagnosis and the single next action.
```

---

## ROLLBACK
```
ROLLBACK — do not execute yet, plan first.

Broken commit: [hash]
Last known good: [hash or "before [feature]"]

1. Show git log between these commits
2. List files changed
3. Recommend: revert commit / hard reset / patch forward

Do not run any git commands yet.
```

---

## RULES (read before prompting)

- One concern per prompt
- Name the exact files in scope
- State what must NOT change
- End with success criteria on localhost
- Never push until you verify on localhost:3000 first
- Push to `dev` only — merge to `main` to go live
