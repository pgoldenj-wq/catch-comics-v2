#!/usr/bin/env node
/**
 * repair-worktree.mjs — the isolated tree an unattended founder repair works in.
 *
 * WHY THIS EXISTS
 * A founder-review repair runs unattended, and it needs to commit: a repair
 * that cannot commit leaves unverified edits loose in the tree, which is how
 * lib/identity/format.ts and scripts/test-format-and-price-filter.ts ended up
 * with no commit behind them. But the shared checkout is not a safe place to
 * hand an unattended session git-write rights: other Claude sessions edit this
 * repo live, the dev server runs against it, and at any moment it carries
 * around two dozen dirty files that are none of the repair's business.
 *
 * So the repair does not get git-write rights in the founder's tree. It gets
 * its own tree:
 *
 *   <repo>-repairs/<reviewId>          a real git worktree, branch repair/<id>
 *     ├── node_modules                 junction to the founder's, so tsc runs
 *     └── launch/reviews/<reviewId>    the review package, copied in
 *
 * The branch is created from HEAD, deliberately: a repair starts from what is
 * committed, so its diff is reviewable and reproducible, and nothing it does
 * can reach the founder's uncommitted work. `git worktree add` writes only to
 * .git/worktrees/ and the new directory — it does not touch the founder's
 * branch, index, dirty files or untracked files, which the handoff test proves
 * against a real repository rather than asserting here.
 *
 * The directory is a SIBLING of the repo, never a child: a child would show up
 * as untracked in the founder's `git status` forever.
 */

import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, lstatSync, mkdirSync, rmdirSync, symlinkSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'

/** Same shape the handler validates a reviewId with. Re-checked here because
 *  this turns one into a filesystem path AND a git ref, and a module that can
 *  do that should not rely on having been called politely. */
const REVIEW_ID_RE = /^[a-z0-9][a-z0-9-]{0,79}$/

export class WorktreeError extends Error {}

/** The branch a repair commits on. Namespaced so it is obvious in `git branch`
 *  who made it and which review it belongs to. */
export function repairBranch(reviewId) {
  if (!REVIEW_ID_RE.test(String(reviewId ?? ''))) throw new WorktreeError(`Unsafe reviewId: ${reviewId}`)
  return `repair/${reviewId}`
}

/** Sibling of the repo, e.g. …/CatchComics/catch-comics-repairs. */
export function worktreesRoot(repoRoot) {
  const r = resolve(repoRoot)
  return join(dirname(r), `${basename(r)}-repairs`)
}

/** The tree for one review. */
export function worktreePath(repoRoot, reviewId) {
  if (!REVIEW_ID_RE.test(String(reviewId ?? ''))) throw new WorktreeError(`Unsafe reviewId: ${reviewId}`)
  return join(worktreesRoot(repoRoot), reviewId)
}

/** Run git in the founder's repo and return it whole. Never throws on a
 *  non-zero status: every caller here wants to read the failure. */
function runGit(repoRoot, args) {
  const r = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8', windowsHide: true, timeout: 120_000 })
  return {
    status: r.status,
    stdout: (r.stdout ?? '').trim(),
    stderr: (r.stderr ?? '').trim(),
    error: r.error ?? null,
  }
}

/**
 * Make (or re-find) the repair worktree.
 *
 * Idempotent: a retry of the same review reuses the tree and branch it already
 * has, because a retry is meant to continue the same repair, not fork it.
 *
 * Returns { path, branch, base, reused, linkedModules, copiedPackage }.
 * Throws WorktreeError — the caller turns that into `blocked`, not `failed`:
 * a worktree that could not be made is an environment problem, and nothing
 * about the product has been tested at that point.
 */
