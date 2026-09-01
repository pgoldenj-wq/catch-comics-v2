#!/usr/bin/env node
/**
 * verification-integrity.mjs — makes an allowlisted verification command mean
 * "run this reviewed mechanism", not "run whatever it has been redefined to".
 *
 * THE HOLE THIS CLOSES (measured, not theorised — 2026-08-31, CLI 2.1.251)
 * The repair session may edit files, and `npm run check` was allowlisted. So a
 * repair could:
 *
 *   1. rewrite package.json so "check" is `echo PWNED-VIA-PACKAGE-JSON`
 *   2. run `npm run check`
 *   3. watch the CLI approve it — the command STRING was on the allow list
 *
 * A throwaway-repo probe did exactly that, and the sibling case too: leave the
 * script definition alone and rewrite the runner it invokes
 * (`node scripts/runner.mjs`). Both executed. Zero permission denials. An
 * allowlist of command strings is not an allowlist of behaviour once the thing
 * behind the string is writable.
 *
 * HOW IT IS CLOSED
 * A PreToolUse hook, wired on the argv (not from any settings file the repair
 * could edit) and living in the FOUNDER'S checkout rather than the repair's
 * worktree, so the repair cannot reach the gate itself. Before any gated
 * `npm run <script>` executes, the gate compares against the repair's base
 * commit:
 *
 *   - the script's definition in package.json,
 *   - every repo file that definition names as its entrypoint, and
 *   - every repo module those entrypoints import, transitively, up to the
 *     subject boundary described below.
 *
 * Unchanged → the command runs. Changed, or absent at base → refused, with the
 * reason said plainly.
 *
 * WHY THE IMPORTS AND NOT JUST THE ENTRYPOINTS (closed 2026-09-01)
 * Freezing the entrypoint freezes its assertions, which is most of the value —
 * a repair cannot weaken the checks that judge it. It does not freeze what the
 * entrypoint DELEGATES to. test:founder-review is the clearest case: its runner
 * is a thin driver over five modules in launch/operations, so hashing the
 * driver alone left all five writable by the very session being judged. A green
 * result from that arrangement proves the rewritten mechanism agrees with
 * itself, and nothing else. Not a privilege escalation — the live gate is
 * addressed in the founder's checkout and the argv was fixed at launch — but a
 * green tick that cannot be believed, which is the failure mode this whole
 * system exists to refuse.
 *
 * WHAT IS DELIBERATELY NOT CHECKED
 * The application and library code UNDER test. That is the whole point of a
 * repair: it edits `lib/`, `app/`, then runs the approved suite over its
 * changes. Only the mechanism is frozen, never the subject.
 *
 * So the import walk stops dead at SUBJECT_ROOTS. Freezing the closure whole
 * would mean a repair could fix lib/identity/isbn.ts and then be refused
 * permission to run test:isbn over the fix — the inversion of the point.
 * The boundary is ABSORBING, not merely skipped: nothing reached only THROUGH
 * lib/ or app/ is frozen either, because a repair free to rewrite lib/a.ts is
 * equally free to delete its import of whatever lies beyond, so freezing past
 * the boundary would buy a guarantee that is not actually there.
 *
 * Measured across all sixteen allowlisted test scripts on 2026-09-01: fourteen
 * gain nothing frozen at all (their whole closure is lib/), and the three that
 * do gain seven files between them, every one repair or ops machinery. The
 * cost of this is not paid by ordinary repairs.
 *
 * A CONSEQUENCE WORTH STATING
 * A repair cannot write a NEW test file and then run it — a runner that did not
 * exist at base is not a reviewed mechanism. It should say so in its report and
 * leave the test for a human to run. That is the property working, not a bug.
 *
 * Also runs as the hook itself:
 *   node verification-integrity.mjs --hook --repo <path> --base <sha> [--worktree <path>]
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { dirname as pdirname, join as pjoin } from 'node:path/posix'

/** Repo-relative source files a script definition names as its entrypoint.
 *  Scoped to the directories this repo actually keeps runnable code in, so the
 *  match stays reviewable rather than trying to be a shell parser. */
