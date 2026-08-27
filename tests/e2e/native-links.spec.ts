/**
 * Native link behaviour — can a visitor open a card in a new tab?
 *
 * The question this file answers, and no other: when someone Ctrl/⌘+clicks or
 * middle-clicks a navigational card, does the BROWSER open a new tab, and does
 * the page they were on stay put?
 *
 * Why it asserts interaction and not markup
 * -----------------------------------------
 * Asserting `toHaveAttribute('href')` would have passed on every regression
 * this file exists to catch. Two real defects were found on 2026-08-27 with a
 * genuine `<a href>` already in the DOM:
 *
 *   1. A row's onClick called setState, React flushed that discrete update
 *      synchronously at the end of event dispatch, the <a> unmounted, and
 *      Chromium cancelled the navigation for a detached anchor. Ctrl+click did
 *      nothing at all.
 *   2. `role="option"` on an <a> inside `role="listbox"` suppressed Chromium's
 *      middle-click-opens-link entirely. Proven by DOM A/B: removing either
 *      role restored it with every other attribute and handler identical.
 *
 * Neither is visible in markup. So every case here performs the real gesture
 * and waits for the browser context to hand us a real page.
 *
 * reducedMotion is not a convenience
 * ----------------------------------
 * The deal rail translates its track every 16ms and the hero covers run a CSS
 * sway, so those elements are never "stable" and Playwright's actionability
 * check can never click them. Under prefers-reduced-motion the product stops
 * both (by design — see app/page.tsx and globals.css), which lets these tests
 * click through the normal actionability path instead of forcing clicks.
 * `carousel drift does not break activation` covers the animated case.
 *
 * @prod-safe throughout: opens tabs, reads pages, writes nothing.
 */

import { test, expect } from './base'
import type { Locator, Page, BrowserContext } from '@playwright/test'
import { FLAGSHIP_QUERY } from './fixtures'
import { searchInput } from './locators'

type Gesture = { modifiers: ['ControlOrMeta'] } | { button: 'middle' }

/**
 * How long to wait for the browser to hand us the new tab.
 *
 * Generous on purpose. The tab itself is created immediately, but Playwright
 * emits 'page' once the target is live, and against a LOCAL dev server a
 * background tab pointed at a not-yet-compiled route (/search is the slow one)
 * can take well over ten seconds to get there. Measured 2026-08-27: links to
 * /search passed 2/4 at an 8s wait and 4/4 at 35s, while links to already-warm
 * routes passed either way — a compile-latency artifact, not a product one.
 * Production is far quicker; the wait costs nothing when the tab is prompt.
 */
const NEW_TAB_TIMEOUT_MS = 30_000

const CTRL: Gesture = { modifiers: ['ControlOrMeta'] }
const MIDDLE: Gesture = { button: 'middle' }

/**
 * Perform `gesture` on `locator` and assert the browser opened a new tab at
 * the link's own href, leaving the original page where it was.
 *
 * Racing `context.waitForEvent('page')` against the click matters: a fixed
 * sleep plus an on/off listener drops tabs that arrive a beat late and reports
 * a false negative, which is exactly the flake this suite must not have.
 */
async function expectNewTab(
  context: BrowserContext,
  page: Page,
  locator: Locator,
  gesture: Gesture,
  what: string,
) {
  const href = await locator.getAttribute('href')
  expect(href, `${what} must expose a real href`).toBeTruthy()

  const urlBefore = page.url()
  const pagePromise = context.waitForEvent('page', { timeout: NEW_TAB_TIMEOUT_MS })
  await locator.click(gesture as Parameters<Locator['click']>[0])

  const opened = await pagePromise.catch(() => null)
  expect(opened, `${what}: ${JSON.stringify(gesture)} should open a new tab`).not.toBeNull()

  await opened!.waitForURL(u => u.toString() !== 'about:blank', { timeout: 15_000 }).catch(() => {})
  const openedPath = new URL(opened!.url()).pathname + new URL(opened!.url()).search
  const expectedPath = new URL(href!, page.url()).pathname + new URL(href!, page.url()).search
  expect(openedPath, `${what}: new tab should land on the link's own destination`).toBe(expectedPath)

  expect(page.url(), `${what}: the original tab must not navigate`).toBe(urlBefore)
  await opened!.close()
}

/**
 * Stop the product's motion, then put the rail on screen.
 *
 * reducedMotion is applied per page rather than via test.use() so it is a
 * plain typed API call on the extended test's page. The scroll matters as much
 * as the motion: the rail sits below the fold at 1280x800, and
 * document.elementFromPoint only answers for coordinates inside the viewport.
 */
