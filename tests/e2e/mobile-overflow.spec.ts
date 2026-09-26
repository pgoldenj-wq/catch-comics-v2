/**
 * mobile-overflow.spec.ts — no page may scroll sideways on a phone or tablet.
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
 * 768px is iPad portrait and the first width at which Tailwind's md: layouts
 * switch on — the homepage swaps to an entirely different desktop layout
 * there. On 2026-09-26 that layout measured 824px wide at 768 (1080px at 1024):
 * the hero's red-glow bloom sits 80px past the card and the gutter is 24px.
 * Phone-only coverage could never have seen it.
 *
 * @prod-safe — read-only page loads, no clicks, no writes, no affiliate hits.
 */
import { test, expect } from '@playwright/test'

const VIEWPORTS = [
  { width: 390, height: 844 },  // iPhone 12–15 logical viewport
  { width: 768, height: 1024 }, // iPad portrait — first md: width
]

const PAGES: Array<{ name: string; path: string }> = [
  { name: 'homepage',     path: '/' },
  { name: 'search results', path: '/search?q=absolute+batman' },
  { name: 'product page', path: '/product/hellboy-omnibus-706665' },
]

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.width}px`, () => {
    test.use({ viewport })

    for (const page of PAGES) {
      test(`${page.name} does not scroll sideways at ${viewport.width}px @prod-safe`, async ({ page: p }) => {
        await p.goto(page.path, { waitUntil: 'domcontentloaded' })
        // Offers and covers arrive after hydration and are the usual suspects.
        await p.waitForLoadState('networkidle').catch(() => {})

        const { docWidth, viewportWidth, offenders } = await p.evaluate(() => {
          const vw = document.documentElement.clientWidth
          // An element past the edge only widens the document if no ancestor
          // clips it. Skip clipped ones (carousel cards, their arrow icons) so
          // the report names the real culprit. body and html don't count:
          // while html is overflow:visible, body's overflow-x is handed to the
          // viewport and body itself clips nothing, whatever its computed style.
          const clippedByAncestor = (el: Element) => {
            for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
              if (getComputedStyle(a).overflowX !== 'visible') return true
            }
            return false
          }
          const offenders = [...document.querySelectorAll<HTMLElement>('body *')]
            .filter(el => !clippedByAncestor(el))
            .map(el => {
              const r = el.getBoundingClientRect()
              const cls = typeof el.className === 'string' ? el.className.trim() : ''
              const style = el.getAttribute('style')
              return {
                selector: el.tagName.toLowerCase() +
                  (el.id ? `#${el.id}` : '') +
                  (cls ? '.' + cls.split(/\s+/).slice(0, 3).join('.') : '') +
                  // Inline-styled decorative divs have nothing else to go on.
                  (!el.id && !cls && style ? `[style="${style.slice(0, 80)}…"]` : ''),
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
          `Widest unclipped elements past the edge: ${
            offenders.length
              ? offenders.map(o => `${o.selector} (right ${o.right}px, width ${o.width}px)`).join('; ')
              : 'none identified — check a fixed width or min-width on an ancestor'
          }`,
        ).toBeLessThanOrEqual(viewportWidth + 1)
      })
    }
  })
}
