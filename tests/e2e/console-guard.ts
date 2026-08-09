/**
 * console-guard.ts — capture serious in-browser errors, ignore the noise.
 *
 * One function, no framework. Rules:
 *   • Uncaught page errors ALWAYS count — that is our JavaScript throwing.
 *   • console.error counts only when it is not on the documented ignore list.
 *   • Everything captured is attached to the test report either way, so an
 *     ignored message is still visible to a human reading the run.
 */

import type { Page, TestInfo } from '@playwright/test'
import { isIgnoredConsoleMessage } from './fixtures'

export interface PageErrorLog {
  /** Errors that should fail the test. */
  serious: string[]
  /** Captured but deliberately tolerated — recorded, never fatal. */
  ignored: string[]
}

export function watchForPageErrors(page: Page): PageErrorLog {
  const log: PageErrorLog = { serious: [], ignored: [] }

  // Uncaught exceptions in our own bundle. Never ignorable.
  page.on('pageerror', err => {
    log.serious.push(`pageerror: ${err.message}`)
  })

  page.on('console', msg => {
    if (msg.type() !== 'error') return
    const text = msg.text()
    if (isIgnoredConsoleMessage(text)) log.ignored.push(text)
    else log.serious.push(`console.error: ${text}`)
  })

  return log
}

/**
 * Attach the full log to the report, then assert nothing serious happened.
 * Call at the end of a test (or in afterEach) — attaching first means a
 * failure still carries its evidence.
 */
export async function assertNoSeriousErrors(log: PageErrorLog, testInfo: TestInfo): Promise<void> {
  if (log.serious.length || log.ignored.length) {
    await testInfo.attach('browser-console', {
      body:
        `SERIOUS (${log.serious.length}):\n${log.serious.join('\n') || '  none'}\n\n` +
        `IGNORED (${log.ignored.length}):\n${log.ignored.join('\n') || '  none'}\n`,
      contentType: 'text/plain',
    })
  }
  if (log.serious.length) {
    throw new Error(
      `${log.serious.length} serious browser error(s) on this page:\n` +
      log.serious.map(e => `  • ${e}`).join('\n'),
    )
  }
}

/**
 * Does the document scroll sideways? A real visitor experiences this as a
 * broken page. Measured on the document, not on any single element — inner
 * carousels are allowed to scroll horizontally, the page is not.
 */
export async function hasHorizontalOverflow(page: Page): Promise<{ overflows: boolean; scrollWidth: number; clientWidth: number }> {
  return page.evaluate(() => {
    const el = document.documentElement
    // 1px of slack absorbs sub-pixel rounding at fractional device scales.
    return {
      overflows: el.scrollWidth > el.clientWidth + 1,
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }
  })
}
