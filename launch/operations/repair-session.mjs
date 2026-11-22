#!/usr/bin/env node
/**
 * repair-session.mjs — the VISIBLE Claude Code session a founder review opens.
 *
 * WHAT CHANGED AND WHY
 * The handoff used to run `claude -p` with its stdout piped into the bridge:
 * correct, durable, and completely invisible. The founder pressed Send and got
 * a spinner for eight minutes with no way to watch, interrupt or steer. This
 * module replaces the hidden child with a real terminal window running a real
 * interactive session, WITHOUT giving up the durable package, the bounded
 * permissions or the founder-facing report.
 *
 * THREE FACTS, MEASURED ON THIS MACHINE (CLI 2.1.251, Windows 11) — the design
 * follows from them and would be wrong without them:
 *
 *   1. A console app spawned by Node with `detached: true` gets a new window
 *      but NOT a tty: libuv always sets STARTF_USESTDHANDLES, so stdout is the
 *      null device and the TUI will not render. `cmd /c start` (and wt.exe)
 *      DO give a real tty — isTTY true, 120 columns. So the window has to be
 *      created by the OS launcher, not by Node's spawn flags.
 *
 *   2. `claude "<prompt>"` in interactive mode SUBMITS that prompt — it does
 *      not merely prefill the box. Proven against a long-trusted directory.
 *      But in a directory with no persisted trust it stops dead on the trust
 *      dialog and never sends a turn, so a freshly-created repair worktree
 *      must be trusted before the session opens. `ensureWorkspaceTrust` does
 *      exactly what the CLI's own diagnostic tells you to do.
 *
 *   3. An interactive session does NOT write its transcript to disk while it
 *      runs — the path in `transcript_path` did not exist even at Stop. So the
 *      old reporting contract cannot be met by tailing a file. HOOKS can meet
 *      it: PreToolUse carries tool_use_id and tool_input, PostToolUse carries
 *      tool_response, and Stop carries `last_assistant_message`, which is
 *      Claude's own final report.
 *
 * SO THIS FILE IS TWO PROGRAMS AND ONE LIBRARY:
 *
 *   --run <packageDir>      the WRAPPER, inside the visible window. It owns
 *                           the claude process on a real tty, and it is what
 *                           the bridge tracks: it writes session.json (its own
 *                           pid) before starting and exit.json after.
 *
 *   --record <Event> <dir>  the RECORDER, run as a hook. It appends one line
 *                           per event to claude-run.jsonl in EXACTLY the shape
 *                           repair-outcome.mjs already parses, so the whole
 *                           report pipeline is reused rather than rewritten.
 *
 *   (exports)               what the bridge needs to launch and read all this.
 *
 * WHY NOTHING FOUNDER-WRITTEN REACHES A COMMAND LINE
 * The terminal is started through cmd.exe, which means quoting mistakes are
 * security bugs. So the only things on that command line are paths this
 * process generated: node, this file, and the package directory (whose name is
 * a reviewId already matched against /^[a-z0-9][a-z0-9-]{0,79}$/). The prompt,
 * the settings JSON and the allow/deny lists travel in launch.json and are
 * handed to claude as a normal argv array with no shell involved. Founder text
 * cannot be interpreted by anything, because it never reaches anything that
 * interprets.
 */

import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'

/* ── Files that make up one visible run ──────────────────────────────────── */

/** Written by the bridge, read by the wrapper. Everything claude is started
 *  with lives here rather than on a command line. */
export const LAUNCH_FILE = 'launch.json'
/** Written by the wrapper the instant it starts: proof a window exists, and
 *  the pid the bridge watches for liveness. */
export const SESSION_FILE = 'session.json'
/** Written by the wrapper when claude exits. Authoritative over the pid: the
 *  window may stay open afterwards so the founder can read the last reply. */
export const EXIT_FILE = 'exit.json'
/** The event log. Same filename and same shape the piped run produced, so
 *  deriveReport(), describeActivity() and the report markdown are untouched. */
export const LOG_FILE = 'claude-run.jsonl'
/** Written on every Stop: the repair reported back, and this is what it said. */
export const STOP_FILE = 'stop.json'

/** One record must never be able to bury the log. Only the last line of a
 *  command's output is ever quoted, so this is generous by a wide margin. */
const MAX_RECORD_CHARS = 8000

const readJson = p => { try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return null } }

/** Everything the bridge can learn about a visible run from disk alone. */
export function readSessionState(packageDir) {
  return {
    session: readJson(join(packageDir, SESSION_FILE)),
    exit: readJson(join(packageDir, EXIT_FILE)),
    stop: readJson(join(packageDir, STOP_FILE)),
  }
}