const ENTRYPOINT_RE = /(?:^|[\s"'=])((?:scripts|lib|app|tests|launch)\/[A-Za-z0-9._/-]+\.(?:ts|tsx|mjs|cjs|js))/g

/** Every `npm run <script>` in a command, compound commands included. */
const NPM_RUN_RE = /\bnpm\s+run\s+([^\s&|;)'"]+)/g

export function scriptsNamedIn(command) {
  const out = []
  for (const m of String(command).matchAll(NPM_RUN_RE)) out.push(m[1])
  return out
}

export function entrypointsIn(definition) {
  const out = new Set()
  for (const m of String(definition ?? '').matchAll(ENTRYPOINT_RE)) out.add(m[1])
  return [...out]
}

function git(repoRoot, args) {
  const r = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8', windowsHide: true, timeout: 30_000 })
  return { status: r.status, stdout: r.stdout ?? '', stderr: (r.stderr ?? '').trim() }
}

/** A blob exactly as it stood at the base commit, or null if it was not there. */
export function blobAt(repoRoot, base, relPath) {
  const r = git(repoRoot, ['show', `${base}:${relPath}`])
  return r.status === 0 ? r.stdout : null
}

/** Line endings are not a modification. git may hand back LF where the working
 *  copy has CRLF (core.autocrlf is on here), and that must not read as tampering. */
const normalise = s => String(s).replace(/\r\n/g, '\n')

/* ── The modules the entrypoints import ──────────────────────────────────── */

/** Where a repair's own work lives. Reaching one of these ends that path: it is
 *  the subject, not the mechanism. See the header for why this absorbs rather
 *  than skips. */
export const SUBJECT_ROOTS = ['lib/', 'app/']

/** Bounds, so a hook that runs before every Bash command stays cheap and can
 *  never wander. Sized well clear of reality — the largest closure in this repo
 *  is 19 files at depth 5 — so hitting one means the mechanism has grown into
 *  something this gate can no longer vouch for, and that is a refusal. */
export const WALK_LIMITS = { maxDepth: 12, maxFiles: 200 }

/** ESM/CJS resolution order, plus the TS convention of writing .js for a .ts
 *  source. A specifier that matches none of these at base is a refusal, not a
 *  shrug: a mechanism file importing something absent from committed history is
 *  a slot the repair worktree could fill with a module of its own. */
const RESOLVE_SUFFIXES = ['', '.ts', '.tsx', '.mjs', '.cjs', '.js', '.json',
  '/index.ts', '/index.tsx', '/index.mjs', '/index.cjs', '/index.js']

/** Comments are stripped before scanning so that prose describing an import —
 *  which this file and its neighbours are full of — cannot be mistaken for one.
 *  Approximate by design: it protects `https://` and leaves string contents
 *  otherwise alone, which is enough for source that already parses. */
export function stripComments(src) {
  return String(src)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1')
}

/** Every module specifier a source file names. Three narrow forms rather than
 *  one clever one, for the same reason ENTRYPOINT_RE is not a shell parser. */
const SPEC_PATTERNS = [
  /(?:^|[\s;})])(?:import|export)\b[^'"]*?\bfrom\s*['"]([^'"\n]+)['"]/g,  // import x from 'y' / export * from 'y'
  /(?:^|[\s;})])import\s*['"]([^'"\n]+)['"]/g,                            // import 'y'
  /\b(?:import|require)\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g,                 // import('y') / require('y')
]

export function specifiersIn(source) {
  const clean = stripComments(source)
  const out = new Set()
  for (const re of SPEC_PATTERNS) for (const m of clean.matchAll(re)) out.add(m[1])
  return [...out]
}

export const isSubject = rel => SUBJECT_ROOTS.some(root => String(rel).startsWith(root))

