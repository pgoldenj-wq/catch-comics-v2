/**
 * product-layout.spec.ts — on every width, the price comes before the scroll.
 *
 * Final smoke test, 2026-09-26, measured on production:
 *
 *   390px  Saga Volume 1's Price Comparison started 11,898px down the page —
 *          below all 72 covers of "Issues in this series". The layout's
 *          `order-1` (pricing) / `order-2` (issues) classes were meant to flip
 *          that on phones, but `order` only works inside flex or grid, and
 *          below md the row was a plain block. The classes did nothing.
 *
 *   768px  Three fixed columns (240 + 320 + gaps) left pricing 112px wide: the
 *          column headers ran together ("RIPRICE"), "eBay" sat on top of its
 *          price, and the New/Used tabs spilled into the Description column.
 *
 * mobile-overflow.spec.ts could not see either: nothing widened the document.
 * Saga Volume 1 is the fixture because its 72-issue rail is the worst case.
 *
 * @prod-safe — read-only page loads, no clicks, no writes, no affiliate hits.
 */
import { test, expect, type Page } from '@playwright/test'

const SLUG = 'saga-volume-1-370548'

async function layout(p: Page) {
  await p.goto(`/product/${SLUG}`, { waitUntil: 'domcontentloaded' })
  await p.waitForLoadState('networkidle').catch(() => {})
  return p.evaluate(() => {
    const box = (el: Element | null | undefined) => {
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { top: Math.round(r.top + scrollY), left: Math.round(r.left), width: Math.round(r.width) }
    }
    const h2 = (re: RegExp) => [...document.querySelectorAll('h2')].find(h => re.test(h.textContent ?? ''))
    return {
      price: box(document.getElementById('price-comparison')),
      issues: box(h2(/Issues in this series|Collected in this volume/)),
      description: box(h2(/^\s*Description/)),
    }
  })
}

test.describe('390px phone', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('pricing comes before the issue rail @prod-safe', async ({ page }) => {
    const l = await layout(page)
    expect(l.price, 'Price Comparison block missing').not.toBeNull()
    expect(l.price!.top, 'Price Comparison should start within the first two screens').toBeLessThan(844 * 2)
    if (l.issues) {
      expect(l.price!.top, `pricing at ${l.price!.top}px must precede the issue rail at ${l.issues.top}px`)
        .toBeLessThan(l.issues.top)
    }
  })
})

test.describe('768px tablet', () => {
  test.use({ viewport: { width: 768, height: 1024 } })

  test('the price column is wide enough to read, and description sits under it @prod-safe', async ({ page }) => {
    const l = await layout(page)
    expect(l.price, 'Price Comparison block missing').not.toBeNull()
    expect(l.price!.width, `price column is ${l.price!.width}px wide`).toBeGreaterThanOrEqual(360)
    expect(l.description, 'Description heading missing').not.toBeNull()
    // Same column as pricing, directly below it — not after the whole rail.
    expect(Math.abs(l.description!.left - l.price!.left)).toBeLessThanOrEqual(2)
    expect(l.description!.top).toBeLessThan(l.price!.top + 1500)
  })
})

test.describe('1024px and up', () => {
  test.use({ viewport: { width: 1024, height: 768 } })

  test('issues, pricing and description sit side by side @prod-safe', async ({ page }) => {
    const l = await layout(page)
    expect(l.price && l.issues && l.description, 'a column is missing').toBeTruthy()
    expect(l.issues!.left).toBeLessThan(l.price!.left)
    expect(l.price!.left).toBeLessThan(l.description!.left)
    expect(l.price!.width).toBeGreaterThanOrEqual(300)
  })
})