/* ── Workspace trust ─────────────────────────────────────────────────────────
   An interactive session in an untrusted directory stops on the trust dialog
   and never sends a turn — measured, 90 seconds, zero API calls. A repair
   worktree is created seconds before the session opens, so it is untrusted by
   definition and EVERY repair would stall without this.

   This is not a loosening of anything. The directory being trusted is a
   worktree the bridge just created, from the founder's own committed HEAD, in
   the founder's own repo. The permission boundary is the allow/deny lists and
   the integrity gate; those are untouched, and they are enforced by the CLI
   whether or not the workspace is trusted.

   The CLI's own diagnostic names this exact remedy: "accept the trust dialog
   here once interactively, or set projects[<dir>].hasTrustDialogAccepted".   */

/** Where the CLI keeps per-project state. Honours the documented override. */
export function claudeConfigPath() {
  const dir = process.env.CLAUDE_CONFIG_DIR
  return dir ? join(dir, '.claude.json') : join(homedir(), '.claude.json')
}

/**
 * Mark one directory trusted, if it is not already.
 *
 * Both spellings of the path are written because the CLI has used both: the
 * live file on this machine holds `C:/Users/...` and `C:\Users\...` keys side
 * by side, and which one a given session looks up is not ours to predict.
 *
 * Written through a temp file and a rename so a concurrent session reading the
 * config never sees a half-written document. Returns what happened rather than
 * throwing: a repair that cannot be pre-trusted should still be attempted —
 * it will simply stop on the dialog, which the founder can answer, and that is
 * a far better outcome than refusing to open the window at all.
 */
export function ensureWorkspaceTrust(dirPath, { configPath = claudeConfigPath() } = {}) {
  const abs = resolve(dirPath)
  const keys = [abs, abs.split('\\').join('/')]
  let doc
  try { doc = JSON.parse(readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '')) }
  catch (err) { return { ok: false, already: false, reason: `could not read ${configPath}: ${err.message}` } }
  if (!doc || typeof doc !== 'object') return { ok: false, already: false, reason: 'the Claude config is not an object' }
  if (!doc.projects || typeof doc.projects !== 'object') doc.projects = {}

  if (keys.every(k => doc.projects[k]?.hasTrustDialogAccepted === true)) {
    return { ok: true, already: true, reason: null }
  }
  for (const k of keys) doc.projects[k] = { ...(doc.projects[k] ?? {}), hasTrustDialogAccepted: true }

  const tmp = `${configPath}.frv4.${process.pid}.tmp`
  try {
    writeFileSync(tmp, JSON.stringify(doc, null, 2))
    renameSync(tmp, configPath)
    return { ok: true, already: false, reason: null }
  } catch (err) {
    return { ok: false, already: false, reason: `could not write ${configPath}: ${err.message}` }
  }
}

/* ── Opening the window ──────────────────────────────────────────────────────
   `cmd /c start` is the choice, and it is a deliberately boring one: cmd.exe
   is on every Windows install, it was measured to give the child a real tty,
   and on Windows 11 `start` hands the console to whatever the default terminal
   is — Windows Terminal, on this machine. wt.exe was measured to work too and
   would be no better: it is a Store execution alias, so it can be missing or
   redirected, and this repo has already lost a day to MSIX path redirection.

   The `start` title is built from the PAGE ID, never from founder-supplied
   text: page ids come from a fixed list in the handler. The pretty title the
   founder actually reads is set by the wrapper, from launch.json, over an
   escape sequence — no command line involved.                                */

const quote = s => `"${String(s)}"`

/**
 * The argv that opens a visible terminal running the wrapper.
 * Returned rather than spawned so the handler can log it and the tests can
 * assert on it without opening windows.
 */
export function visibleLaunchArgv({ packageDir, cwd = packageDir, title, nodeExe = process.execPath, moduleFile = fileHere() }) {
  const line = [
    '/c', 'start', quote(title),
    // The terminal itself opens IN the repair worktree, so the founder's first
    // glance at the window is already proof of where it is working. claude is
    // then started there too, by the wrapper, from launch.json.
    '/D', quote(cwd),
    quote(nodeExe), quote(moduleFile), '--run', quote(packageDir),
  ].join(' ')
  return {
    command: 'cmd.exe',
    args: [line],
    // Node's own escaping would re-quote every one of those, which cmd then
    // reads as literal quote characters. Verbatim means what is written above
    // is what cmd receives.
    options: { windowsVerbatimArguments: true, windowsHide: false, stdio: 'ignore', shell: false },
  }
}

function fileHere() {
  return fileURLToPath(import.meta.url)
}

/* ── The recorder: hooks in, one durable transcript out ──────────────────── */

