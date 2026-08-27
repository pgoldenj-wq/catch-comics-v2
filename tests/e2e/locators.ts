/**
 * locators.ts — the two locators that need a visibility filter.
 *
 * Why this file exists: the homepage renders a COMPLETE mobile tree and a
 * COMPLETE desktop tree, switched with Tailwind `md:hidden` / `hidden md:block`.
 * Both are in the DOM at every viewport, so `getByRole('textbox', …)` matches
 * two inputs and `getByTestId('deal-cover')` matches both rails. Targeting
 * `.first()` would silently drive the hidden tree.
 *
 * Filtering to what the visitor can actually see is the correct behaviour for
 * every one of these tests, and it is needed in three specs — hence one shared
 * file rather than three copies. This is not a page-object layer; do not grow
 * it into one.
 */

import type { Locator, Page } from '@playwright/test'

/** The search box the visitor can actually see at the current viewport. */
export function searchInput(page: Page): Locator {
  return page
    .getByRole('textbox', { name: /Search comics, characters, or ISBN/i })
    .filter({ visible: true })
    .first()
}

/** Visible "Price finds today" rail cover images at the current viewport. */
export function visibleDealCovers(page: Page): Locator {
  return page.getByTestId('deal-cover').filter({ visible: true })
}
