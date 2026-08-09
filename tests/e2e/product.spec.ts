/**
 * Product page — the page where a visitor decides whether to trust us.
 *
 * Tests 5 and 6 of the Browser Trust suite.
 *
 * Deliberately NOT asserted: prices, offer counts, retailer ordering, which
 * retailer is cheapest. All of those change hourly; a test that pinned them
 * would fail for reasons that are not defects.
 */

import { test, expect } from './base'
import { FLAGSHIP_PRODUCT_SLUG } from './fixtures'

test.describe('Product page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/product/${FLAGSHIP_PRODUCT_SLUG}`)
  })

  // ── 5. Product-page trust ────────────────────────────────────────────────
  test('title, cover, offer state and a retailer control are all real @prod-safe', async ({ page }) => {
    // Title
    const title = page.getByRole('heading', { level: 1 })
    await expect(title).toBeVisible()
    expect((await title.textContent())?.trim().length, 'product title should not be empty').toBeGreaterThan(0)

    // Cover — must decode actual pixels, not just exist in the DOM. The app
    // hides failed covers behind a designed placeholder, so an <img> element
    // on its own proves nothing.
    const cover = page.getByAltText(/^Cover of /).first()
    await expect(cover).toBeVisible()
    await expect(async () => {
      const state = await cover.evaluate((el: HTMLImageElement) => ({
        complete: el.complete, w: el.naturalWidth, h: el.naturalHeight,
      }))
      expect(state.complete, 'cover image finished loading').toBe(true)
      expect(state.w, 'cover natural width').toBeGreaterThan(1)
      expect(state.h, 'cover natural height').toBeGreaterThan(1)
    }).toPass({ timeout: 20_000 })

    // Offer state — the pricing module is present and labelled honestly.
    await expect(page.getByRole('heading', { name: 'Price Comparison' })).toBeVisible()

    // A retailer control the visitor could act on. Presence only — this test
    // never follows it, so no affiliate click is logged.
    const retailerLinks = page.locator('a[href^="/go/"]')
    await expect(retailerLinks.first(), 'at least one retailer link on the flagship product').toBeVisible({ timeout: 20_000 })

    // Affiliate links must be marked as such. Stable, and a real trust rule.
    const rel = await retailerLinks.first().getAttribute('rel')
    expect(rel ?? '', 'retailer links must carry rel="sponsored"').toContain('sponsored')
  })

  // ── 6. Honest missing-state behaviour ────────────────────────────────────
  // W2-1 regression guard, asserted in a browser rather than in HTML source:
  // a Price History panel that renders only to say it has no price history is
  // an empty promise. Either it draws a chart, or it is absent.
  test('no always-empty Price History panel @prod-safe', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Price Comparison' })).toBeVisible()

    await expect(
      page.getByText(/Not enough price history/i),
      'the "Not enough price history" placeholder must never render',
    ).toHaveCount(0)

    // If the panel IS shown, it must have drawn something.
    const historyHeading = page.getByRole('heading', { name: 'Price History' })
    if (await historyHeading.count() > 0) {
      await expect(historyHeading.first()).toBeVisible()
      await expect(
        page.locator('svg').filter({ has: page.locator('path, polyline, line') }).first(),
        'a visible Price History panel must contain a rendered chart',
      ).toBeVisible()
    }
  })
})