const clip = (s, n = MAX_RECORD_CHARS) => {
  const t = typeof s === 'string' ? s : JSON.stringify(s ?? null)
  return typeof t === 'string' && t.length > n ? `${t.slice(0, n)}\n…[truncated]` : (t ?? '')
}

/** A tool_response, as the one string a report can quote a line out of. */
export function responseText(resp) {
  if (resp == null) return ''
  if (typeof resp === 'string') return resp
  // Bash: {stdout, stderr, interrupted, isImage, …}
  if (typeof resp.stdout === 'string' || typeof resp.stderr === 'string') {
    return [resp.stdout ?? '', resp.stderr ?? ''].filter(Boolean).join('\n')
  }
  // Read: {type:'text', file:{content, …}}
  if (resp.file && typeof resp.file.content === 'string') return resp.file.content
  if (typeof resp.content === 'string') return resp.content
  return JSON.stringify(resp)
}

/**
 * Turn one hook payload into the transcript lines repair-outcome.mjs reads.
 *
 * PreToolUse becomes the `tool_use`; PostToolUse becomes its `tool_result`.
 * They are split across the two hooks on purpose, because of a measured fact:
 * PostToolUse does NOT fire when a tool is refused OR when it fails. A tool_use
 * with no matching tool_result is therefore exactly what a refused or failed
 * command looks like — which is already how deriveReport() reads it, with no
 * change at all. The old piped run had to be told; this one simply is.
 */
export function eventsForHook(eventName, payload) {
  const out = []
  if (eventName === 'PreToolUse' && payload?.tool_use_id) {
    out.push({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', id: payload.tool_use_id, name: payload.tool_name, input: payload.tool_input ?? {} }] },
      at: new Date().toISOString(),
    })
  }
  if (eventName === 'PostToolUse' && payload?.tool_use_id) {
    out.push({
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: payload.tool_use_id, is_error: false, content: clip(responseText(payload.tool_response)) }] },
      at: new Date().toISOString(),
    })
  }
  if (eventName === 'SessionStart') {
    out.push({ type: 'system', subtype: 'init', session_id: payload?.session_id ?? null, model: payload?.model ?? null, at: new Date().toISOString() })
  }
  if (eventName === 'Stop') {
    // Claude's own words, carried verbatim, in the same block shape an
    // assistant text turn has — so the report renders it exactly as before.
    const text = typeof payload?.last_assistant_message === 'string' ? payload.last_assistant_message : ''
    out.push({ type: 'assistant', message: { content: [{ type: 'text', text: clip(text, 64_000) }] }, at: new Date().toISOString() })
  }
  return out
}

/** Run as a hook. Never fails the tool call: a recorder that could block a
 *  repair would be a worse bug than a missing line in a log. */
export async function recordMain(eventName, packageDir, stdinText) {
  let payload = null
  try { payload = JSON.parse(stdinText) } catch { payload = null }
  try {
    mkdirSync(packageDir, { recursive: true })
    const lines = eventsForHook(eventName, payload).map(e => JSON.stringify(e)).join('\n')
    if (lines) appendFileSync(join(packageDir, LOG_FILE), lines + '\n')
    if (eventName === 'Stop') {
      writeFileSync(join(packageDir, STOP_FILE), JSON.stringify({
        at: new Date().toISOString(),
        sessionId: payload?.session_id ?? null,
        lastAssistantMessage: clip(payload?.last_assistant_message ?? '', 64_000),
      }, null, 2))
    }
    if (eventName === 'SessionStart') {
      const f = join(packageDir, SESSION_FILE)
      const cur = readJson(f) ?? {}
      writeFileSync(f, JSON.stringify({ ...cur, sessionId: payload?.session_id ?? null, model: payload?.model ?? null, startedTurnsAt: new Date().toISOString() }, null, 2))
    }
    if (eventName === 'SessionEnd') {
      const f = join(packageDir, EXIT_FILE)
      if (!existsSync(f)) writeFileSync(f, JSON.stringify({ exitCode: 0, endedAt: new Date().toISOString(), via: 'SessionEnd' }, null, 2))
    }
  } catch { /* the log is evidence, not a gate */ }
  return 0
}

/* ── The wrapper: owns claude, on the visible tty ────────────────────────── */

