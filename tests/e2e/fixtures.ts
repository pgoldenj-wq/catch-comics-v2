/**
 * fixtures.ts — the small set of stable facts the browser suite leans on.
 *
 * These deliberately mirror scripts/launch-smoke.mjs so there is ONE set of
 * flagship fixtures for the whole trust stack. If a fixture record is ever
 * retired from the catalogue, both suites must be updated together.
 *
 * Nothing here is volatile: no prices, no offer counts, no catalogue totals,
 * no retailer ordering. Those change hourly and would make the suite lie.
 */

/** Flagship product — same record launch:smoke pins. */
export const FLAGSHIP_PRODUCT_SLUG = 'absolute-batman-volume-2-abomination-507512'

/** Flagship search term and the title fragment its results must contain. */
export const FLAGSHIP_QUERY = 'Absolute Batman'
export const FLAGSHIP_TITLE_RE = /absolute batman/i

/** A slug that must never exist — proves the 404 path, not a crash. */
export const UNKNOWN_PRODUCT_SLUG = 'browser-trust-does-not-exist'

/** Bounded sample size for cover checks. Never "all cards". */
export const COVER_SAMPLE_SIZE = 6

/**
 * Console noise we refuse to fail on.
 *
 * Every entry is either (a) not ours, or (b) an intentional product behaviour.
 * Failing on these would produce a permanently red suite that the founder
 * learns to ignore — which is worse than no suite at all.
 */
export const IGNORED_CONSOLE_PATTERNS: { pattern: RegExp; why: string }[] = [
  {
    pattern: /Content Security Policy|report-only|report-uri/i,
    why: 'CSP is deliberately Report-Only (Security Phase 2) — violations are reports, not breakage.',
  },
  {
    pattern: /Failed to load resource/i,
    why: 'Almost always a cover image 404 from a third-party CDN. The app renders its designed fallback by design; the cover test asserts real covers separately.',
  },
  {
    pattern: /ERR_BLOCKED_BY_CLIENT|ERR_NETWORK_CHANGED|ERR_INTERNET_DISCONNECTED/i,
    why: 'Client/network-side, not application code.',
  },
  {
    pattern: /third-party cookie|SameSite|Partitioned cookie/i,
    why: 'Browser deprecation warnings about third-party cookies — not Catch Comics code.',
  },
  {
    pattern: /ResizeObserver loop/i,
    why: 'Benign browser layout notification, not an application error.',
  },
  {
    pattern: /Download the React DevTools|react-devtools/i,
    why: 'React development-mode advice.',
  },
  {
    pattern: /\[Vercel Web Analytics\]|\/_vercel\/insights/i,
    why: 'Vercel Analytics debug output; absent in production, noisy locally.',
  },
  {
    pattern: /Warning: Extra attributes from the server|hydrated but some attributes/i,
    why: 'Browser-extension injected attributes cause this in a real browser profile.',
  },
]

export function isIgnoredConsoleMessage(text: string): boolean {
  return IGNORED_CONSOLE_PATTERNS.some(p => p.pattern.test(text))
}
