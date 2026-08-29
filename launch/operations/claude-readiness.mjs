#!/usr/bin/env node
/**
 * claude-readiness.mjs — the ONE place that knows whether Claude Code is usable.
 *
 * WHY THIS EXISTS
 * The founder used to discover that Claude Code had signed itself out at the
 * worst possible moment: after finishing a page review, at the instant they
 * pressed "Send to Claude". The fix is not a better error message — it is
 * knowing before the work starts. Command Centre and the Smoke Test both ask
 * this module the same question and get the same answer, so there is exactly
 * one definition of "ready" on this machine.
 *
 * WHAT IT ANSWERS
 *   readiness() -> one of four states, never collapsed into "Claude failed":
 *     not-installed     the executable genuinely is not on this machine
 *     signin-required   the CLI is here, but `claude auth status` says signed out
 *     repo-unavailable  signed in, but the Catch Comics repo is not where we are
 *     connected         all three are true
 *   The bridge being down is NOT one of these: that is the caller's own
 *   condition (it cannot reach this module at all), and the UI says so
 *   separately. Telling the founder to sign in when the bridge is off would be
 *   a lie.
 *
 * HOW IT ASKS
 * Through the installed CLI's own supported commands, checked against the
 * binary rather than remembered:
 *     claude --version           -> version string
 *     claude auth status --json  -> { loggedIn, authMethod, email, ... }
 *     claude auth login          -> the supported sign-in flow (interactive)
 * `claude auth ...` is what CLI 2.1.251 documents (`claude auth --help`).
 * Do not swap in a remembered incantation without re-reading that help output.
 *
 * WHAT IT NEVER DOES
 *   - No credential is read, stored, echoed or logged. The only auth facts that
 *     leave here are the boolean, the method name, the account label and the
 *     plan — the same things the CLI prints for the founder anyway. There is no
 *     code path to a token.
 *   - No command comes from outside. Every argv below is a literal. The only
 *     variable parts are the executable path (discovered here) and the repo
 *     root (this file's own location), and both are asserted safe before use.
 *   - Nothing is spawned on import, and status is cached, so opening a page
 *     cannot turn into a subprocess storm.
 */

