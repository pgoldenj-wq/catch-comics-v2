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
 *   - the script's definition in package.json, and
 *   - every repo file that definition names as its entrypoint.
 *
 * Unchanged → the command runs. Changed, or absent at base → refused, with the
 * reason said plainly.
 *
 * WHAT IS DELIBERATELY NOT CHECKED
 * The application and library code UNDER test. That is the whole point of a
 * repair: it edits `lib/`, `app/`, then runs the approved suite over its
 * changes. Only the mechanism is frozen, never the subject.
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

  for (const rel of entrypointsIn(approved)) {
    const baseBlob = blobAt(repoRoot, base, rel)
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