/**
 * Turn one specifier into the repo-relative path it names at the base commit.
 *
 * Only repo-local forms are followed: `./`, `../` and the `@/*` → `./*` alias
 * this repo's tsconfig defines. A bare specifier is a package, and node_modules
 * is not a repair's to edit — it is not in the worktree at all, only a junction
 * to the founder's.
 *
 * Resolution is done against the BASE tree, never the worktree. Asking the
 * worktree which file a specifier resolves to would let a repair change the
 * answer by creating one.
 *
 * Returns { rel } | { unresolved: <what it tried> } | null for "not ours".
 */
export function resolveRepoSpecifier(fromRel, spec, existsAtBase) {
  const s = String(spec)
  let target
  if (s.startsWith('@/')) target = s.slice(2)
  else if (s.startsWith('./') || s.startsWith('../')) target = pjoin(pdirname(fromRel), s)
  else return null

  if (target.startsWith('..') || target.startsWith('/')) return null   // outside the repo
  const candidates = [...RESOLVE_SUFFIXES.map(x => target + x)]
  if (/\.js$/.test(target)) candidates.push(target.replace(/\.js$/, '.ts'), target.replace(/\.js$/, '.tsx'))
  for (const c of candidates) if (existsAtBase(c)) return { rel: c }
  return { unresolved: target }
}

/**
 * Everything the given entrypoints reach, as it stood at the base commit.
 *
 * Breadth-first so the chain reported to the founder is the shortest one, which
 * is the one that explains the file's presence most plainly. Cycle-safe by
 * visited set; entrypoints are seeded as already-seen because the caller has
 * checked them itself.
 *
 * `sourceOf(rel)` returns the file's text at base, or null.
 * `existsAtBase(rel)` says whether the base tree has that exact path.
 *
 * Returns { ok: true, files: Map<rel, chain> } or { ok: false, reason }.
 */
export function walkImports({ entrypoints, sourceOf, existsAtBase, limits = WALK_LIMITS }) {
  const { maxDepth, maxFiles } = { ...WALK_LIMITS, ...limits }
  const seen = new Set(entrypoints)
  const found = new Map()
  let queue = entrypoints.map(rel => ({ rel, depth: 0, chain: [rel] }))

  while (queue.length) {
    const next = []
    for (const { rel, depth, chain } of queue) {
      const src = sourceOf(rel)
      if (src === null) continue          // the caller already refused on missing entrypoints
      for (const spec of specifiersIn(src)) {
        const r = resolveRepoSpecifier(rel, spec, existsAtBase)
        if (r === null) continue          // node builtin or package
        if (r.unresolved !== undefined) {
          if (isSubject(r.unresolved)) continue   // the subject's own business, absent or not
          return {
            ok: false,
            reason: `${rel} imports "${spec}", which does not exist at the base commit. `
              + 'An unreviewed slot in the mechanism is one this worktree could fill, '
              + 'so the command is refused rather than run over whatever now sits there.',
          }
        }
        if (isSubject(r.rel) || seen.has(r.rel)) continue
        seen.add(r.rel)
        // Checked here rather than on arrival, so a graph that simply ENDS at
        // the bound is walked to completion. Only one that still has somewhere
        // to go is refused.
        if (depth + 1 >= maxDepth) {
          return {
            ok: false,
            reason: `its imports nest more than ${maxDepth} deep (${[...chain, r.rel].join(' → ')}). `
              + 'A mechanism this gate cannot walk to the end of is a mechanism it cannot vouch for.',
          }
        }
        if (found.size >= maxFiles) {
          return {
            ok: false,
            reason: `its imports reach more than ${maxFiles} files. `
              + 'A mechanism that large is past what this gate can check before every command, '
              + 'so it is left for a human to run.',
          }
        }
        const nextChain = [...chain, r.rel]
        found.set(r.rel, nextChain)
        next.push({ rel: r.rel, depth: depth + 1, chain: nextChain })
      }
    }
    queue = next
  }
  return { ok: true, files: found }
}

