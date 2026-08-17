#!/usr/bin/env node
/**
 * browser-trust-bridge.mjs — the smallest possible local action bridge.
 *
 * WHY THIS EXISTS
 * Mission Control is a static page served by http-server. It cannot start a
 * process, so its "Run Browser Trust" button could only ever copy a command to
 * the clipboard. This bridge gives that button one real, fixed capability:
 * start the local Browser Trust suite.
 *
 * WHAT IT IS NOT
 * This is NOT a command runner. There is no way to tell it what to execute.
 * It accepts no request body, no query string, no arguments, no shell input
 * and no environment overrides. It exposes exactly one action, hard-coded:
 *
 *     node scripts/run-e2e.mjs        (i.e. `npm run test:e2e`, LOCAL only)
 *
 * SAFETY PROPERTIES (all enforced below, in this order)
 *   1. Binds to 127.0.0.1 only — never 0.0.0.0, so it is unreachable off-box.
 *   2. Rejects any Origin that is not the local Command Centre.
 *   3. Serves exactly two routes; everything else is 404.
 *   4. Single-flight: a second /run while a run is in progress is refused.
 *   5. Spawns a fixed argv with shell:false — no interpolation of any input.
 *   6. Reports only state, timing, exit code and the suite verdict. It never
 *      echoes environment values, paths outside the repo, or process output.
 *   7. Never deployed: launch/ is not part of the Next.js app and is not
 *      served by Vercel. This file must never be imported by app code.
 *
 * Started automatically by open-command-centre.ps1. Run standalone with:
 *     node launch/operations/browser-trust-bridge.mjs
 */

import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HOST = '127.0.0.1'
const PORT = 8319

// This file lives at <repo>/launch/operations/, so the repo root is two up.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const RUNNER = join(REPO_ROOT, 'scripts', 'run-e2e.mjs')
const RESULT_JSON = join(REPO_ROOT, 'launch', 'operations', 'browser-trust-latest.json')

// Only the local Command Centre may drive this. Browsers always attach Origin
// to a cross-origin POST, so this is what stops any other page in the founder's
// browser from firing the action at localhost.
const ALLOWED_ORIGINS = new Set([
  'http://localhost:8317',
  'http://127.0.0.1:8317',
])

if (!existsSync(RUNNER)) {
  console.error(`Browser Trust bridge: cannot find ${RUNNER} — is this file still inside <repo>/launch/operations/?`)
  process.exit(1)
}

/** @type {{state:'idle'|'running'|'completed'|'failed', startedAt:string|null, finishedAt:string|null, exitCode:number|null, verdict:string|null}} */
let run = { state: 'idle', startedAt: null, finishedAt: null, exitCode: null, verdict: null }
let child = null

function readVerdict() {
  try {
    return JSON.parse(readFileSync(RESULT_JSON, 'utf8')).verdict ?? null
  } catch {
    return null
  }
}

function startRun() {
  run = { state: 'running', startedAt: new Date().toISOString(), finishedAt: null, exitCode: null, verdict: null }

  // Fixed argv. Nothing from the request reaches this call, and shell:false
  // means no string is ever handed to a command interpreter.
  child = spawn(process.execPath, [RUNNER], {
    cwd: REPO_ROOT,
    shell: false,
    stdio: 'ignore',
    windowsHide: true,
  })

  child.on('exit', code => {
    child = null
    run.exitCode = code
    run.finishedAt = new Date().toISOString()
    run.verdict = readVerdict()
    run.state = code === 0 ? 'completed' : 'failed'
    console.log(`[browser-trust] run finished — exit ${code}, verdict ${run.verdict ?? 'unknown'}`)
  })

  child.on('error', err => {
    child = null
    run.exitCode = -1
    run.finishedAt = new Date().toISOString()
    run.state = 'failed'
    console.error('[browser-trust] failed to start:', err.message)
  })

  console.log('[browser-trust] run started')
}

const server = createServer((req, res) => {
  const origin = req.headers.origin
  const originOk = origin === undefined || ALLOWED_ORIGINS.has(origin)

  const send = (status, body) => {
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    if (origin && ALLOWED_ORIGINS.has(origin)) {
      headers['Access-Control-Allow-Origin'] = origin
      headers['Vary'] = 'Origin'
    }
    res.writeHead(status, headers)
    res.end(JSON.stringify(body))
  }

  if (req.method === 'OPTIONS') {
    if (!originOk) return send(403, { error: 'origin not allowed' })
    res.writeHead(204, {
      'Access-Control-Allow-Origin': origin ?? '',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Max-Age': '600',
      'Vary': 'Origin',
    })
    return res.end()
  }

  if (!originOk) return send(403, { error: 'origin not allowed' })

  // Path only — any query string is ignored rather than parsed, because there
  // is no parameter this bridge would ever accept.
  const path = (req.url ?? '').split('?')[0]

  if (req.method === 'GET' && path === '/status') {
    // A finished run stays reportable until the next one starts, so the page
    // can show the outcome of the run it triggered.
    return send(200, { ...run, port: PORT })
  }

  if (req.method === 'POST' && path === '/run') {
    if (run.state === 'running') return send(409, { ...run, state: 'already-running' })
    startRun()
    return send(202, { ...run })
  }

  return send(404, { error: 'not found' })
})

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Browser Trust bridge: port ${PORT} is already in use — another bridge is probably running.`)
    process.exit(0) // Not a failure: the capability the founder wanted is already available.
  }
  console.error('Browser Trust bridge error:', err.message)
  process.exit(1)
})

// listen(port, host) — binding the host explicitly is what keeps this off the
// network. Do not change it to listen(PORT) alone.
server.listen(PORT, HOST, () => {
  console.log(`Browser Trust bridge listening on http://${HOST}:${PORT} (local only)`)
  console.log(`Repo: ${REPO_ROOT}`)
})

// Do not leave a suite running if the bridge is closed.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    if (child) child.kill()
    server.close(() => process.exit(0))
  })
}
