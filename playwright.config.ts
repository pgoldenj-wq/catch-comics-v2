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

  use: {
    baseURL: target.baseURL,
    trace: isCI ? 'on-first-retry' : 'off',
    screenshot: 'only-on-failure',
    video: 'off',
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
    // Identifiable in logs, same convention as launch-smoke.mjs.
    extraHTTPHeaders: { 'X-Catch-Comics-Test': 'browser-trust' },
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
