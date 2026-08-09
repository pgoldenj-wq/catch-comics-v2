/**
 * Browser Trust — Playwright configuration.
 *
 * The question this suite answers, and no other:
 *   "Can a real visitor successfully use the most important journeys
 *    in a real browser?"
 *
 * It does not replace launch:health (data truth), launch:smoke (fast HTTP/API
 * truth) or Founder Smoke Test V4 (human collector-trust judgement).
 * See launch/operations/BROWSER-TRUST.md for the boundary.
 *
 * Modes (see tests/e2e/target.ts):
 *   npm run test:e2e        LOCAL      — starts/reuses `next dev` on :3000
 *   npm run test:e2e:ui     LOCAL      — interactive UI mode
 *   npm run test:e2e:prod   PRODUCTION — read-only @prod-safe tests only
 *   CI                      PREVIEW    — target URL from the Vercel deployment
 */

import { defineConfig, devices } from '@playwright/test'
import { LOCAL_BASE_URL, resolveTarget } from './tests/e2e/target'

// Throws before any browser launches if the target host is not ours.
const target = resolveTarget()
const isCI = !!process.env.CI

/**
 * Optional. Only needed while Vercel Deployment Protection is enabled for
 * Preview deployments — without it a Preview redirects any anonymous browser
 * to Vercel SSO and nothing can be tested. See tests/e2e/global-setup.ts.
 *
 * The value is a credential, and Playwright traces record request headers
 * verbatim, so traces are turned OFF whenever it is in use. That keeps the
 * rule "no secrets in reports, traces, screenshots or generated JSON" true
 * rather than merely intended. Making Preview deployments public removes the
 * secret and brings traces back.
 */
const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET

export default defineConfig({
  testDir: './tests/e2e',

  // One worker everywhere. This suite reads a live database; parallelism buys
  // seconds and costs query volume we have no reason to spend.
  workers: 1,
  fullyParallel: false,

  forbidOnly: isCI,
  retries: isCI ? 1 : 0,

  // Stop early. A broken deployment should cost one minute, not fifteen.
  maxFailures: isCI ? 4 : 0,

  timeout: 45_000,
  expect: { timeout: 10_000 },
  globalTimeout: 10 * 60_000,

  reporter: [
    ['list'],
    ['html', { outputFolder: 'launch/operations/browser-trust-report', open: 'never' }],
    ['./tests/e2e/command-centre-reporter.ts'],
  ],

  outputDir: 'launch/operations/browser-trust-artifacts',

  globalSetup: './tests/e2e/global-setup.ts',

  use: {
    baseURL: target.baseURL,
    trace: isCI && !bypassSecret ? 'on-first-retry' : 'off',
    screenshot: 'only-on-failure',
    video: 'off',
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
    extraHTTPHeaders: {
      // Identifiable in logs, same convention as launch-smoke.mjs.
      'X-Catch-Comics-Test': 'browser-trust',
      // Deliberately header-only: `x-vercel-set-bypass-cookie` is NOT sent.
      // extraHTTPHeaders already applies to every request this browser context
      // makes, so the cookie is redundant — and it would park a `_vercel_jwt`
      // auth token in browser storage for the whole run. Header-only keeps the
      // credential out of the browser's persistent state entirely.
      ...(bypassSecret ? { 'x-vercel-protection-bypass': bypassSecret } : {}),
    },
  },

  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 7'] },
    },
  ],

  // LOCAL only. Preview/Production targets are already deployed — starting a
  // server for them would test the wrong code.
  webServer: target.mode === 'local'
    ? {
        command: 'npm run dev',
        url: LOCAL_BASE_URL,
        reuseExistingServer: !isCI,
        timeout: 180_000,
        stdout: 'ignore',
        stderr: 'pipe',
      }
    : undefined,
})
