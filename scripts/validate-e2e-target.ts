/**
 * validate-e2e-target.ts — fail a CI job on a bad target URL in seconds.
 *
 * Used by .github/workflows/browser-trust.yml before Chromium is downloaded,
 * so a mistyped or hostile workflow_dispatch URL costs ~20s instead of a full
 * browser install. It deliberately imports the SAME allowlist the test run
 * enforces — there is no second copy of the rules to drift.
 *
 *   npx tsx scripts/validate-e2e-target.ts https://www.catchcomics.com
 */

import { assertAllowedTarget, DisallowedTargetError } from '../tests/e2e/target'

const raw = process.argv[2]

if (!raw) {
  console.error('Usage: tsx scripts/validate-e2e-target.ts <url>')
  process.exit(2)
}

try {
  const target = assertAllowedTarget(raw, { ci: !!process.env.CI })
  console.log(`✓ Target allowed: ${target.baseURL} (${target.mode})`)
  process.exit(0)
} catch (err) {
  if (err instanceof DisallowedTargetError) {
    console.error(`✗ ${err.message}`)
    process.exit(1)
  }
  throw err
}
