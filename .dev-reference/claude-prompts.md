# 🤖 Claude Prompt Templates

> Copy → fill brackets → paste. One concern per prompt. Always diagnose before implementing.

---

## 📐 How to Prompt Claude Well

| Rule | Why |
|---|---|
| One concern per message | Scoped tasks = accurate fixes |
| Name exact files in scope | Prevents Claude touching wrong files |
| "DIAGNOSE ONLY first" | Understand the fix before it runs |
| State what must NOT change | Prevents layout/logic drift |
| End with success criteria | Claude knows when it's done |
| Never push until localhost verified | Staging ≠ production |

---

## ⚡ Most-Used Prompts

### 1 — Quick Fix (surgical, one file)

```
SCOPE: [filename] only. Do not touch any other files.
⚠ Do not change any styles, spacing, or colours not mentioned below.

Task: [exact description of what to change]
File: [exact file path]
Section: [component name or line range]

Read the file first. Show me the current code at that section.
Then implement. Stop before git push — I will verify on localhost first.
```

---

### 2 — Bug Diagnosis (read-only)

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

### 3 — Multi-Issue Diagnosis

```
CATCH COMICS — DIAGNOSE FIRST, THEN PLAN FIXES

Do not edit any files yet.

Issues:
1. [description] — likely in [file]
2. [description] — likely in [file]

For each issue, read the relevant file(s) and give me:
- Root cause (file + line)
- Proposed fix (describe only)
- Risk level

After diagnosis, give me a numbered plan. Then stop and ask which to implement first.
```

---

### 4 — API Fix

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

### 5 — Search Relevance Fix

```
SCOPE: lib/parseComicQuery.ts and/or app/api/search/route.ts only.

Problem: Query "[X]" returns "[Y]" at position [N].
Expected: "[Z]" at position 1.

Do not change any other files.
Read the scoring function. Explain why the wrong result ranks higher.
Then fix it. Stop before git push.
```

---

### 6 — Small UI Change (design-freeze safe)

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

### 7 — Logic / Data Fix (design freeze mode)

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

### 8 — Production Issue Diagnosis

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

### 9 — Rollback Plan

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

### 10 — Checkpoint / Save State

```
Save checkpoint.

Summarise what was implemented this session:
- Files changed and what changed in each
- Any known issues or edge cases not yet handled
- Suggested next steps
- Any TypeScript errors or warnings to be aware of
```

---

## 🧠 Advanced Prompt Patterns

### Force read-before-edit

```
Before making any changes, read [filename] and show me lines [X–Y].
Confirm you've read it before proceeding.
```

### Lock down scope tightly

```
Files you MAY edit: [list]
Files you must NOT touch under any circumstances: [list]
```

### Ask for plan before code

```
Do not write any code yet.
Give me a step-by-step plan for [task], listing each file you'd change and why.
I'll approve the plan before you implement.
```

### Debug-only session

```
This is a DIAGNOSIS-ONLY session.
You have READ access only. Do not suggest edits or write code.
Investigate [issue] and report back what you find.
```

---

## ⚠️ Prompt Anti-Patterns (Don't Do These)

| Bad pattern | Why it's risky |
|---|---|
| "Fix the whole search feature" | Too broad — Claude will change too much |
| "Make it look better" | No objective criteria — drifts design |
| "Push when done" | Never — you verify on localhost first |
| No file scope given | Claude will guess which files to touch |
| Multi-concern in one prompt | Bugs in one fix contaminate the other |
| "Edit PROMPTS.md while you're at it" | Unrelated task = context confusion |

---

## 📁 Files Claude Should Know About

Paste this as context at the start of complex sessions:

```
Stack: Next.js 16.2.4 App Router, TypeScript 5, Tailwind CSS 4
APIs: Comic Vine (volumes: 4050-ID, issues: 4000-ID), eBay Browse v1 (OAuth2)
Cache: In-memory TTLCache — pricesCache (1h), volumeCache, issueCache, searchCache
Branches: dev → Vercel preview, main → www.catchcomics.com

Design freeze files (no layout/spacing/colour changes without permission):
- app/page.tsx (line 2 comment)
- app/search/page.tsx (line 2 comment)
- app/comic/[id]/page.tsx (line 2 comment)
```
