#!/usr/bin/env node
/**
 * run-e2e.mjs — cross-platform launcher for the Browser Trust suite.
 *
 * Exists because `TARGET=… npm run x` does not work in PowerShell, and the
 * repo has no cross-env. Keep it dependency-free.
 *
 *   node scripts/run-e2e.mjs                     LOCAL, all tests
 *   node scripts/run-e2e.mjs --ui                LOCAL, interactive UI mode
 *   node scripts/run-e2e.mjs --prod              PRODUCTION, @prod-safe only
 *   node scripts/run-e2e.mjs --url <preview-url> a Vercel Preview deployment
 *
 * Any extra arguments are forwarded to Playwright, e.g.
 *   npm run test:e2e -- --project=mobile-chromium
 *
 * The target hostname allowlist lives in tests/e2e/target.ts and is enforced
 * inside playwright.config.ts — before any browser launches or any request is
 * made. This wrapper only chooses which target to ask for.
 *
 * It also runs the browser preflight (see tests/e2e/browser-trust-result.mjs).
 * A machine that cannot start Chromium must say BLOCKED in one second, not
 * spend fifteen producing a screenful of "failures" about a product it never
 * loaded.
 */

import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  AVAILABILITY,
  EXIT_BLOCKED,
  buildBlockedRecord,
  checkBrowserAvailability,
  writeResult,
} from '../tests/e2e/browser-trust-result.mjs'

const PRODUCTION_URL = 'https://www.catchcomics.com'
const LOCAL_URL = 'http://localhost:3000'
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const argv = process.argv.slice(2)
const take = flag => {
  const i = argv.indexOf(flag)
  if (i === -1) return null
  const [, value] = argv.splice(i, 2)
  return value ?? ''
}
const has = flag => {
  const i = argv.indexOf(flag)
  if (i === -1) return false
  argv.splice(i, 1)
  return true
}

const ui = has('--ui')
const prod = has('--prod')
const url = take('--url')

if (prod && url) {
  console.error('Pass either --prod or --url, not both.')
  process.exit(2)
}

const env = { ...process.env }
const args = ['playwright', 'test']

if (prod) {
  env.PLAYWRIGHT_TARGET_URL = PRODUCTION_URL
  // The gate: Production runs ONLY tests explicitly marked read-only.
  args.push('--grep', '@prod-safe')
  console.log(`\nBrowser Trust → PRODUCTION ${PRODUCTION_URL} (read-only @prod-safe tests only)\n`)
} else if (url) {
  env.PLAYWRIGHT_TARGET_URL = url
  args.push('--grep', '@prod-safe')
  console.log(`\nBrowser Trust → ${url} (read-only @prod-safe tests only)\n`)
} else {
  delete env.PLAYWRIGHT_TARGET_URL
  console.log('\nBrowser Trust → LOCAL http://localhost:3000 (Playwright starts or reuses `next dev`)\n')
}

if (ui) args.push('--ui')
args.push(...argv)

/* ── Preflight: is there a browser to run in at all? ────────────────────────
   Playwright's own check is fs.accessSync(), which cannot tell "never
   downloaded" from "something on this machine is holding the file" — both
   surface as "Executable doesn't exist", once per test, and the Command Centre
   used to record sixteen of them as product failures. This asks the question
   once, keeps the two answers apart, and records BLOCKED: an environment
   state, not a verdict on Catch Comics. */
const hostOf = u => { try { return new URL(u).host } catch { return u } }
const target =
  prod ? { mode: 'production', baseURL: PRODUCTION_URL, host: hostOf(PRODUCTION_URL) } :
  url  ? { mode: 'preview',    baseURL: url,            host: hostOf(url) } :
         { mode: 'local',      baseURL: LOCAL_URL,      host: 'localhost:3000' }

// UI mode and `-- --headed` both need full Chromium, not just the headless
// shell, so the preflight has to know which browser this run will reach for.
const headed = ui || argv.includes('--headed')

const preflightStarted = Date.now()
const availability = checkBrowserAvailability({ headed })

if (availability.blocking) {
  const b = availability.blocking
  const record = buildBlockedRecord({
    target,
    blocking: b,
    headed,
    durationMs: Date.now() - preflightStarted,
  })

  console.error(`Browser Trust: BLOCKED — ${record.blocked.summary}\n`)
  console.error(`  ${b.label} is ${b.status}.`)
  console.error(`  ${b.detail}\n`)
  if (b.status === AVAILABILITY.ABSENT) {
    console.error('  The browser has not been downloaded. Install it with:\n')
    console.error('      npx playwright install chromium\n')
  } else {
    console.error('  The file is there but this process cannot open it — something on')
    console.error('  this machine is holding it. Security software scanning a 200 MB')
    console.error('  executable is the usual cause, and it usually clears on its own.\n')
    console.error(`  Try again:  ${record.blocked.remedy}\n`)
  }
  console.error('  Catch Comics was NOT tested. No product verdict has been recorded.')

  try {
    const dest = writeResult(REPO_ROOT, record)
    console.error(`\nRecorded → ${dest.replace(/\\/g, '/')}`)
  } catch (e) {
    console.error(`\nBrowser Trust: could not write the BLOCKED result — ${e.message}`)
  }
  process.exit(EXIT_BLOCKED)
}

const child = spawn('npx', args, {
  stdio: 'inherit',
  env,
  shell: process.platform === 'win32', // npx on Windows is npx.cmd
})
child.on('exit', code => process.exit(code ?? 1))
child.on('error', err => {
  console.error('Failed to start Playwright:', err.message)
  process.exit(1)
})
