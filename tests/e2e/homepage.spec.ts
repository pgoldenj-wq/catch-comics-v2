/**
 * Homepage — does the front door work in a real browser?
 *
 * Tests 1 and 2 of the Browser Trust suite.
 */

import { test, expect } from './base'
import { hasHorizontalOverflow } from './console-guard'
import { COVER_SAMPLE_SIZE } from './fixtures'
import { searchInput, visibleDealCovers } from './locators'

test.describe('Homepage', () => {
  // ── 1. Homepage trust ────────────────────────────────────────────────────
  // Desktop-only: the overflow assertion is stated at desktop width, and the
  // mobile equivalent is covered by the mobile navigation test.
  test('loads, does not scroll sideways, and shows essential navigation @prod-safe', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'Desktop-width assertion')

    const response = await page.goto('/')
    expect(response?.status(), 'homepage HTTP status').toBeLessThan(400)

    // Essential navigation — the things a visitor needs to get anywhere.
    await expect(page.getByRole('link', { name: 'Catch Comics home' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Series', exact: true })).toBeVisible()
    await expect(searchInput(page)).toBeVisible()

    // The page itself must not scroll horizontally. Inner carousels may.
    const overflow = await hasHorizontalOverflow(page)
    expect(
      overflow.overflows,
      `document scrolls horizontally: scrollWidth ${overflow.scrollWidth} > clientWidth ${overflow.clientWidth}`,
    ).toBe(false)

    // Uncaught page errors are asserted by the shared `errors` fixture.
  })

  // ── 2. Homepage covers ───────────────────────────────────────────────────
  // Bounded sample. The app deliberately hides broken covers behind a designed
  // fallback, so "an <img> exists" proves nothing — only decoded pixels do.
  test('a sample of rail covers render as real images @prod-safe', async ({ page }) => {
    await page.goto('/')

    // The rail is identified by its heading, which is trust copy launch:smoke
    // also guards — so it cannot drift silently.
    await expect(page.getByRole('heading', { name: 'Price finds today' }).first()).toBeVisible()

    const covers = visibleDealCovers(page)
    await expect(covers.first()).toBeVisible({ timeout: 20_000 })

    // Poll: images decode asynchronously, so a single immediate read reports
    // "not loaded yet" rather than "broken". Bounded by the sample size and a
    // 20s ceiling — never a scan of the whole rail.
    await expect(async () => {
      const sample = Math.min(await covers.count(), COVER_SAMPLE_SIZE)
      expect(sample, 'at least one visible rail cover to sample').toBeGreaterThan(0)

      const states = await covers.evaluateAll((els, limit) =>
        (els as HTMLImageElement[]).slice(0, limit).map(el => ({
          complete: el.complete,
          w: el.naturalWidth,
          h: el.naturalHeight,
          hiddenByApp: el.style.display === 'none',
        })), COVER_SAMPLE_SIZE)

      const real = states.filter(s => !s.hiddenByApp && s.complete && s.w > 1 && s.h > 1).length
      const detail = states
        .map((s, i) => `#${i}: ${s.hiddenByApp ? 'hidden by app fallback' : `complete=${s.complete} natural=${s.w}×${s.h}`}`)
        .join('\n')

      // Not "every cover" — a cover legitimately falls back to the designed
      // placeholder when the source 404s. But a rail where most of the sample
      // is blank is a trust failure the visitor sees immediately.
      expect(
        real,
        `only ${real}/${sample} sampled rail covers decoded real pixels.\n${detail}`,
      ).toBeGreaterThanOrEqual(Math.ceil(sample / 2))
    }).toPass({ timeout: 20_000 })
  })
})
