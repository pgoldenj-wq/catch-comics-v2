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
 */

import { spawn } from 'node:child_process'

const PRODUCTION_URL = 'https://www.catchcomics.com'

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