import { spawnSync, spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/* ── Where we are ────────────────────────────────────────────────────────── */

/** This file lives at <repo>/launch/operations/, so the repo root is two up.
 *  Same derivation the bridge uses — the founder never picks a folder. */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * Prove the resolved root really is the Catch Comics repository rather than
 * whatever directory this file was copied into. Cheap, and it is the check
 * that keeps "Open Claude Code" from starting a session in the wrong place.
 */
export function checkRepo(root = REPO_ROOT) {
  const pkg = join(root, 'package.json')
  if (!existsSync(pkg)) return { ok: false, root, name: null, reason: 'package.json is not there' }
  try {
    const parsed = JSON.parse(readFileSync(pkg, 'utf8'))
    if (parsed.name !== 'catch-comics') {
      return { ok: false, root, name: parsed.name ?? null, reason: `that directory is "${parsed.name}", not catch-comics` }
    }
    return { ok: true, root, name: parsed.name, reason: null }
  } catch (err) {
    return { ok: false, root, name: null, reason: `package.json could not be read (${err.message})` }
  }
}

/* ── Finding the CLI ─────────────────────────────────────────────────────── */

/**
 * Find the Claude Code executable. The npm shim is a .cmd, which Node refuses
 * to spawn without a shell — and a shell is exactly what must not be involved
 * here — so the real binary inside the package is used instead.
 */
export function findClaude() {
  const home = process.env.USERPROFILE || process.env.HOME || ''
  const appdata = process.env.APPDATA || (home ? join(home, 'AppData', 'Roaming') : '')
  const candidates = [
    appdata && join(appdata, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'),
    home && join(home, '.claude', 'local', 'claude.exe'),
    home && join(home, '.local', 'bin', 'claude.exe'),
    home && join(home, '.local', 'bin', 'claude'),
    '/usr/local/bin/claude',
  ]
  for (const p of candidates) if (p && existsSync(p)) return p
  return null
}

/** The CLI's own version string, or null if it would not answer. */
export function claudeVersion(exe) {
  const r = spawnSync(exe, ['--version'], { timeout: 20_000, windowsHide: true, encoding: 'utf8' })
  if (r.error || r.status !== 0) return null
  return (r.stdout || '').trim() || null
}

/* ── Authentication, as the CLI reports it ───────────────────────────────── */

/**
 * `claude auth status --json`. Exit status is 0 signed in, 1 signed out, and
 * the JSON says the same thing; the JSON is what is believed, because that is
 * the documented output and the code is not.
 *
 * Returns { loggedIn, method, account, plan, error } and nothing else. The
 * response deliberately drops orgId and every other field: the founder needs to
 * know WHICH account is connected, not to have the rest of it copied around.
 */
export function readAuth(exe) {
  const r = spawnSync(exe, ['auth', 'status', '--json'], { timeout: 30_000, windowsHide: true, encoding: 'utf8' })
  if (r.error) return { loggedIn: false, method: null, account: null, plan: null, error: r.error.message }
  let parsed = null
  try { parsed = JSON.parse(String(r.stdout || '').replace(/^\uFEFF/, '')) } catch { /* fall through */ }
  if (!parsed || typeof parsed.loggedIn !== 'boolean') {
    return {
      loggedIn: false, method: null, account: null, plan: null,
      error: 'claude auth status did not return the JSON this CLI version documents',
    }
  }
  return {
    loggedIn: parsed.loggedIn,
    method: parsed.authMethod ?? null,
    account: typeof parsed.email === 'string' ? parsed.email : null,
    plan: typeof parsed.subscriptionType === 'string' ? parsed.subscriptionType : null,
    error: null,
  }
}

/* ── The composite state, cached ─────────────────────────────────────────── */

/** The command a founder would type if every button here were unavailable. */
export const SIGNIN_COMMAND = 'claude auth login'
export const INSTALL_COMMAND = 'npm i -g @anthropic-ai/claude-code'

const TTL_IDLE_MS = 20_000        // ordinary page visits
const TTL_SIGNIN_MS = 2_500       // while a sign-in is underway — never faster
const SIGNIN_WINDOW_MS = 15 * 60_000

let cache = null                  // last computed readiness
let cacheAt = 0
let signinLaunchedAt = 0          // 0 = no sign-in has been started from here

/** Record that a sign-in was launched, which is what shortens the cache TTL. */
export function noteSigninLaunched(now = Date.now()) { signinLaunchedAt = now }
export function signinActive(now = Date.now()) {
  return signinLaunchedAt > 0 && now - signinLaunchedAt < SIGNIN_WINDOW_MS
}

/** Forget the cached answer. Used by the tests and by the bridge's own reset. */
export function resetReadinessCache() { cache = null; cacheAt = 0; signinLaunchedAt = 0 }

const HEADLINE = {
  'connected': 'Claude Code · Connected',
  'signin-required': 'Claude Code · Sign-in required',
  'not-installed': 'Claude Code · Not installed',
  'repo-unavailable': 'Claude Code · Repo not found',
}

/**
 * The whole answer, in one object, for both interfaces.
 *
 * `fresh` bypasses the idle cache — the Command Centre passes it while polling
 * after a sign-in. It is still floor-limited to TTL_SIGNIN_MS, so a stuck poll
 * loop cannot spawn the CLI faster than once every 2.5 seconds.
 */
export function readiness({ fresh = false, now = Date.now(), deps = {} } = {}) {
  const find = deps.findClaude ?? findClaude
  const version = deps.claudeVersion ?? claudeVersion
  const auth = deps.readAuth ?? readAuth
  const repoCheck = deps.checkRepo ?? checkRepo

  const ttl = fresh || signinActive(now) ? TTL_SIGNIN_MS : TTL_IDLE_MS
  if (cache && now - cacheAt < ttl) return { ...cache, cached: true }

  const exe = find()
  const repo = repoCheck()
  let claude = { installed: false, version: null }
  let a = { loggedIn: false, method: null, account: null, plan: null, error: null }

  if (exe) {
    claude = { installed: true, version: version(exe) }
    a = auth(exe)
  }

  // Precedence is deliberate: nobody can sign in to something that is not
  // installed, and a repo problem is not an authentication problem.
  const state = !exe ? 'not-installed'
    : !a.loggedIn ? 'signin-required'
      : !repo.ok ? 'repo-unavailable'
        : 'connected'

  const detail = state === 'connected'
    ? `Signed in${a.account ? ` as ${a.account}` : ''}${a.plan ? ` · ${a.plan}` : ''} · repo ${repo.name}`
    : state === 'signin-required'
      ? 'Claude Code is installed but signed out. One button fixes it.'
      : state === 'not-installed'
        ? `Install it once with: ${INSTALL_COMMAND}`
        : `Claude Code is signed in, but ${repo.reason}.`

  const value = {
    state,
    headline: HEADLINE[state],
    detail,
    claude,
    auth: { loggedIn: a.loggedIn, method: a.method, account: a.account, plan: a.plan, error: a.error },
    repo: { ok: repo.ok, root: repo.root, name: repo.name, reason: repo.reason },
    signin: { active: signinActive(now), command: SIGNIN_COMMAND },
    installCommand: INSTALL_COMMAND,
    checkedAt: new Date(now).toISOString(),
  }

  // A completed sign-in ends the fast-poll window immediately: there is nothing
  // left to watch for, so the CLI stops being spawned every few seconds.
  if (state === 'connected') signinLaunchedAt = 0

  cache = value
  cacheAt = now
  return { ...value, cached: false }
}

/* ── Opening a real terminal window ──────────────────────────────────────── */

/**
 * Refuse anything a Windows command interpreter would treat as syntax. Nothing
 * reaches here from a browser, so this is not a sanitiser standing between the
 * page and a shell — it is a tripwire for the one genuinely environmental
 * input: an install or repo path containing console punctuation. Refusing to
 * open a window beats opening the wrong one.
 */
const CMD_META = /[&|<>^"%\r\n]/
function assertLiteral(value, what) {
  if (typeof value !== 'string' || !value.length) throw new Error(`${what} is missing`)
  if (CMD_META.test(value)) throw new Error(`${what} contains characters this launcher will not pass to a console: ${value}`)
}

/**
 * Open a NEW visible console window running a fixed executable.
 *
 * Why cmd's `start`: a console application spawned from the bridge (which runs
 * minimised) otherwise inherits that minimised console or, with Node's
 * `detached`, gets DETACHED_PROCESS and no console at all — precisely wrong for
 * an interactive sign-in. `start` is the supported way to ask Windows for
 * CREATE_NEW_CONSOLE. Every argument is a literal from this module; none is
 * ever built from a request.
 */
export function openConsole({ title, exe, args = [], cwd = REPO_ROOT, spawnFn = spawn }) {
  if (process.platform !== 'win32') {
    throw new Error('Opening a terminal window is implemented for Windows only — use the fallback command')
  }
  assertLiteral(title, 'window title')
  assertLiteral(exe, 'executable path')
  assertLiteral(cwd, 'working directory')
  for (const a of args) assertLiteral(a, 'argument')

  const comspec = process.env.COMSPEC || 'C:\\Windows\\System32\\cmd.exe'
  const child = spawnFn(comspec, ['/c', 'start', title, '/D', cwd, exe, ...args], {
    cwd,
    shell: false,
    stdio: 'ignore',
    windowsHide: false,
    detached: true,
  })
  if (child && typeof child.unref === 'function') child.unref()
  return child
}

/** Absolute path of the script that runs inside the sign-in window. */
export const SIGNIN_SCRIPT = join(REPO_ROOT, 'launch', 'operations', 'claude-signin.mjs')

/**
 * Launch the supported sign-in experience: a real console window, already in
 * the repo, running claude-signin.mjs — which says what is about to happen,
 * runs `claude auth login`, and confirms the outcome. The browser approval
 * Anthropic requires still happens in the founder's browser, as it must. No
 * credential is typed, stored or intercepted here.
 */
export function launchSignin({ spawnFn = spawn, now = Date.now() } = {}) {
  const exe = findClaude()
  if (!exe) return { launched: false, reason: 'not-installed' }
  if (!existsSync(SIGNIN_SCRIPT)) return { launched: false, reason: 'signin-script-missing' }
  openConsole({
    title: 'Catch Comics - Sign in to Claude Code',
    exe: process.execPath,
    args: [SIGNIN_SCRIPT],
    cwd: REPO_ROOT,
    spawnFn,
  })
  noteSigninLaunched(now)
  // The next status read must not be answered from a cache taken before the
  // window opened, or the card would look stale for a whole TTL.
  cache = null
  cacheAt = 0
  return { launched: true, reason: null }
}

/**
 * Open an interactive Claude Code session rooted in the Catch Comics repo.
 * No cd, no remembering `claude`, no wondering which directory you are in.
 */
export function launchClaudeInRepo({ spawnFn = spawn } = {}) {
  const exe = findClaude()
  if (!exe) return { launched: false, reason: 'not-installed' }
  const repo = checkRepo()
  if (!repo.ok) return { launched: false, reason: 'repo-unavailable' }
  openConsole({ title: 'Catch Comics - Claude Code', exe, args: [], cwd: repo.root, spawnFn })
  return { launched: true, reason: null }
}
