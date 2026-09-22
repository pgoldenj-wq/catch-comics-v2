/**
 * mobile-overflow.spec.ts — no page may scroll sideways on a phone.
 *
 * The 2026-09-01 founder review recorded every product page rendering 644px
 * wide inside a 390px viewport, on production, with the header search form
 * named as the overflowing element. It was seen and never confirmed, because
 * the finding predates any test that could confirm it: Browser Trust's
 * mobile-chromium project runs at Pixel 7 (412px) and asserts plenty about
 * content, nothing about layout width.
 *
 * Horizontal scroll is not cosmetic on this site. Most comic shoppers are on a
 * phone, and a page that drifts sideways under the thumb hides exactly the
 * column that matters — the price and the retailer button on the right.
 *
 * 390px is the iPhone 12/13/14/15 logical width and the narrowest mainstream
 * size worth supporting; anything that survives it survives a Pixel too.
 *
 * @prod-safe — read-only page loads, no clicks, no writes, no affiliate hits.
 */
import { test, expect } from '@playwright/test'

/** iPhone 12–15 logical viewport. */
const PHONE = { width: 390, height: 844 }

const PAGES: Array<{ name: string; path: string }> = [
  { name: 'homepage',     path: '/' },
  { name: 'search results', path: '/search?q=absolute+batman' },
  { name: 'product page', path: '/product/hellboy-omnibus-706665' },
]

test.use({ viewport: PHONE })

for (const page of PAGES) {
  test(`${page.name} does not scroll sideways at 390px @prod-safe`, async ({ page: p }) => {
    await p.goto(page.path, { waitUntil: 'domcontentloaded' })
    // Offers and covers arrive after hydration and are the usual suspects.
    await p.waitForLoadState('networkidle').catch(() => {})

    const { docWidth, viewportWidth, offenders } = await p.evaluate(() => {
      const vw = document.documentElement.clientWidth
      const offenders = [...document.querySelectorAll<HTMLElement>('body *')]
        .map(el => {
          const r = el.getBoundingClientRect()
          return {
            selector: el.tagName.toLowerCase() +
              (el.id ? `#${el.id}` : '') +
              (typeof el.className === 'string' && el.className.trim()
                ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.')
                : ''),
            right: Math.round(r.right),
            width: Math.round(r.width),
          }
        })
        // 1px of rounding slack; anything past that is a real overflow.
        .filter(x => x.right > vw + 1)
        .sort((a, b) => b.right - a.right)
        .slice(0, 5)
      return { docWidth: document.documentElement.scrollWidth, viewportWidth: vw, offenders }
    })

    expect(
      docWidth,
      `${page.name} is ${docWidth}px wide in a ${viewportWidth}px viewport. ` +
      `Widest elements past the edge: ${
        offenders.length
          ? offenders.map(o => `${o.selector} (right ${o.right}px, width ${o.width}px)`).join('; ')
          : 'none identified — check a fixed width or min-width on an ancestor'
      }`,
    ).toBeLessThanOrEqual(viewportWidth + 1)
  })
}
