# ⚡ Terminal Cheatsheet

> Ordered by daily usage frequency. Most-used at the top.

---

## 🟢 Daily Essentials

```bash
# Start dev server
npm run dev

# Type check (run before every commit)
npm run check

# See what's changed
git status

# See exact code differences
git diff

# See recent commits
git log --oneline -10
```

---

## 💾 Git — Checkpoint & Push

```bash
# Stage everything and commit
git add .
git commit -m "chore: checkpoint — describe what you did"

# Push to staging (ALWAYS dev, never main directly)
git push origin dev

# Check which branch you're on
git branch

# Switch to dev branch
git checkout dev
```

---

## 🔍 Git — Inspect Before Acting

```bash
# What's staged vs unstaged
git diff --staged

# Full history with files changed
git log --oneline --stat -5

# Compare dev to main (what would ship)
git diff main..dev --stat

# See all branches (local + remote)
git branch -a
```

---

## 🧹 Fix Stale / Broken Dev Server

```bash
# Nuclear option — clears Next.js build cache
rm -rf .next && npm run dev

# Windows version
Remove-Item -Recurse -Force .next; npm run dev

# Just restart (softer)
# Ctrl+C then npm run dev
```

> **Use when:** nothing changed visually after editing, or after a type error mid-build.

---

## 🔁 Git — Branch Management

```bash
# Create a new branch from current HEAD
git checkout -b feature/my-feature

# Switch back to dev
git checkout dev

# Pull latest from remote dev
git pull origin dev

# Merge dev into main (only when shipping)
git checkout main
git merge dev
git push origin main
```

> ⚠️ **Never push directly to `main`.** Always go through `dev` → Vercel preview → verify → merge.

---

## 🔀 Git — Merge / Rebase (Safe)

```bash
# Merge dev into main (preferred — keeps history clean)
git checkout main
git merge dev --no-ff -m "release: merge dev into main"
git push origin main

# If merge has conflicts — abort and start fresh
git merge --abort
```

---

## ↩️ Git — Undo / Rollback

```bash
# Undo last commit but keep changes (safest)
git reset --soft HEAD~1

# Undo last commit and discard changes ⚠️ DESTRUCTIVE
git reset --hard HEAD~1

# Revert a specific commit (creates a new revert commit — safest for production)
git revert <commit-hash>

# Find the hash you want to roll back to
git log --oneline -20
```

> ⚠️ `git reset --hard` permanently discards uncommitted changes. No undo.

---

## 🏷 Git — Tags & Releases

```bash
# Tag a release (after merging to main)
git tag v0.2.0 -m "Release: v0.2.0"
git push origin v0.2.0

# List tags
git tag -l
```

---

## 🔬 Inspect / Debug

```bash
# Check Node version
node -v

# Check npm version
npm -v

# List what's installed
npm list --depth=0

# Check for TypeScript errors only (faster than build)
npx tsc --noEmit

# See env vars loaded (never log real secrets)
# Check .env.local manually — never commit it
cat .env.local   # Mac/Linux
type .env.local  # Windows CMD
```

---

## 🌐 Vercel CLI (Optional)

```bash
# Install once
npm install -g vercel

# Link project
vercel link

# Pull env vars from Vercel to local
vercel env pull .env.local

# Check build logs
vercel logs

# Force a redeploy (from current commit)
vercel --prod
```

---

## ⚠️ Dangerous Commands — Read Before Running

| Command | Risk | When safe |
|---|---|---|
| `git reset --hard HEAD~1` | Destroys uncommitted work | Only after committing everything |
| `git push --force` | Rewrites remote history | **Never on `main`** |
| `rm -rf .next` | Deletes build cache | Safe — Next.js rebuilds it |
| `git clean -fd` | Deletes untracked files | After confirming with `git status` |
| `git checkout -- .` | Discards ALL local changes | Only if you have a clean checkpoint commit |

---

## 📋 Command Quick-Reference Card

| Task | Command |
|---|---|
| Start dev | `npm run dev` |
| Type check | `npm run check` |
| Git status | `git status` |
| Git diff | `git diff` |
| Stage all | `git add .` |
| Commit | `git commit -m "message"` |
| Push to dev | `git push origin dev` |
| Switch to dev | `git checkout dev` |
| Clear build cache | `rm -rf .next` |
| Undo last commit (safe) | `git reset --soft HEAD~1` |
| See recent commits | `git log --oneline -10` |
