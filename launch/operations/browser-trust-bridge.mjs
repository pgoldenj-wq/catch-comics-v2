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
 * It exposes exactly THREE actions, all hard-coded, each with its own
 * independent single-flight lock:
 *
 *     node scripts/run-e2e.mjs               (i.e. `npm run test:e2e`, LOCAL)
 *     node scripts/run-retailer-refresh.mjs  (bounded retailer price refresh)
 *     claude -p <fixed repair prompt>        (Smoke Test V4 founder handoff)
 *
 * The first two accept no input of any kind: no request body, no query string,
 * no arguments, no shell input, no environment overrides. The retailer one
 * writes to production data, so it is worth being explicit about what the
 * bridge does and does not decide: it decides nothing. Every bound, ceiling,
 * identity rule and circuit breaker lives in scripts/price-verify-dryrun.ts,
 * which run-retailer-refresh.mjs invokes with a fixed argv. The bridge cannot
 * pass a row count, a retailer, a flag, or anything else — there is no code
 * path from an HTTP request to an argument.
 *
 * The THIRD action does take a request body, because the founder's review is
 * data that has to get here somehow. That single exception is fenced off in
 * founder-review-handler.mjs, and the fence is worth stating here: the body
 * carries review text and screenshot bytes only. It cannot name a file, name a
 * directory, choose the prompt, or reach the argv. Read the header of that
 * module before changing anything about this route.
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
import { LIMITS, ReviewRunner, ValidationError } from './founder-review-handler.mjs'

const HOST = '127.0.0.1'
const PORT = 8319

// This file lives at <repo>/launch/operations/, so the repo root is two up.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const RUNNER = join(REPO_ROOT, 'scripts', 'run-e2e.mjs')
const RESULT_JSON = join(REPO_ROOT, 'launch', 'operations', 'browser-trust-latest.json')

