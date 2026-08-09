/**
 * Unknown product — does a dead URL degrade honestly?
 *
 * Test 8 of the Browser Trust suite. A generic server-error screen on a
 * mistyped or retired URL is a trust failure: it reads as "the site is
 * broken" rather than "that comic isn't here".
 */

import { test, expect } from './base'
import { UNKNOWN_PRODUCT_SLUG } from './fixtures'

test('unknown product shows the 404 state, not a crash @prod-safe', async ({ page }) => {
  const response = await page.goto(`/product/${UNKNOWN_PRODUCT_SLUG}`)

  // Honest status code — not a 200 pretending the page exists.
  expect(response?.status(), 'unknown product should return HTTP 404').toBe(404)

  // The designed not-found state, with a way back.
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
  await expect(page.getByRole('link', { name: /Back to home/i })).toBeVisible()

  // Never the generic error screen (app/error.tsx) or a raw framework trace.
  await expect(page.getByText(/Something went wrong/i)).toHaveCount(0)
  await expect(page.getByText(/Application error|Internal Server Error|500/i)).toHaveCount(0)
})