/**
 * The environment the repair session gets.
 *
 * MEASURED, 2026-09-01. The bridge is started from Command Centre, which is
 * itself often started from a Claude Code session, and Claude Code exports a
 * whole session identity into its children: CLAUDECODE, CLAUDE_CODE_SESSION_ID,
 * CLAUDE_CODE_HOST_SESSION_ID, CLAUDE_CODE_CHILD_SESSION, a messaging socket
 * and token, and a dozen more. Every one of those was inherited straight
 * through bridge → cmd.exe → wrapper → claude, and the first visible repair
 * opened with a banner reading:
 *
 *     Transcript saving is off — inherited CLAUDE_CODE_CHILD_SESSION marker
 *
 * A repair is not a child of whatever happened to start the bridge. It is a
 * top-level session that must keep its own transcript and carry its own
 * identity, so the inheritance is cut here.
 *
 * CLAUDE_CONFIG_DIR is deliberately kept: it names the config directory this
 * module ALSO writes workspace trust into, and dropping it would send the
 * session looking for trust somewhere the bridge never wrote it.
 */
export function repairEnv(base = process.env) {
  const env = {}
  for (const [k, v] of Object.entries(base)) {
    if (k === 'CLAUDE_CONFIG_DIR') { env[k] = v; continue }
    if (/^CLAUDE/i.test(k)) continue
    env[k] = v
  }
  return env
}

/** The founder-readable banner. Written over the terminal's title sequence so
 *  the window is identifiable in the taskbar without any founder text ever
 *  having gone through cmd.exe. */
function banner(plan) {
  const title = plan.windowTitle ?? 'Catch Comics Repair'
  process.stdout.write(`\u001b]0;${title}\u0007`)
  process.stdout.write(`\n  ${title}\n  Review:   ${plan.reviewId}\n  Worktree: ${plan.cwd}\n  Branch:   ${plan.branch ?? '(none)'}\n\n`)
}

export function runMain(packageDir, { spawnFn = spawn } = {}) {
  const plan = readJson(join(packageDir, LAUNCH_FILE))
  if (!plan || !plan.exe || !Array.isArray(plan.args)) {
    writeFileSync(join(packageDir, EXIT_FILE), JSON.stringify({
      exitCode: null, error: `No usable ${LAUNCH_FILE} in ${packageDir}`, endedAt: new Date().toISOString(),
    }, null, 2))
    process.exitCode = 1
    return
  }

  // Written FIRST. This file is the bridge's proof that a window exists and
  // the pid it watches; writing it after the spawn would leave a gap in which
  // a real session looks like a failed launch.
  writeFileSync(join(packageDir, SESSION_FILE), JSON.stringify({
    pid: process.pid,
    startedAt: new Date().toISOString(),
    launcher: 'repair-session.mjs',
    cwd: plan.cwd,
  }, null, 2))

  banner(plan)

  // stdio inherit: the wrapper is the process holding the real console, so the
  // child gets the tty and the TUI renders. No shell, and the prompt is an
  // argv element — nothing here is parsed by anything but claude itself.
  let child
  try {
    child = spawnFn(plan.exe, plan.args, {
      cwd: plan.cwd, stdio: 'inherit', shell: false, windowsHide: false, env: repairEnv(),
    })
  } catch (err) {
    writeFileSync(join(packageDir, EXIT_FILE), JSON.stringify({
      exitCode: null, error: `Claude Code could not be started: ${err.message}`, endedAt: new Date().toISOString(),
    }, null, 2))
    process.exitCode = 1
    return
  }

  const finish = (code, error = null) => {
    // Written before the window is held open, so a founder who leaves the
    // terminal on screen for an hour does not leave the Smoke Test waiting.
    try {
      writeFileSync(join(packageDir, EXIT_FILE), JSON.stringify({
        exitCode: code, error, endedAt: new Date().toISOString(), via: 'wrapper',
      }, null, 2))
    } catch { /* the bridge can still fall back to the pid */ }
    process.stdout.write(`\n\n  ── Claude Code session ended (exit ${code ?? '—'}) ──\n`)
    process.stdout.write('  The repair report has been sent back to the Smoke Test.\n')
    process.stdout.write('  This window is yours to read. Press Enter to close it.\n\n')
    try {
      process.stdin.resume()
      process.stdin.once('data', () => process.exit(0))
    } catch { process.exit(0) }
  }

  child.on('exit', code => finish(code))
  child.on('error', err => finish(null, `Claude Code could not be started: ${err.message}`))
}

/* ── Entry point ─────────────────────────────────────────────────────────── */

const argv = process.argv.slice(2)
if (argv[0] === '--run' && argv[1]) {
  runMain(resolve(argv[1]))
} else if (argv[0] === '--record' && argv[1] && argv[2]) {
  const [, eventName, dir] = argv
  let buf = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', d => { buf += d })
  process.stdin.on('end', async () => { process.exit(await recordMain(eventName, resolve(dir), buf)) })
  // A hook whose stdin never closes must not hang a tool call.
  setTimeout(() => process.exit(0), 5000).unref?.()
}