const RETAILER_RUNNER = join(REPO_ROOT, 'scripts', 'run-retailer-refresh.mjs')
const RETAILER_STATUS_JSON = join(REPO_ROOT, 'launch', 'operations', 'price-verify-status.json')

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
if (!existsSync(RETAILER_RUNNER)) {
  console.error(`Bridge: cannot find ${RETAILER_RUNNER} — the retailer refresh action would 500 on use.`)
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
    // A blocked run is not a failed run: the browser never started, so nothing
    // failed. Reported as its own state so the Command Centre never has to
    // infer "environment problem" from an exit code. (See run-e2e.mjs.)
    run.state = code === 0 ? 'completed' : run.verdict === 'BLOCKED' ? 'blocked' : 'failed'
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

/* ── Action 2: bounded retailer price refresh ────────────────────────────────
   Same shape as above and the same guarantees: fixed argv, shell:false, its own
   single-flight lock, and nothing from the request reaches the child. The run
   takes roughly 45 minutes, so `state` is the only thing the page polls; the
   detail it displays comes from the status file the operational script writes.
*/
/** @type {{state:'idle'|'running'|'completed'|'failed', startedAt:string|null, finishedAt:string|null, exitCode:number|null}} */
let retailerRun = { state: 'idle', startedAt: null, finishedAt: null, exitCode: null }
let retailerChild = null

function readRetailerStatus() {
  try {
    return JSON.parse(readFileSync(RETAILER_STATUS_JSON, 'utf8'))
  } catch {
    return null
  }
}

function startRetailerRun() {
  retailerRun = { state: 'running', startedAt: new Date().toISOString(), finishedAt: null, exitCode: null }

  retailerChild = spawn(process.execPath, [RETAILER_RUNNER], {
    cwd: REPO_ROOT,
    shell: false,
    stdio: 'ignore',
    windowsHide: true,
  })

  retailerChild.on('exit', code => {
    retailerChild = null
    retailerRun.exitCode = code
    retailerRun.finishedAt = new Date().toISOString()
    // A non-zero exit is usually a deliberate SAFE STOP, not a crash. The
    // bridge does not try to tell them apart — the status file the script
    // writes says which, and the card reads that.
    retailerRun.state = code === 0 ? 'completed' : 'failed'
    console.log(`[retailer-refresh] run finished — exit ${code}`)
  })

  retailerChild.on('error', err => {
    retailerChild = null
    retailerRun.exitCode = -1
    retailerRun.finishedAt = new Date().toISOString()
    retailerRun.state = 'failed'
    console.error('[retailer-refresh] failed to start:', err.message)
  })

  console.log('[retailer-refresh] run started')
}

/* ── Action 3: Smoke Test V4 founder review handoff ──────────────────────────
   The only route that accepts a body. Everything it is allowed to do lives in
   founder-review-handler.mjs; this file just moves bytes to it.
*/
const reviewRunner = new ReviewRunner(REPO_ROOT)

/** Read a JSON body with a hard ceiling, destroying the socket if exceeded. */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', c => {
      size += c.length
      if (size > LIMITS.BODY_BYTES) {
        reject(new ValidationError(`The submission is larger than ${Math.round(LIMITS.BODY_BYTES / 1048576)} MB — delete a screenshot and send again`))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
      catch { reject(new ValidationError('The submission was not valid JSON')) }
    })
    req.on('error', reject)
  })
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
      // Required for /review/submit: a POST carrying application/JSON is not a
      // "simple" request, so the browser preflights it and drops the real
      // request unless Content-Type is named here. The first two actions sent
      // no body and no headers, which is why this was never needed before.
      'Access-Control-Allow-Headers': 'Content-Type',
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

  if (req.method === 'GET' && path === '/retailer/status') {
    return send(200, { ...retailerRun, progress: readRetailerStatus(), port: PORT })
  }

  if (req.method === 'POST' && path === '/retailer/run') {
    // Single-flight. A second click while a refresh is in progress is refused
    // outright — this action writes to production, so "probably fine" is not
    // good enough.
    if (retailerRun.state === 'running') return send(409, { ...retailerRun, state: 'already-running' })
    startRetailerRun()
    return send(202, { ...retailerRun })
  }

  // ── Founder review handoff ────────────────────────────────────────────────
  // /review/health tells the Smoke Test what it can rely on right now, so the
  // page never advertises a capability the machine does not have.
  if (req.method === 'GET' && path === '/review/health') {
    return send(200, { ...reviewRunner.health(), port: PORT })
  }

  if (req.method === 'GET' && path === '/review/status') {
    const id = new URL(req.url ?? '', `http://${HOST}`).searchParams.get('reviewId')
    const rec = id ? reviewRunner.get(id) : null
    if (!rec) return send(404, { error: 'unknown reviewId' })
    return send(200, ReviewRunner.view(rec))
  }

  if (req.method === 'POST' && path === '/review/submit') {
    readJsonBody(req)
      .then(body => {
        const rec = reviewRunner.submit(body)
        // 200 for a duplicate, 202 for something newly started. Either way the
        // body says exactly which, so the page never has to guess.
        return send(rec.duplicate ? 200 : 202, ReviewRunner.view(rec))
      })
      .catch(err => {
        if (err instanceof ValidationError) return send(400, { error: err.message })
        console.error('[founder-review] submit failed:', err)
        return send(500, { error: 'The bridge could not process the review. See the bridge window for details.' })
      })
    return
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
  // The repo is established HERE, once, from this file's own location. That is
  // what replaced the Smoke Test's per-handoff directory picker.
  const h = reviewRunner.health()
  console.log(`Founder review handoff: ready — Claude Code ${h.claude.available ? h.claude.version : 'NOT FOUND (reviews will still be saved)'}`)
})

// Do not leave a TEST suite running if the bridge is closed — nothing is lost
// by stopping it. A retailer refresh is deliberately NOT killed: it writes
// verified production rows one at a time, so aborting half way through would
// throw away real work to no benefit. It finishes and writes its own status
// file; the card picks the result up next time it is opened.
//
// A Claude repair is left to finish for the same reason: it is editing the
// working tree, and killing it mid-edit is how you get a half-applied change.
// Its record is on disk in the package, so the Smoke Test can pick the outcome
// up again after a restart.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    if (child) child.kill()
    if (retailerChild) console.log('[retailer-refresh] still running — left to finish; it will write its own result')
    if (reviewRunner.activeId) console.log(`[founder-review] ${reviewRunner.activeId} still running — left to finish; it will write its own run.json`)
    server.close(() => process.exit(0))
  })
}
