/**
 * target.ts — which site does Browser Trust point at, and is that allowed?
 *
 * Three modes, chosen by PLAYWRIGHT_TARGET_URL:
 *
 *   unset                      → LOCAL      http://localhost:3000 (Playwright starts `next dev`)
 *   https://www.catchcomics.com → PRODUCTION (read-only suite only)
 *   https://catch-comics-….vercel.app → PREVIEW (set by CI from the Vercel deployment)
 *
 * The allowlist is the safety boundary for `workflow_dispatch`: a URL typed
 * into the Actions tab is founder input, and this suite must never be pointed
 * at an unrelated host. A rejected target throws BEFORE any browser launches,
 * so nothing is ever requested from a host we did not intend to test.
 */

export type E2EMode = 'local' | 'preview' | 'production'

export interface E2ETarget {
  mode:    E2EMode
  baseURL: string
  /** Hostname alone — safe to print into reports and the Command Centre. */
  host:    string
}

export const LOCAL_BASE_URL = 'http://localhost:3000'
export const PRODUCTION_BASE_URL = 'https://www.catchcomics.com'

/** Exact production hostnames we own. */
const PRODUCTION_HOSTS = ['catchcomics.com', 'www.catchcomics.com']

/**
 * Vercel Preview hostnames for THIS project. `.vercel.app` alone is not
 * ownership — anyone can own `evil.vercel.app` — so the project prefix is
 * required too. Vercel emits e.g.
 *   catch-comics-v2-<hash>-pgoldenj-wqs-projects.vercel.app
 */
const PREVIEW_HOST_PREFIX = 'catch-comics'
const PREVIEW_HOST_SUFFIX = '.vercel.app'

export class DisallowedTargetError extends Error {
  constructor(raw: string, reason: string) {
    super(
      `Refusing to run Browser Trust against ${JSON.stringify(raw)}: ${reason}.\n` +
      `Allowed: https://www.catchcomics.com, https://catchcomics.com, ` +
      `or https://${PREVIEW_HOST_PREFIX}-*${PREVIEW_HOST_SUFFIX}.`,
    )
    this.name = 'DisallowedTargetError'
  }
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/

/**
 * Validate a founder- or CI-supplied target URL and classify it.
 * Throws DisallowedTargetError for anything not owned by Catch Comics.
 */
export function assertAllowedTarget(raw: string, opts: { ci: boolean }): E2ETarget {
  const trimmed = (raw || '').trim()
  if (!trimmed) throw new DisallowedTargetError(raw, 'empty URL')

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new DisallowedTargetError(raw, 'not a valid absolute URL')
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new DisallowedTargetError(raw, `unsupported protocol ${url.protocol}`)
  }
  if (opts.ci && url.protocol !== 'https:') {
    throw new DisallowedTargetError(raw, 'CI requires https')
  }

  const host = url.hostname.toLowerCase()

  // Explicitly named rejections — clearer failure text than "not allowlisted".
  if (host === 'localhost' || host.endsWith('.localhost')) {
    throw new DisallowedTargetError(raw, 'localhost is not a remote target (omit the URL for LOCAL mode)')
  }
  if (IPV4.test(host) || host.includes(':') || url.hostname.startsWith('[')) {
    throw new DisallowedTargetError(raw, 'raw IP addresses are not allowed')
  }

  if (PRODUCTION_HOSTS.includes(host)) {
    return { mode: 'production', baseURL: stripTrailingSlash(url.origin), host }
  }
  if (host.startsWith(PREVIEW_HOST_PREFIX) && host.endsWith(PREVIEW_HOST_SUFFIX)) {
    return { mode: 'preview', baseURL: stripTrailingSlash(url.origin), host }
  }

  throw new DisallowedTargetError(raw, `host ${host} is not a Catch Comics host`)
}

/** Resolve the target for this run from the environment. */
export function resolveTarget(): E2ETarget {
  const raw = process.env.PLAYWRIGHT_TARGET_URL
  if (!raw || !raw.trim()) {
    return { mode: 'local', baseURL: LOCAL_BASE_URL, host: 'localhost:3000' }
  }
  return assertAllowedTarget(raw, { ci: !!process.env.CI })
}

function stripTrailingSlash(s: string): string {
  return s.replace(/\/+$/, '')
}
