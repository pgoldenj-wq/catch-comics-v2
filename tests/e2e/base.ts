/**
 * base.ts — the one shared piece of test plumbing.
 *
 * This is NOT a page-object layer. It exists because all eight tests need the
 * same two things, and duplicating them eight times would be worse:
 *
 *   1. Serious browser errors are captured and asserted on every test.
 *   2. A failing test records the URL it was on, so the Command Centre's
 *      "Diagnose with Claude" handoff can say where it broke.
 *
 * Add nothing else here without a concrete second caller.
 */

import { test as base, expect } from '@playwright/test'
import { assertNoSeriousErrors, watchForPageErrors, type PageErrorLog } from './console-guard'

export const test = base.extend<{ errors: PageErrorLog }>({
  errors: [async ({ page }, use, testInfo) => {
    const log = watchForPageErrors(page)

    await use(log)

    // Record where we ended up — cheap, and the only breadcrumb a JSON
    // report can offer someone diagnosing a failure later.
    if (testInfo.status !== testInfo.expectedStatus) {
      try {
        await testInfo.attach('page-url', { body: page.url(), contentType: 'text/plain' })
      } catch { /* page may already be closed */ }
    }

    // Runs after the test body: a test that passed its assertions but threw
    // uncaught errors in the browser has not really passed.
    await assertNoSeriousErrors(log, testInfo)
  }, { auto: true }],
})

export { expect }
