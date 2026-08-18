/**
 * test-browser-trust-honesty.ts — proves Browser Trust cannot call an
 * environment failure a product failure, and cannot call a product failure an
 * environment failure.
 *
 * The incident this exists for (2026-08-18): Chromium could not be launched, so
 * all 16 slots failed at `browserType.launch` in 8.5 seconds. Nothing about
 * Catch Comics was tested, yet the Command Centre recorded verdict FAIL with 16
 * failing tests and offered "Diagnose with Claude" for a product that had never
 * loaded. The fixture below is the error text verbatim from that run.
 *
 * Run: npm run test:browser-trust   (pure functions plus one synthetic
 * preflight — no browser, no dev server, no network, no DB)
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AVAILABILITY,
  EXIT_BLOCKED,
  VERDICT,
  buildBlockedRecord,
  checkBrowser,
  classifyInfrastructure,
  isInfrastructureFailure,
  statusFromErrno,
} from '../tests/e2e/browser-trust-result.mjs'

let failures = 0
function check(label: string, ok: boolean, detail = '') {
  if (ok) console.log(`✓ ${label}`)
  else { failures++; console.error(`✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}

/* ── Fixtures ─────────────────────────────────────────────────────────────── */

/** Verbatim from launch/operations/browser-trust-latest.json, 2026-08-18T08:05:02Z. */
const INCIDENT_ERROR =
  `Error: browserType.launch: Executable doesn't exist at C:\\Users\\pgold\\AppData\\Local\\ms-playwright\\chromium_headless_shell-1234\\chrome-headless-shell-win64\\chrome-headless-shell.exe\n` +
  `╔════════════════════════════════════════════════════════════╗\n` +
  `║ Looks like Playwright was just installed or updated.       ║\n` +
  `║ Please run the following command to download new browsers: ║\n` +
  `║                                                            ║\n` +
  `║     npx playwright install                                 ║\n` +
  `║                                                            ║\n` +
  `║ <3 Playwright Team                                         ║\n` +
  `╚════════════════════════════════════════════════════════════╝`

const INCIDENT_TESTS = [
  'Homepage › loads, does not scroll sideways, and shows essential navigation @prod-safe',
  'Homepage › a sample of rail covers render as real images @prod-safe',
  'Mobile › homepage and search are usable and nothing overflows @prod-safe',
  'unknown product shows the 404 state, not a crash @prod-safe',
  'Product page › title, cover, offer state and a retailer control are all real @prod-safe',
  'Product page › no always-empty Price History panel @prod-safe',
  'Search › typing the flagship query produces usable suggestions @prod-safe',
  'Search › selecting the flagship result lands on its product page @prod-safe',
]

const incidentFailures = ['desktop-chromium', 'mobile-chromium'].flatMap(project =>
  INCIDENT_TESTS.map(test => ({ test, project, file: 'tests/e2e/x.spec.ts', error: INCIDENT_ERROR, pageUrl: null })))

/** A real product failure: an assertion that ran in a browser and did not hold. */
const PRODUCT_FAILURE =
  `Error: expect(locator).toBeVisible() failed\n\n` +
  `Locator: getByRole('link', { name: 'Compare prices' })\n` +
  `Expected: visible\nReceived: <element(s) not found>\nTimeout: 10000ms`

/* ── The incident is BLOCKED, not FAIL ────────────────────────────────────── */

check('incident: 16 launch failures are recognised as infrastructure', incidentFailures.every(f => isInfrastructureFailure(f.error)))

const incident = classifyInfrastructure({ passed: 0, failures: incidentFailures, globalErrors: [] })
check('incident: classified as blocked, not a product failure', incident !== null)
check('incident: reason is browser-unavailable', incident?.reason === 'browser-unavailable', String(incident?.reason))
check('incident: summary says Catch Comics was not tested', /Catch Comics was not tested/.test(incident?.summary ?? ''))
check('incident: all 16 slots recorded as affected', incident?.testsAffected === 16, String(incident?.testsAffected))
check('incident: not reported as partial (nothing ran)', incident?.partial === false)
check('incident: the original technical error is preserved for diagnosis',
  (incident?.technicalError ?? '').includes("browserType.launch: Executable doesn't exist"))
check('incident: a retry command is offered', !!incident?.remedy)

/* ── A product failure is never relabelled ────────────────────────────────── */

check('product failure is not infrastructure', isInfrastructureFailure(PRODUCT_FAILURE) === false)
check('product failure alone → not blocked (stays FAIL)',
  classifyInfrastructure({ passed: 5, failures: [{ test: 'x', project: 'desktop-chromium', file: 'f', error: PRODUCT_FAILURE, pageUrl: null }], globalErrors: [] }) === null)
check('mixed run → product failure wins, run is FAIL not BLOCKED',
  classifyInfrastructure({
    passed: 3,
    failures: [
      { test: 'a', project: 'desktop-chromium', file: 'f', error: INCIDENT_ERROR, pageUrl: null },
      { test: 'b', project: 'desktop-chromium', file: 'f', error: PRODUCT_FAILURE, pageUrl: null },
    ],
    globalErrors: [],
  }) === null)
check('clean run → not blocked', classifyInfrastructure({ passed: 13, failures: [], globalErrors: [] }) === null)

/* ── Other infrastructure failures reach the same state ───────────────────── */

const webServer = classifyInfrastructure({
  passed: 0,
  failures: [],
  globalErrors: ['Error: Process from config.webServer was not able to start. Exit code: 1'],
})
check('dev server that never starts → blocked', webServer?.reason === 'web-server-failed', String(webServer?.reason))
check('dev server failure does not claim a product verdict', /no journey could be tested/.test(webServer?.summary ?? ''))