async function settleHomepage(page: Page, scrollTo?: string) {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  if (scrollTo) {
    await expect(page.locator(scrollTo).first()).toBeAttached({ timeout: 20_000 })
    await page.locator(scrollTo).first().scrollIntoViewIfNeeded()
  }
  await page.waitForTimeout(2_500)
}

/**
 * The rail renders three copies of the deal set inside a clipping container
 * and translates the track, so most `.deal-card` nodes are off-screen or
 * clipped. Return the nth card whose own centre is genuinely hit-testable —
 * i.e. one a visitor could actually aim at.
 */
async function clickableRailCard(page: Page, nth: number): Promise<Locator> {
  const cards = page.locator('.deal-card')
  const count = await cards.count()
  let seen = 0
  for (let i = 0; i < count; i++) {
    const hittable = await cards.nth(i).evaluate((a) => {
      const r = a.getBoundingClientRect()
      if (r.width < 8 || r.height < 8) return false
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      return !!top && a.contains(top)
    }).catch(() => false)
    if (hittable && seen++ === nth) return cards.nth(i)
  }
  throw new Error(`no hit-testable deal card at index ${nth}`)
}

test.describe('Native link behaviour', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'Gesture semantics are asserted on Chromium')

  // ── Homepage: Price finds today ─────────────────────────────────────────
  test('price-finds cards open in a new tab on ctrl+click and middle-click @prod-safe', async ({ page, context }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'The deal rail is a desktop surface')
    await settleHomepage(page, '.deal-card')

    for (const nth of [0, 1, 2]) {
      const card = await clickableRailCard(page, nth)
      await expectNewTab(context, page, card, CTRL, `deal card #${nth}`)
      await expectNewTab(context, page, await clickableRailCard(page, nth), MIDDLE, `deal card #${nth}`)
    }
  })

  test('a plain left click on a price-finds card still navigates in the same tab @prod-safe', async ({ page, context }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'The deal rail is a desktop surface')
    await settleHomepage(page, '.deal-card')

    const card = await clickableRailCard(page, 0)
    const href = await card.getAttribute('href')
    const before = context.pages().length

    await card.click()
    await page.waitForURL(`**${href}`, { timeout: 20_000 })

    expect(context.pages().length, 'a plain click must not spawn a tab').toBe(before)
  })

  // ── Homepage: hero cover stack ──────────────────────────────────────────
  test('all three hero comics open in a new tab on ctrl+click and middle-click @prod-safe', async ({ page, context }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'The hero cover stack is a desktop surface')
    await settleHomepage(page, '[aria-label^="Search for "]')
    const covers = page.locator('[aria-label^="Search for "]')
    await expect(covers).toHaveCount(3, { timeout: 20_000 })

    for (const nth of [0, 1, 2]) {
      await expectNewTab(context, page, covers.nth(nth), CTRL, `hero cover #${nth}`)
      await expectNewTab(context, page, covers.nth(nth), MIDDLE, `hero cover #${nth}`)
    }
  })

  // ── Search results ──────────────────────────────────────────────────────
  test('search results open in a new tab on ctrl+click and middle-click @prod-safe', async ({ page, context }) => {
    await page.goto(`/search?q=${encodeURIComponent(FLAGSHIP_QUERY)}&region=uk`)
    const rows = page.locator('a[aria-label^="View details for"]')
    await expect(rows.first(), 'search results should render as real links').toBeVisible({ timeout: 30_000 })

    // A result row must be an anchor, never a div wearing role="link" — that
    // shape ignored the modifier key and navigated the current tab instead.
    await expect(page.locator('[role="link"]'), 'no hand-rolled role="link" rows').toHaveCount(0)

    for (const nth of [0, 1, 2]) {
      await expectNewTab(context, page, rows.nth(nth), CTRL, `search result #${nth}`)
      await expectNewTab(context, page, rows.nth(nth), MIDDLE, `search result #${nth}`)
    }
  })

  // ── Autocomplete suggestions ────────────────────────────────────────────
  test('a search suggestion opens in a new tab on ctrl+click and middle-click @prod-safe', async ({ page, context }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'Mobile autocomplete is covered by the mobile journey test')
    await settleHomepage(page)

    const input = searchInput(page)
    await input.click()
    await input.pressSequentially(FLAGSHIP_QUERY, { delay: 40 })

    const suggestions = page.getByRole('navigation', { name: 'Search suggestions' })
    await expect(suggestions).toBeVisible({ timeout: 20_000 })

    // Autocomplete is debounced per keystroke, so the panel can become visible
    // on an intermediate result set and swap its rows a moment later. Clicking
    // across that swap detaches the anchor mid-dispatch and the browser drops
    // the navigation — a genuine race, but the test's, not the product's.
    // Wait until the first row stops changing before asserting on the gesture.
    await expect(async () => {
      const before = await suggestions.getByRole('link').first().getAttribute('href')
      await page.waitForTimeout(700)
      const after = await suggestions.getByRole('link').first().getAttribute('href')
      expect(after).toBe(before)
    }).toPass({ timeout: 15_000 })

    // Autocomplete is debounced per keystroke, so the panel can become visible
    // on an intermediate result set and swap its rows a moment later. Settle
    // first: clicking across a swap is a race the test would lose, not a
    // product defect.
    await expect(async () => {
      const before = await suggestions.getByRole('link').first().getAttribute('href')
      await page.waitForTimeout(700)
      expect(await suggestions.getByRole('link').first().getAttribute('href')).toBe(before)
    }).toPass({ timeout: 15_000 })

    await expectNewTab(context, page, suggestions.getByRole('link').first(), CTRL, 'suggestion')

    // The dropdown must survive a new-tab gesture: tearing it down inside the
    // click handler unmounts the anchor mid-dispatch and kills the navigation.
    await expect(suggestions, 'dropdown should stay open after a new-tab gesture').toBeVisible()

    await expectNewTab(context, page, suggestions.getByRole('link').first(), MIDDLE, 'suggestion')
  })

  // ── Issue grid + series card ────────────────────────────────────────────
  test('issue-grid and series cards open in a new tab @prod-safe', async ({ page, context }) => {
    await page.goto('/comic/796?region=uk')
    const issue = page.locator('a[href^="/comic/i"]').filter({ visible: true }).first()
    await expect(issue).toBeVisible({ timeout: 25_000 })
    await expectNewTab(context, page, issue, CTRL, 'issue-grid card')
    await expectNewTab(context, page, issue, MIDDLE, 'issue-grid card')

    await settleHomepage(page, 'a[href^="/series/"]')
    const series = page.locator('a[href^="/series/"]').filter({ visible: true }).first()
    await expect(series).toBeVisible({ timeout: 20_000 })
    await expectNewTab(context, page, series, CTRL, 'series card')
  })

  // ── The animated case ───────────────────────────────────────────────────
  test('carousel drift does not break link activation @prod-safe', async ({ page, context }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'The deal rail is a desktop surface')
    // Animations ON: the rail is translating and the covers are swaying. Force
    // skips only Playwright's stability veto — the dispatched click is a real
    // browser event, so a suppressed default action would still show up here.
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await settleHomepage(page, '.deal-card')

    const card = await clickableRailCard(page, 1)
    const href = await card.getAttribute('href')
    const pagePromise = context.waitForEvent('page', { timeout: NEW_TAB_TIMEOUT_MS })
    await card.click({ modifiers: ['ControlOrMeta'], force: true })

    const opened = await pagePromise.catch(() => null)
    expect(opened, 'a drifting card must still open a new tab').not.toBeNull()
    await opened!.waitForURL(u => u.toString() !== 'about:blank', { timeout: 15_000 }).catch(() => {})
    expect(new URL(opened!.url()).pathname).toBe(new URL(href!, page.url()).pathname)
    await opened!.close()
  })

  // ── Structural guard ────────────────────────────────────────────────────
  test('navigational surfaces contain no invalid nested interactive elements @prod-safe', async ({ page }) => {
    for (const path of ['/', `/search?q=${encodeURIComponent(FLAGSHIP_QUERY)}&region=uk`, '/comic/796?region=uk']) {
      await page.goto(path)
      await page.waitForTimeout(3_000)
      const bad = await page.evaluate(() => ({
        anchorInAnchor: document.querySelectorAll('a a').length,
        buttonInAnchor: document.querySelectorAll('a button').length,
        anchorInButton: document.querySelectorAll('button a').length,
        // An <a> wearing a non-link ARIA role: proven to suppress Chromium's
        // middle-click-opens-link.
        roleShadowedAnchor: document.querySelectorAll('a[href][role]:not([role="link"])').length,
      }))
      expect(bad, `invalid interactive nesting on ${path}`).toEqual({
        anchorInAnchor: 0, buttonInAnchor: 0, anchorInButton: 0, roleShadowedAnchor: 0,
      })
    }
  })
})