export function ensureRepairWorktree(repoRoot, reviewId, {
  gitFn = runGit,
  linkNodeModules = true,
  packageRelPath = null,
} = {}) {
  const branch = repairBranch(reviewId)
  const path = worktreePath(repoRoot, reviewId)

  const inside = gitFn(repoRoot, ['rev-parse', '--is-inside-work-tree'])
  if (inside.error) throw new WorktreeError(`git could not be run: ${inside.error.message}`)
  if (inside.status !== 0 || inside.stdout !== 'true') {
    throw new WorktreeError(`${repoRoot} is not a git working tree, so an isolated repair worktree cannot be made.`)
  }

  const head = gitFn(repoRoot, ['rev-parse', 'HEAD'])
  if (head.status !== 0) throw new WorktreeError(`HEAD could not be read: ${head.stderr || 'unknown error'}`)
  const base = head.stdout

  // Already there from an earlier attempt at this same review? Reuse it.
  const listed = gitFn(repoRoot, ['worktree', 'list', '--porcelain'])
  const known = listed.status === 0
    && listed.stdout.split(/\r?\n/).some(l => l.startsWith('worktree ') && resolve(l.slice(9).trim()) === resolve(path))
  let reused = false

  if (known && existsSync(path)) {
    reused = true
  } else {
    if (known) {
      // Registered but the directory is gone — git refuses to add over that,
      // and the stale registration is the only thing in the way.
      gitFn(repoRoot, ['worktree', 'prune'])
    }
    mkdirSync(dirname(path), { recursive: true })
    const branchExists = gitFn(repoRoot, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]).status === 0
    const args = branchExists
      ? ['worktree', 'add', path, branch]
      : ['worktree', 'add', '-b', branch, path, 'HEAD']
    const add = gitFn(repoRoot, args)
    if (add.status !== 0) {
      throw new WorktreeError(`git worktree add failed: ${add.stderr || add.stdout || 'unknown error'}`)
    }
  }

  // Without node_modules there is no tsc, no eslint and no tsx, so every
  // verification command the repair is allowed to run would fail for a reason
  // that has nothing to do with the repair. A junction costs nothing and is
  // the same toolchain the founder's own commands use.
  let linkedModules = false
  const modules = join(path, 'node_modules')
  if (linkNodeModules && !existsSync(modules) && existsSync(join(repoRoot, 'node_modules'))) {
    try {
      symlinkSync(join(repoRoot, 'node_modules'), modules, process.platform === 'win32' ? 'junction' : 'dir')
      linkedModules = true
    } catch { /* verification will fail loudly and say why; this is not worth blocking a repair for */ }
  }

  // The package is gitignored, so it is not in the checkout and has to be
  // carried across. Being gitignored is also what stops the repair from ever
  // committing the founder's screenshots by accident.
  let copiedPackage = false
  if (packageRelPath) {
    const from = join(repoRoot, packageRelPath)
    const to = join(path, packageRelPath)
    if (existsSync(from)) {
      mkdirSync(dirname(to), { recursive: true })
      cpSync(from, to, { recursive: true })
      copiedPackage = true
    }
  }

  return { path, branch, base, reused, linkedModules, copiedPackage }
}

/**
 * Take a finished repair worktree away, once its commit has been used.
 *
 * This exists because `git worktree remove` alone does NOT finish the job: it
 * removes the tracked files but leaves the node_modules junction standing, so
 * the directory survives and the next `worktree add` refuses. Worse, the
 * obvious cleanup — deleting the directory recursively — FOLLOWS that junction
 * into the founder's real node_modules. So the link is unlinked first, by
 * itself, and only after lstat has confirmed it is a link.
 *
 * The BRANCH is deliberately left alone: it is where the repair's commit lives,
 * and this function's job is to remove a directory, not to throw work away.
 */
export function removeRepairWorktree(repoRoot, reviewId, { gitFn = runGit } = {}) {
  const path = worktreePath(repoRoot, reviewId)
  const modules = join(path, 'node_modules')

  if (existsSync(modules)) {
    // Never recurse into it. A junction removed with rmdir takes the link and
    // leaves the target — which is the founder's whole toolchain — untouched.
    if (!lstatSync(modules).isSymbolicLink()) {
      throw new WorktreeError(`${modules} is a real directory, not the expected junction — refusing to delete it.`)
    }
    rmdirSync(modules)
  }

  const r = gitFn(repoRoot, ['worktree', 'remove', '--force', path])
  if (r.status !== 0 && existsSync(path)) {
    throw new WorktreeError(`git worktree remove failed: ${r.stderr || r.stdout || 'unknown error'}`)
  }
  gitFn(repoRoot, ['worktree', 'prune'])

  // Tidy the parent away too, but only when this was the last repair in it.
  try { rmdirSync(worktreesRoot(repoRoot)) } catch { /* other repairs still there */ }

  return { path, branch: repairBranch(reviewId), removed: !existsSync(path) }
}