/* Base-commit reads are memoised: a base commit is immutable, so the answer
   cannot go stale, and a compound command asking about several scripts should
   not pay for the same blob twice. Worktree reads are never memoised — those
   are exactly the side the repair can change.

   Measured 2026-09-01, since this runs before every Bash call: node startup is
   368ms of it, and the walk adds 150ms for a script with no runner up to 830ms
   for test:founder-review's six files. Batching the blob reads through
   `git cat-file --batch` would recover most of that, and was left undone on
   purpose — it buys a few seconds across a whole repair, at the price of
   hand-parsing a binary protocol in the one file that has to stay obviously
   correct on a read. Commands that are not `npm run` pay nothing. */
const baseTreeCache = new Map()
const baseBlobCache = new Map()

/** The exact set of paths the base commit holds. -z so quoting never enters. */
export function baseTree(repoRoot, base) {
  const key = `${repoRoot}\0${base}`
  if (!baseTreeCache.has(key)) {
    const r = git(repoRoot, ['ls-tree', '-r', '-z', '--name-only', base])
    baseTreeCache.set(key, r.status === 0 ? new Set(r.stdout.split('\0').filter(Boolean)) : null)
  }
  return baseTreeCache.get(key)
}

function cachedBlobAt(repoRoot, base, rel) {
  const key = `${repoRoot}\0${base}\0${rel}`
  if (!baseBlobCache.has(key)) baseBlobCache.set(key, blobAt(repoRoot, base, rel))
  return baseBlobCache.get(key)
}

/**
 * Is this script still the reviewed mechanism?
 * Returns { ok, reason } — reason is written to be read by the founder.
 */
export function integrityOf({ repoRoot, worktree, base, script }) {
  const basePkgRaw = blobAt(repoRoot, base, 'package.json')
  if (basePkgRaw === null) return { ok: false, reason: `package.json does not exist at the base commit ${base}.` }

  let approved
  try { approved = JSON.parse(basePkgRaw).scripts?.[script] }
  catch { return { ok: false, reason: 'package.json at the base commit could not be parsed.' } }

  if (approved === undefined) {
    return {
      ok: false,
      reason: `"${script}" is not a script at the base commit, so there is no reviewed version of it to run. `
        + 'A verification command has to exist in committed history before an unattended repair may run it.',
    }
  }

  const livePath = join(worktree, 'package.json')
  if (!existsSync(livePath)) return { ok: false, reason: 'package.json is missing from the repair worktree.' }
  let current
  try { current = JSON.parse(readFileSync(livePath, 'utf8')).scripts?.[script] }
  catch { return { ok: false, reason: 'package.json in the repair worktree could not be parsed.' } }

  if (normalise(current ?? '') !== normalise(approved)) {
    return {
      ok: false,
      reason: `the definition of "${script}" has been modified in this worktree. `
        + `Approved: ${JSON.stringify(approved)}. Now: ${JSON.stringify(current ?? null)}. `
        + 'An allowlisted command runs the reviewed mechanism, not a redefined one.',
    }
  }

  const entrypoints = entrypointsIn(approved)
  for (const rel of entrypoints) {
    const baseBlob = cachedBlobAt(repoRoot, base, rel)
    if (baseBlob === null) {
      return { ok: false, reason: `"${script}" runs ${rel}, which does not exist at the base commit.` }
    }
    const livePathEntry = join(worktree, rel)
    if (!existsSync(livePathEntry)) {
      return { ok: false, reason: `"${script}" runs ${rel}, which is missing from the repair worktree.` }
    }
    if (normalise(readFileSync(livePathEntry, 'utf8')) !== normalise(baseBlob)) {
      return {
        ok: false,
        reason: `${rel} — the runner behind "${script}" — has been modified in this worktree. `
          + 'Editing a test runner does not grant permission to execute it. '
          + 'The code UNDER test may be changed freely; the mechanism that tests it may not.',
      }
    }
  }

  if (entrypoints.length === 0) return { ok: true, reason: null }

  // Everything those runners delegate to. Resolved and read at the base commit,
  // so the worktree gets no say in which files the walk even looks at.
  const tree = baseTree(repoRoot, base)
  if (tree === null) {
    return { ok: false, reason: `the file listing for base commit ${base} could not be read, so nothing about "${script}" can be vouched for.` }
  }
  const walk = walkImports({
    entrypoints,
    sourceOf: rel => cachedBlobAt(repoRoot, base, rel),
    existsAtBase: rel => tree.has(rel),
  })
  if (!walk.ok) return { ok: false, reason: `"${script}" cannot be vouched for: ${walk.reason}` }

  for (const [rel, chain] of walk.files) {
    const baseBlob = cachedBlobAt(repoRoot, base, rel)
    if (baseBlob === null) {
      return { ok: false, reason: `"${script}" reaches ${rel}, which cannot be read at the base commit.` }
    }
    const livePathDep = join(worktree, rel)
    if (!existsSync(livePathDep)) {
      return {
        ok: false,
        reason: `${rel} — imported by the mechanism behind "${script}" (${chain.join(' → ')}) — `
          + 'has been deleted from this worktree. A missing module is not a reviewed one.',
      }
    }
    if (normalise(readFileSync(livePathDep, 'utf8')) !== normalise(baseBlob)) {
      return {
        ok: false,
        reason: `${rel} has been modified in this worktree, and "${script}" runs it: ${chain.join(' → ')}. `
          + 'That module is part of the mechanism that does the verifying, not the code being verified, '
          + 'so a pass from it would only show the rewritten version agreeing with itself. '
          + `Application code under ${SUBJECT_ROOTS.join(' and ')} may be changed freely; this is not that.`,
      }
    }
  }

  return { ok: true, reason: null }
}

