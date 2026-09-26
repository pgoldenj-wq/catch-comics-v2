/**
 * cover-resolution.spec.ts — a cover must carry enough real pixels for the
 * screen it is drawn on.
 *
 * 2026-09-26: covers across the site looked soft on phones. The cause was not
 * CSS or next/image: 10,067 stored covers were 200x200 white-letterboxed AWIN
 * retailer thumbnails — ~133px of actual artwork drawn into a ~98 CSS px frame
 * on a 2x screen (needs 196px). scripts/upgrade-lowres-covers.ts replaced them
 * from exact-ISBN sources. These tests pin both layers that can bring it back:
 *
 *   1. DATA  — the named repro covers carry >= 2 real artwork pixels per CSS px.
 *   2. RENDER — whatever the image pipeline delivers (raw <img> or next/image
 *      srcset) is never smaller than min(stored source, CSS width x DPR): a bad
 *      `sizes`, a fixed small width or an optimiser cap would fail here.
 *
 * Pixel widths are measured by decoding the bytes actually served, never from
 * naturalWidth (srcset w-descriptors make that density-corrected) and never
 * from a hard-coded CDN URL.
 *
 * @prod-safe — read-only page loads and image GETs; no affiliate clicks, no writes.
 */
import sharp from 'sharp'
import type { Page } from '@playwright/test'
import { test, expect } from './base'

const PHONE = { width: 390, height: 844 }
const DPR = 2

/** Launch-critical repro: every one of these was a 200px thumbnail. */
const REPRO_QUERY = 'Blade runner'
const REPRO_TITLES = [
  'Blade Runner 2029 Vol. 1',
  'Blade Runner 2019 Volume 1',
  'Blade Runner 2039 Vol. 1',
  'Blade Runner 2029 Vol. 2',
]

test.use({ viewport: PHONE, deviceScaleFactor: DPR })

interface Cover { alt: string; cssW: number; cssH: number; src: string }

/** Decode the bytes actually served for `url` and return their pixel size. */
async function servedPixels(page: Page, url: string): Promise<{ w: number; h: number }> {
  const res = await page.request.get(url, { headers: { Accept: 'image/avif,image/webp,image/*' } })
  expect(res.ok(), `image request failed (${res.status()}): ${url}`).toBeTruthy()
  const m = await sharp(await res.body()).metadata()
  return { w: m.width ?? 0, h: m.height ?? 0 }
}

/** Real artwork pixels behind a 2:3 object-fit:cover frame (letterbox bars crop away). */
const artworkPx = (w: number, h: number, cssW: number, cssH: number) => Math.min(w, h * (cssW / cssH))

/** For a next/image URL, the original it was derived from; otherwise null. */
function optimiserSource(src: string): string | null {
  const u = new URL(src)
  return u.pathname === '/_next/image' ? u.searchParams.get('url') : null
}

async function searchCovers(page: Page, query: string): Promise<Cover[]> {
  await page.goto(`/search?q=${encodeURIComponent(query)}&region=uk`)
  const first = page.locator('.cover-card-md img').first()
  await expect(first, 'search results should render covers').toBeVisible({ timeout: 20_000 })
  return page.locator('.cover-card-md img').evaluateAll(els =>
    (els as HTMLImageElement[]).map(i => {
      const r = i.getBoundingClientRect()
      return { alt: i.alt, cssW: r.width, cssH: r.height, src: i.currentSrc || i.src }
    }))
}

test.describe('Cover resolution on a 2x phone', () => {
  test.skip(({ isMobile }) => !isMobile, 'Phone-density check — runs once, in the mobile project')

  test('the Blade Runner repro covers carry 2x artwork pixels @prod-safe', async ({ page }) => {
    const covers = await searchCovers(page, REPRO_QUERY)
    const failures: string[] = []
    for (const title of REPRO_TITLES) {
      const c = covers.find(x => x.alt.startsWith(title))
      expect(c, `"${title}" should appear with a cover in results for "${REPRO_QUERY}"`).toBeTruthy()
      const px = await servedPixels(page, c!.src)
      const art = artworkPx(px.w, px.h, c!.cssW, c!.cssH)
      const need = c!.cssW * DPR
      if (art < need) failures.push(`${title}: ${Math.round(art)}px of artwork for a ${Math.round(c!.cssW)} CSS px frame (needs ${Math.round(need)})`)
    }
    expect(failures, `soft covers on a ${DPR}x phone:\n${failures.join('\n')}`).toEqual([])
  })

  test('the product-page cover is delivered at the density the source allows @prod-safe', async ({ page }) => {
    const covers = await searchCovers(page, REPRO_QUERY)
    expect(covers.length).toBeGreaterThan(0)
    const href = await page.getByRole('link', { name: new RegExp(`View details for ${REPRO_TITLES[0].replace(/[.]/g, '\\.')}`) })
      .first().getAttribute('href')
    expect(href, 'repro product link').toBeTruthy()
    await page.goto(href!)

    const hero = page.locator('img[alt^="Cover of"]').first()
    await expect(hero).toBeVisible({ timeout: 20_000 })
    await expect.poll(() => hero.evaluate(i => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0)).toBe(true)
    const { cssW, cssH, src } = await hero.evaluate(i => {
      const r = i.getBoundingClientRect()
      return { cssW: r.width, cssH: r.height, src: (i as HTMLImageElement).currentSrc }
    })

    const delivered = await servedPixels(page, src)
    const original = optimiserSource(src)
    const sourceW = original ? (await servedPixels(page, original)).w : delivered.w
    const need = Math.min(sourceW, Math.ceil(cssW * DPR))
    expect(
      delivered.w,
      `hero cover delivered at ${delivered.w}px for ${Math.round(cssW)} CSS px at ${DPR}x (source ${sourceW}px) — ` +
      `the render path is throwing resolution away (check sizes / srcset / width)`,
    ).toBeGreaterThanOrEqual(Math.floor(need * 0.95))
    // And the fix itself holds on this surface: real artwork, not a letterboxed thumbnail.
    const art = artworkPx(delivered.w, delivered.h, cssW, cssH)
    expect(art, `product-page cover has ${Math.round(art)}px of artwork for ${Math.round(cssW)} CSS px at ${DPR}x`)
      .toBeGreaterThanOrEqual(Math.floor(cssW * DPR * 0.95))
  })
})