const sso = classifyInfrastructure({
  passed: 0,
  failures: [],
  globalErrors: ['Error: Browser Trust: catch-comics-abc.vercel.app is behind Vercel Deployment Protection (HTTP 401)'],
})
check('unreachable target → blocked, not FAIL', sso?.reason === 'target-unreachable', String(sso?.reason))

const partial = classifyInfrastructure({ passed: 6, failures: incidentFailures.slice(0, 4), globalErrors: [] })
check('browser lost mid-run → blocked, flagged partial', partial?.partial === true && partial?.testsAffected === 4)

/* ── Absent vs inaccessible ───────────────────────────────────────────────── */

check('ENOENT → absent', statusFromErrno('ENOENT') === AVAILABILITY.ABSENT)
check('EACCES → inaccessible', statusFromErrno('EACCES') === AVAILABILITY.INACCESSIBLE)
check('EPERM → inaccessible (the 2026-08-18 shape)', statusFromErrno('EPERM') === AVAILABILITY.INACCESSIBLE)
check('EBUSY → inaccessible', statusFromErrno('EBUSY') === AVAILABILITY.INACCESSIBLE)
check('unrecognised errno → unknown, which never blocks a run', statusFromErrno('EIO') === AVAILABILITY.UNKNOWN)

const emptyRegistry = mkdtempSync(join(tmpdir(), 'cc-browser-trust-'))
const realBrowsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH
try {
  process.env.PLAYWRIGHT_BROWSERS_PATH = emptyRegistry
  const absent = checkBrowser('chromium-headless-shell')
  check('empty browsers directory → absent, not inaccessible', absent.status === AVAILABILITY.ABSENT, absent.status)
  check('absent detail names the install command', /npx playwright install/.test(absent.detail ?? ''))

  const record = buildBlockedRecord({
    target: { mode: 'local', baseURL: 'http://localhost:3000', host: 'localhost:3000' },
    blocking: {
      label: 'Chrome Headless Shell',
      status: AVAILABILITY.INACCESSIBLE,
      detail: 'C:\\ms-playwright\\chrome-headless-shell.exe exists (201.4 MB) but could not be opened: EPERM',
      executablePath: 'C:\\ms-playwright\\chrome-headless-shell.exe',
      directory: 'C:\\ms-playwright',
    },
  })
  check('preflight record: verdict BLOCKED', record.verdict === VERDICT.BLOCKED, record.verdict)
  check('preflight record: zero product failures', record.failed === 0 && record.failures.length === 0)
  check('preflight record: nothing claimed as passed', record.passed === 0)
  check('preflight record: keeps absent/inaccessible apart', record.blocked.status === AVAILABILITY.INACCESSIBLE)
  check('preflight record: technical error preserved', /could not be opened: EPERM/.test(record.blocked.technicalError))
  check('preflight record: schema version 2', record.version === 2)
} finally {
  if (realBrowsersPath === undefined) delete process.env.PLAYWRIGHT_BROWSERS_PATH
  else process.env.PLAYWRIGHT_BROWSERS_PATH = realBrowsersPath
  rmSync(emptyRegistry, { recursive: true, force: true })
}

/* ── End to end: an unavailable browser exits BLOCKED and writes BLOCKED ──── */

const sandbox = mkdtempSync(join(tmpdir(), 'cc-browser-trust-run-'))
const resultFile = join(sandbox, 'browser-trust-latest.json')
const liveResult = join(process.cwd(), 'launch', 'operations', 'browser-trust-latest.json')
const liveBefore = existsSync(liveResult) ? readFileSync(liveResult, 'utf8') : null

try {
  let exitCode = 0
  try {
    execFileSync(process.execPath, ['scripts/run-e2e.mjs'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        // No browsers anywhere: the preflight must stop the run before
        // Playwright starts, so no dev server and no test ever runs.
        PLAYWRIGHT_BROWSERS_PATH: join(sandbox, 'no-browsers-here'),
        BROWSER_TRUST_RESULT_PATH: resultFile,
      },
    })
  } catch (e) {
    exitCode = (e as { status?: number }).status ?? -1
  }

  check(`unavailable browser exits ${EXIT_BLOCKED} (BLOCKED), not 1 (FAIL)`, exitCode === EXIT_BLOCKED, `exit ${exitCode}`)
  check('a result was recorded even though nothing ran', existsSync(resultFile))

  if (existsSync(resultFile)) {
    const r = JSON.parse(readFileSync(resultFile, 'utf8'))
    check('recorded verdict is BLOCKED', r.verdict === VERDICT.BLOCKED, r.verdict)
    check('recorded verdict is NOT FAIL', r.verdict !== VERDICT.FAIL)
    check('no fabricated test failures', r.failed === 0 && r.failures.length === 0 && r.declared === 0)
    check('blocked payload names the stage', r.blocked?.stage === 'preflight')
    check('blocked payload distinguishes absent', r.blocked?.status === AVAILABILITY.ABSENT, r.blocked?.status)
    check('blocked payload keeps the technical error', /Executable doesn't exist/.test(r.blocked?.technicalError ?? ''))
    check('blocked payload offers a retry command', r.blocked?.remedy === 'npm run test:e2e')
    check('environment and commit still recorded', r.environment === 'local' && typeof r.commitSha === 'string')
  }

  const liveAfter = existsSync(liveResult) ? readFileSync(liveResult, 'utf8') : null
  check('the real Command Centre record was not touched by this test', liveAfter === liveBefore)
} finally {
  rmSync(sandbox, { recursive: true, force: true })
}

console.log(failures === 0 ? '\nBROWSER TRUST HONESTY: PASS' : `\nBROWSER TRUST HONESTY: FAIL — ${failures} failure(s)`)
process.exit(failures === 0 ? 0 : 1)
