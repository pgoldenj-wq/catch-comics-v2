/**
 * Search — the journey the whole product rests on.
 *
 * Tests 3 and 4 of the Browser Trust suite.
 */

import { test, expect } from './base'
import { FLAGSHIP_QUERY, FLAGSHIP_TITLE_RE } from './fixtures'
import { searchInput } from './locators'

test.describe('Search', () => {
  // ── 3. Search interaction ────────────────────────────────────────────────
  test('typing the flagship query produces usable suggestions @prod-safe', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'Mobile search is covered by the mobile journey test')

    await page.goto('/')

    const input = searchInput(page)
    await expect(input).toBeVisible()

    // Type like a person, not like a script: the input debounces at 200ms and
    // fills instantly with fill(), which can race the suggestion request.
    await input.click()
    await input.pressSequentially(FLAGSHIP_QUERY, { delay: 40 })

    const suggestions = page.getByRole('navigation', { name: 'Search suggestions' })
    await expect(suggestions, 'autocomplete panel should open for a known title').toBeVisible({ timeout: 15_000 })

    const options = suggestions.getByRole('link')
    await expect(options.first()).toBeVisible()
    expect(await options.count(), 'at least one suggestion').toBeGreaterThan(0)

    // The flagship must be among them — not merely "some suggestions appeared".
    await expect(
      options.filter({ hasText: FLAGSHIP_TITLE_RE }).first(),
      'Absolute Batman should be suggested for its own name',
    ).toBeVisible()
  })

  // ── 4. Search navigation ─────────────────────────────────────────────────
  test('selecting the flagship result lands on its product page @prod-safe', async ({ page }) => {
    // Start from the results page rather than re-driving autocomplete: this
    // test is about where a selection *goes*, and going through the URL keeps
    // it stable on both desktop and mobile layouts.
    await page.goto(`/search?q=${encodeURIComponent(FLAGSHIP_QUERY)}&region=uk`)

    const result = page.getByRole('link', { name: FLAGSHIP_TITLE_RE }).first()
    await expect(result, 'a flagship result should be listed').toBeVisible({ timeout: 20_000 })

    await result.click()
    await page.waitForURL(/\/product\//, { timeout: 30_000 })

    // The destination is a real product page for the thing we clicked.
    expect(page.url(), 'destination should be a product page').toContain('/product/')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(FLAGSHIP_TITLE_RE)
  })
})