/**
 * The verdict for one whole Bash command. null means "nothing here for this
 * gate to judge" — the CLI's own allow/deny rules remain the only authority on
 * whether the command was permitted in the first place. This gate only ever
 * SUBTRACTS from what the allow list already granted.
 */
export function verdictForCommand({ repoRoot, worktree, base, command }) {
  for (const script of scriptsNamedIn(command)) {
    const v = integrityOf({ repoRoot, worktree, base, script })
    if (!v.ok) return v
  }
  return null
}

/* ── Hook mode ───────────────────────────────────────────────────────────────
   Claude Code calls this before every Bash tool use, over stdin. Anything this
   process cannot parse or decide is left alone: a gate that fails closed on a
   malformed event would block repairs for reasons that have nothing to do with
   integrity, and the CLI's allow list is still in force underneath.          */

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

export async function hookMain(stdinText) {
  const repoRoot = arg('repo')
  const base = arg('base')
  const worktree = arg('worktree') || process.cwd()
  if (!repoRoot || !base) return 0

  let event
  try { event = JSON.parse(stdinText) } catch { return 0 }
  if (event?.tool_name !== 'Bash') return 0
  const command = event?.tool_input?.command
  if (typeof command !== 'string' || !command) return 0

  const verdict = verdictForCommand({ repoRoot: resolve(repoRoot), worktree: resolve(worktree), base, command })
  if (!verdict) return 0

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `Refused by the repair integrity gate: ${verdict.reason}`,
    },
  }))
  // Exit 2 is the documented block signal as well; the reason on stderr is what
  // the session is shown if this build prefers the exit code to the JSON.
  process.stderr.write(`Refused by the repair integrity gate: ${verdict.reason}`)
  return 2
}

if (process.argv.includes('--hook')) {
  let buf = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', d => { buf += d })
  process.stdin.on('end', async () => { process.exit(await hookMain(buf)) })
}
