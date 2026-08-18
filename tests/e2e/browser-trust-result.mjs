/**
 * browser-trust-result.mjs — the honesty model shared by the runner and the reporter.
 *
 * Browser Trust answers exactly one question: "can a real visitor use the most
 * important journeys in a real browser?" It can only answer that if a browser
 * actually started. Until 2026-08-18 it could not tell the two apart — a run in
 * which Chromium never launched was recorded as sixteen product failures, and
 * the Command Centre said Catch Comics was broken when Catch Comics had not
 * been tested at all.
 *
 * Three states, and only three:
 *
 *   PASS     browser launched · tests executed · every product assertion passed
 *   FAIL     browser launched · tests executed · a product assertion failed
 *   BLOCKED  the browser or the test infrastructure never got far enough for a
 *            product verdict to exist. NOT a product failure, never counted as
 *            one, and never allowed to suppress a real FAIL.
 *
 * Two writers import this file:
 *   scripts/run-e2e.mjs                  — preflight, before Playwright starts
 *   tests/e2e/command-centre-reporter.ts — after a run, when a launch failed
 *                                          part-way through
 *
 * Keep it dependency-free ESM: plain `node` and Playwright's TypeScript loader
 * both have to read it.
 */

import { accessSync, closeSync, mkdirSync, openSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'

/**
 * Anchored at the working directory, not at this file: Playwright transpiles
 * every file it loads — including this one — into CommonJS, where `import.meta`
 * is a syntax error. Every entry point that reads this module (npm scripts,
 * playwright, tsx) runs from inside the repo, and both callers below degrade to
 * "unknown" rather than a wrong answer if resolution ever fails.
 */
const requireFrom = createRequire(join(process.cwd(), 'package.json'))

/** The three honest verdicts, plus the two the reporter already emitted. */
export const VERDICT = {
  PASS:             'PASS',
  PASS_WITH_FLAKES: 'PASS-WITH-FLAKES',
  FAIL:             'FAIL',
  BLOCKED:          'BLOCKED',
  INCOMPLETE:       'INCOMPLETE',
  NOT_RUN:          'NOT RUN',
}

/** Result of asking whether a browser binary is usable. */
export const AVAILABILITY = {
  AVAILABLE:    'available',
  ABSENT:       'absent',
  INACCESSIBLE: 'inaccessible',
  UNKNOWN:      'unknown',
}

/** Where the Command Centre reads the result from. */
export const DEFAULT_RESULT_PATH = join('launch', 'operations', 'browser-trust-latest.json')
export const REPORT_PATH = 'launch/operations/browser-trust-report/index.html'

/** Exit code that means BLOCKED — distinct from 1, which means a real failure. */
export const EXIT_BLOCKED = 3

/* ────────────────────────────────────────────────────────────────────────────
   Redaction

   Nothing in this suite handles secrets, but a stack trace or an errno detail
   can still quote an environment value, so redaction happens on the way out
   rather than being assumed unnecessary. It lives here so the preflight record
   carries exactly the same guarantee as the reporter's.
   ──────────────────────────────────────────────────────────────────────── */

const REDACTIONS = [
  { re: /postgres(?:ql)?:\/\/[^\s"']+/gi,                      to: '[redacted-database-url]' },
  { re: /\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}\b/g,             to: '[redacted-jwt]' },
  { re: /\bBearer\s+[\w.\-~+/]{12,}=*/gi,                      to: 'Bearer [redacted]' },
  { re: /\b(?:sk|pk|ghp|gho|ghs|github_pat|npm|vercel|neon|rk)_[A-Za-z0-9_-]{16,}\b/gi, to: '[redacted-token]' },
  // key=value / key: value forms — keep the key name, drop the value.
  {
    re: /\b(api[_-]?key|apikey|token|secret|password|passwd|pwd|authorization|cookie|connection[_-]?string)\b(\s*[:=]\s*)["']?[^\s"',;)]{6,}/gi,
    to: '$1$2[redacted]',
  },
]

/** Strip ANSI colour, redact anything secret-shaped, bound the length. */
export function sanitise(raw) {
  let s = String(raw ?? '').replace(/\[[0-9;]*m/g, '')
  for (const r of REDACTIONS) s = s.replace(r.re, r.to)
  return s.length > 1200 ? `${s.slice(0, 1200)}\n… (truncated)` : s
}

/* ────────────────────────────────────────────────────────────────────────────
   Git provenance — a result nobody can tie to a commit is not evidence.
   ──────────────────────────────────────────────────────────────────────── */

function git(args) {
  try {
    const out = execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    return out || null
  } catch {
    return null
  }
}

export function gitSha() {
  return process.env.GITHUB_SHA || git(['rev-parse', 'HEAD'])
}

export function gitBranch() {
  if (process.env.GITHUB_HEAD_REF) return process.env.GITHUB_HEAD_REF
  if (process.env.GITHUB_REF_NAME) return process.env.GITHUB_REF_NAME
  const b = git(['rev-parse', '--abbrev-ref', 'HEAD'])
  return b === 'HEAD' ? null : b
}

export function playwrightVersion() {
  try {
    return requireFrom('@playwright/test/package.json').version
  } catch {
    return 'unknown'
  }
}

/* ────────────────────────────────────────────────────────────────────────────
   Is a browser actually usable?

   Playwright's own gate is canAccessFile() → fs.accessSync(), which returns
   false for "denied" exactly as it does for "missing" — which is why its error
   says "Executable doesn't exist" while the file sits there and something else
   is holding it. This check keeps the two apart: ABSENT (never downloaded) and
   INACCESSIBLE (present, but we cannot open it).

   UNKNOWN is deliberate and safe: where the layout is one we cannot resolve
   (full Chromium inside a macOS .app bundle, say) we say so and let the run
   proceed, rather than blocking a healthy machine on a guess.
   ──────────────────────────────────────────────────────────────────────── */

const EXECUTABLE_BASENAMES = {
  'chromium-headless-shell': ['chrome-headless-shell.exe', 'chrome-headless-shell', 'headless_shell'],
  'chromium':                ['chrome.exe', 'chrome', 'Chromium'],
}

const BROWSER_LABEL = {
  'chromium-headless-shell': 'Chrome Headless Shell',
  'chromium':                'Chrome for Testing',
}

function playwrightCoreRoot() {
  return dirname(requireFrom.resolve('playwright-core/package.json'))
}

/** The same rules playwright-core uses to pick its browsers directory. */
export function browsersRegistryDirectory() {
  const fromEnv = process.env.PLAYWRIGHT_BROWSERS_PATH
  if (fromEnv === '0') return join(playwrightCoreRoot(), '.local-browsers')
  if (fromEnv) {
    return isAbsolute(fromEnv) ? fromEnv : resolve(process.env.INIT_CWD || process.cwd(), fromEnv)
  }
  if (process.platform === 'win32') {
    return join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'ms-playwright')
  }
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Caches', 'ms-playwright')
  }
  return join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'ms-playwright')
}

/**
 * The revision this Playwright build wants, straight from playwright-core.
 * Read as a file rather than required: playwright-core's package `exports` map
 * deliberately does not publish browsers.json.
 */
function revisionOf(browserName) {
  try {
    const raw = readFileSync(join(playwrightCoreRoot(), 'browsers.json'), 'utf8')
    return JSON.parse(raw).browsers.find(b => b.name === browserName)?.revision ?? null
  } catch {
    return null
  }
}

/** ENOENT is "never downloaded"; EACCES/EPERM/EBUSY is "there, but held". */
export function statusFromErrno(code) {
  if (code === 'ENOENT' || code === 'ENOTDIR') return AVAILABILITY.ABSENT
  if (code === 'EACCES' || code === 'EPERM' || code === 'EBUSY') return AVAILABILITY.INACCESSIBLE
  return AVAILABILITY.UNKNOWN
}

/** Bounded search for the binary inside an install directory (depth 2). */
function findExecutable(dir, browserName) {
  const wanted = new Set(EXECUTABLE_BASENAMES[browserName] ?? [])
  const walk = (d, depth) => {
    const entries = readdirSync(d, { withFileTypes: true })
    for (const e of entries) {
      if (e.isFile() && wanted.has(e.name)) return join(d, e.name)
    }
    if (depth === 0) return null
    for (const e of entries) {
      if (!e.isDirectory()) continue
      const hit = walk(join(d, e.name), depth - 1)
      if (hit) return hit
    }
    return null
  }
  return walk(dir, 2)
}

/**
 * Check one browser. Returns { browser, label, status, directory,
 * executablePath, detail } and never throws.
 */
export function checkBrowser(browserName) {
  const label = BROWSER_LABEL[browserName] ?? browserName
  const base = { browser: browserName, label, directory: null, executablePath: null }

  const revision = revisionOf(browserName)
  if (!revision) {
    return { ...base, status: AVAILABILITY.UNKNOWN, detail: 'could not read playwright-core/browsers.json' }
  }

  // playwright-core names the directory after the browser with dashes turned
  // into underscores: chromium-headless-shell → chromium_headless_shell-1234.
  const directory = join(browsersRegistryDirectory(), `${browserName.replace(/-/g, '_')}-${revision}`)

  try {
    statSync(directory)
  } catch (e) {
    const status = statusFromErrno(e.code)
    return {
      ...base,
      status,
      directory,
      detail: status === AVAILABILITY.ABSENT
        ? `no install at ${directory} — run "npx playwright install"`
        : `${directory} could not be read: ${e.code}`,
    }
  }

  let executablePath
  try {
    executablePath = findExecutable(directory, browserName)
  } catch (e) {
    return { ...base, status: statusFromErrno(e.code), directory, detail: `${directory} could not be listed: ${e.code}` }
  }

  if (!executablePath) {
    return {
      ...base,
      status: EXECUTABLE_BASENAMES[browserName] ? AVAILABILITY.ABSENT : AVAILABILITY.UNKNOWN,
      directory,
      detail: `${directory} exists but holds no ${label} executable — the install is incomplete, run "npx playwright install"`,
    }
  }

  // Two probes. accessSync is exactly Playwright's own gate; opening the file
  // additionally catches a binary that is present and permitted but held open
  // by something else, which accessSync alone can miss.
  let size = null
  try {
    size = statSync(executablePath).size
  } catch { /* the probes below report it */ }

  try {
    accessSync(executablePath)
  } catch (e) {
    return {
      ...base,
      status: statusFromErrno(e.code),
      directory,
      executablePath,
      detail: `${executablePath} could not be accessed: ${e.code}`,
    }
  }

  try {
    const fd = openSync(executablePath, 'r')
    closeSync(fd)
  } catch (e) {
    const status = statusFromErrno(e.code)
    return {
      ...base,
      status: status === AVAILABILITY.UNKNOWN ? AVAILABILITY.INACCESSIBLE : status,
      directory,
      executablePath,
      detail: `${executablePath} exists${size ? ` (${(size / 1048576).toFixed(1)} MB)` : ''} but could not be opened: ${e.code}`,
    }
  }

  return { ...base, status: AVAILABILITY.AVAILABLE, directory, executablePath, detail: null }
}

/**
 * Preflight for a whole run.
 *
 * Headless runs use the headless shell; `--ui` and any headed run need full
 * Chromium as well. Only a browser this run actually needs can block it.
 */
export function checkBrowserAvailability({ headed = false } = {}) {
  const required = headed ? ['chromium-headless-shell', 'chromium'] : ['chromium-headless-shell']
  const browsers = required.map(checkBrowser)
  const blocking = browsers.find(
    b => b.status === AVAILABILITY.ABSENT || b.status === AVAILABILITY.INACCESSIBLE,
  ) ?? null

  return {
    browsers,
    ok: !blocking,
    status: blocking
      ? blocking.status
      : (browsers.every(b => b.status === AVAILABILITY.AVAILABLE) ? AVAILABILITY.AVAILABLE : AVAILABILITY.UNKNOWN),
    blocking,
  }
}

/* ────────────────────────────────────────────────────────────────────────────
   Infrastructure failure signatures

   Deliberately tight. A pattern that is too broad would relabel a real product
   failure as an environment problem, which is the same lie pointing the other
   way — so anything ambiguous (a page crash, a navigation timeout) is left
   alone and stays a FAIL.
   ──────────────────────────────────────────────────────────────────────── */

// Most specific first: "Executable doesn't exist" arrives wrapped in a
// browserType.launch error, and "the binary was unusable" is a more useful
// answer than "the launch failed somehow".
const INFRASTRUCTURE_PATTERNS = [
  { re: /Executable doesn't exist/,                              reason: 'browser-unavailable' },
  { re: /Please run the following command to download new brow/, reason: 'browser-unavailable' },
  { re: /Chromium distribution '[^']*' is not found/,            reason: 'browser-unavailable' },
  { re: /Host system is missing dependencies to run browsers/,   reason: 'browser-unavailable' },
  { re: /browserType\.launch(PersistentContext)?:/,              reason: 'browser-launch-failed' },
  { re: /Process from config\.webServer (was not able to start|exited early)/i, reason: 'web-server-failed' },
  { re: /Timed out waiting \d+ms from config\.webServer/i,       reason: 'web-server-failed' },
  { re: /Browser Trust: .* is unreachable/,                      reason: 'target-unreachable' },
  { re: /behind Vercel Deployment Protection/,                   reason: 'target-unreachable' },
  { re: /returned HTTP \d+ before any test ran/,                 reason: 'target-unreachable' },
  { re: /Refusing to run Browser Trust against/,                 reason: 'target-not-allowed' },
]

/** The reason code for a message, or null when it is not an infrastructure failure. */
export function infrastructureReason(text) {
  const s = String(text ?? '')
  for (const p of INFRASTRUCTURE_PATTERNS) if (p.re.test(s)) return p.reason
  return null
}

export function isInfrastructureFailure(text) {
  return infrastructureReason(text) !== null
}

const REASON_SUMMARY = {
  'browser-unavailable':   'Playwright could not start Chromium. Catch Comics was not tested.',
  'browser-launch-failed': 'Playwright could not start Chromium. Catch Comics was not tested.',
  'web-server-failed':     'The local dev server never came up, so no journey could be tested.',
  'target-unreachable':    'The target site could not be reached, so no journey could be tested.',
  'target-not-allowed':    'The run was pointed at a host Browser Trust refuses to test.',
  'infrastructure-error':  'Browser Trust could not run, so Catch Comics was not tested.',
}

export function summaryForReason(reason) {
  return REASON_SUMMARY[reason] ?? REASON_SUMMARY['infrastructure-error']
}

/**
 * @typedef {{ test?: string, project?: string, file?: string, error?: string, pageUrl?: string|null }} RunFailure
 */

/**
 * Decide whether a finished run was blocked rather than failed.
 *
 * Returns a `blocked` payload, or null for an ordinary run. The order matters:
 * a single genuine product failure outranks any amount of infrastructure
 * noise, because a failed assertion is proof that a browser ran.
 *
 * The annotation is load-bearing: this file is JavaScript, so without it the
 * empty defaults infer as `never[]` and every TypeScript caller fails to build.
 *
 * @param {{ passed?: number, failures?: Array<string|RunFailure>, globalErrors?: string[] }} [input]
 */
export function classifyInfrastructure({ passed = 0, failures = [], globalErrors = [] } = {}) {
  const infra = [], product = []
  for (const f of failures) {
    const text = typeof f === 'string' ? f : f.error
    const entry = { text, test: typeof f === 'string' ? null : f }
    if (isInfrastructureFailure(text)) infra.push(entry)
    else product.push(entry)
  }
  const globalInfra = globalErrors.filter(isInfrastructureFailure)

  if (product.length) return null
  if (!infra.length && !globalInfra.length) return null

  const first = infra[0]?.text ?? globalInfra[0]
  const reason = infrastructureReason(first) ?? 'infrastructure-error'

  return {
    reason,
    stage: 'run',
    status: null,
    summary: summaryForReason(reason),
    detail: null,
    executablePath: null,
    testsAffected: infra.length,
    // True when some journeys did run before the browser became unusable, so
    // the card never claims "nothing was tested" when something was.
    partial: passed > 0,
    tests: infra.map(i => (i.test ? `[${i.test.project}] ${i.test.test}` : null)).filter(Boolean).slice(0, 20),
    technicalError: sanitise(first),
    remedy: 'npm run test:e2e',
  }
}

/* ────────────────────────────────────────────────────────────────────────────
   The record the Command Centre reads
   ──────────────────────────────────────────────────────────────────────── */

/** Honours BROWSER_TRUST_RESULT_PATH so tests never clobber the real record. */
export function resultPath(repoRoot) {
  const override = process.env.BROWSER_TRUST_RESULT_PATH
  if (override) return isAbsolute(override) ? override : join(repoRoot, override)
  return join(repoRoot, DEFAULT_RESULT_PATH)
}

/**
 * A BLOCKED record written by the preflight, before Playwright ever starts.
 * Same shape as the reporter's, with every product tally at zero and no
 * `failures` — because nothing about the product was learned.
 */
export function buildBlockedRecord({ target, blocking, headed = false, durationMs = 0 }) {
  const reason = 'browser-unavailable'
  const technical =
    `${blocking.label} is ${blocking.status}.\n` +
    `${blocking.detail}\n` +
    `Playwright reports this as: browserType.launch: Executable doesn't exist at ` +
    `${blocking.executablePath ?? blocking.directory}`

  return {
    version: 2,
    tool: 'playwright',
    toolVersion: playwrightVersion(),
    environment: target.mode,
    url: target.baseURL,
    host: target.host,
    runAt: new Date().toISOString(),
    durationMs,
    commitSha: gitSha(),
    branch: gitBranch(),
    ci: !!process.env.CI,
    runUrl: null,
    verdict: VERDICT.BLOCKED,
    declared: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    flaky: 0,
    projects: {},
    reportPath: REPORT_PATH,
    failures: [],
    blocked: {
      reason,
      stage: 'preflight',
      status: blocking.status,
      summary: summaryForReason(reason),
      detail: sanitise(blocking.detail ?? ''),
      executablePath: sanitise(blocking.executablePath ?? blocking.directory ?? ''),
      testsAffected: null,
      partial: false,
      tests: [],
      technicalError: sanitise(technical),
      remedy: headed ? 'npm run test:e2e:ui' : 'npm run test:e2e',
    },
  }
}

export function writeResult(repoRoot, record) {
  const dest = resultPath(repoRoot)
  mkdirSync(dirname(dest), { recursive: true })
  writeFileSync(dest, `${JSON.stringify(record, null, 2)}\n`)
  return dest
}
