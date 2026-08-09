/**
 * global-setup.ts — fail fast, and explain, when the target is unreachable.
 *
 * Without this, a Vercel Preview sitting behind Deployment Protection makes
 * every test fail with a locator timeout, and the report says "element not
 * found" when the truth is "the runner was redirected to an SSO login page".
 * One probe up front turns eight confusing failures into one clear sentence.
 *
 * Skipped for LOCAL: Playwright's own webServer already waits for the dev
 * server, and a failure there is self-explanatory.
 */

import { resolveTarget } from './target'

const SSO_HINT = /vercel\.com\/sso-api|vercel\.com\/login/i

export default async function globalSetup(): Promise<void> {
  const target = resolveTarget()
  if (target.mode === 'local') return

  const headers: Record<string, string> = { 'User-Agent': 'cc-browser-trust/1' }
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
  if (bypass) headers['x-vercel-protection-bypass'] = bypass

  let res: Response
  try {
    res = await fetch(target.baseURL, {
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    })
  } catch (e) {
    throw new Error(`Browser Trust: ${target.baseURL} is unreachable — ${(e as Error).message}`)
  }

  const location = res.headers.get('location') ?? ''

  if (res.status === 401 || SSO_HINT.test(location)) {
    throw new Error(
      `Browser Trust: ${target.host} is behind Vercel Deployment Protection ` +
      `(HTTP ${res.status}${location ? ` → ${location.split('?')[0]}` : ''}).\n` +
      `A browser cannot reach it anonymously, so no test can run. Two fixes:\n` +
      `  A. Vercel → Project → Settings → Deployment Protection → set Vercel\n` +
      `     Authentication to "Disabled" for Preview. These are public catalogue\n` +
      `     pages; this is the simpler option and keeps CI traces available.\n` +
      `  B. Vercel → Settings → Deployment Protection → Protection Bypass for\n` +
      `     Automation → generate a secret, add it to GitHub Actions secrets as\n` +
      `     VERCEL_AUTOMATION_BYPASS_SECRET. Note that traces are disabled\n` +
      `     whenever that secret is in use, so the header never reaches an artifact.`,
    )
  }

  if (res.status >= 500) {
    throw new Error(`Browser Trust: ${target.baseURL} returned HTTP ${res.status} before any test ran.`)
  }
}
