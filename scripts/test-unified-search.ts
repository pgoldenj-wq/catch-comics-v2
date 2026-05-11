/**
 * Smoke test for the unified search pipeline.
 *
 * Usage:
 *   npm run test:unified-search                    — run all test cases
 *   npm run test:unified-search -- --query "saga"  — single query
 *
 * Each case prints:
 *   canonical | unmatched | loose eBay count
 *   total duration
 *   first canonical result title (if any)
 */

import { unifiedSearch } from '../lib/search'

const CASES: Array<{ label: string; q: string; region: 'uk' | 'us' }> = [
  { label: 'omnibus (should hit canonical if any exist)',    q: 'saga omnibus',    region: 'uk' },
  { label: 'garbage query (should return empty)',           q: 'fjsdkfjsdhfkjsd', region: 'uk' },
  { label: 'broad popular title (tests merging + ranking)', q: 'spider-man',       region: 'us' },
  { label: 'ISBN-13 format',                               q: '9781534306035',    region: 'uk' },
  { label: 'UK region (eBay GB)',                          q: 'batman',           region: 'uk' },
]

async function run() {
  const args = process.argv.slice(2)
  const singleQueryIdx = args.indexOf('--query')
  const cases = singleQueryIdx >= 0
    ? [{ label: 'custom', q: args[singleQueryIdx + 1], region: 'uk' as const }]
    : CASES

  let allPassed = true

  for (const tc of cases) {
    process.stdout.write(`\n── ${tc.label} ──\n  q="${tc.q}" region=${tc.region}\n`)
    const t0     = Date.now()
    try {
      const result = await unifiedSearch({ q: tc.q, region: tc.region })
      const dur    = Date.now() - t0

      console.log(`  canonical: ${result.canonicalResults.length}  unmatched: ${result.unmatchedListings.length}  loose eBay: ${result.looseEbayResults.length}  total: ${result.total}`)
      console.log(`  duration:  ${dur}ms (debug: ${result.debug?.durationMs}ms)`)

      if (result.canonicalResults.length > 0) {
        const top = result.canonicalResults[0]
        console.log(`  top canonical: "${top.title}" — ${top.offers.length} offer(s), score=${top.score.toFixed(3)}`)
      }
      if (result.looseEbayResults.length > 0) {
        console.log(`  top eBay: "${result.looseEbayResults[0].title}"`)
      }
      if (result.unmatchedListings.length > 0) {
        console.log(`  top unmatched: "${result.unmatchedListings[0].title}"`)
      }

      // Basic sanity checks
      if (tc.q === 'fjsdkfjsdhfkjsd' && result.total > 0) {
        console.error('  ✗ FAIL: garbage query should return 0 results')
        allPassed = false
      } else {
        console.log(`  ✓ OK`)
      }
    } catch (err) {
      console.error(`  ✗ ERROR:`, err instanceof Error ? err.message : err)
      allPassed = false
    }
  }

  console.log('\n' + (allPassed ? '✓ All tests passed' : '✗ Some tests failed'))
  process.exit(allPassed ? 0 : 1)
}

run().catch(err => { console.error(err); process.exit(1) })
