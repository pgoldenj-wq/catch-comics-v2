/**
 * Mobile journey — the majority of real visitors.
 *
 * Test 7 of the Browser Trust suite. Runs only in the mobile-chromium project
 * (Pixel 7 profile: 412×839, touch, mobile UA).
 *
 * This is emulation, not a phone. The founder-led "confirm on a physical
 * phone" check in Mission Control's ops list remains, and this test does not
 * discharge it — see launch/operations/BROWSER-TRUST.md.
 */

import { test, expect } from './base'
import { hasHorizontalOverflow } from './console-guard'
import { FLAGSHIP_QUERY, FLAGSHIP_TITLE_RE } from './fixtures'
import { searchInput } from './locators'

test.describe('Mobile', () => {
  test('homepage and search are usable and nothing overflows @prod-safe', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', 'Mobile-only journey')

    // ── Homepage ───────────────────────────────────────────────────────────
    await page.goto('/')

    const search = searchInput(page)
    await expect(search, 'search must be reachable without scrolling sideways').toBeVisible()

    // The critical control must be fully inside the viewport, not clipped.
    const viewport = page.viewportSize()
    const box = await search.boundingBox()
    expect(box, 'search input should have a layout box').not.toBeNull()
    expect(box!.x, 'search input starts inside the viewport').toBeGreaterThanOrEqual(-1)
    expect(
      box!.x + box!.width,
      `search input is clipped: ends at ${Math.round(box!.x + box!.width)}px in a ${viewport!.width}px viewport`,
    ).toBeLessThanOrEqual(viewport!.width + 1)

    const homeOverflow = await hasHorizontalOverflow(page)
    expect(
      homeOverflow.overflows,
      `homepage scrolls horizontally: ${homeOverflow.scrollWidth} > ${homeOverflow.clientWidth}`,
    ).toBe(false)

    // ── Search journey by touch ────────────────────────────────────────────
    await search.tap()
    await search.pressSequentially(FLAGSHIP_QUERY, { delay: 40 })
    await page.keyboard.press('Enter')

    await page.waitForURL(/\/search\?/, { timeout: 30_000 })

    await expect(
      page.getByRole('link', { name: FLAGSHIP_TITLE_RE }).first(),
      'flagship result should be reachable on mobile',
    ).toBeVisible({ timeout: 20_000 })

    const resultsOverflow = await hasHorizontalOverflow(page)
    expect(
      resultsOverflow.overflows,
      `search results scroll horizontally: ${resultsOverflow.scrollWidth} > ${resultsOverflow.clientWidth}`,
    ).toBe(false)
  })
})
