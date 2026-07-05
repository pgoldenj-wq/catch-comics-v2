/**
 * Unit checks for the Phase-2 security helpers.
 * Run: npx tsx scripts/test-security-helpers.ts
 *
 * No test framework in this repo — these are plain assertions that exit non-zero
 * on failure so they can gate CI or a pre-push hook.
 */
import { jsonLdScriptString } from '../lib/security/jsonLd'
import { clampInt } from '../lib/security/http'

let failures = 0
function check(name: string, cond: boolean) {
  if (cond) {
    console.log(`  ok   ${name}`)
  } else {
    console.error(`  FAIL ${name}`)
    failures++
  }
}

console.log('jsonLdScriptString')
{
  // A poisoned title that tries to break out of the <script> element.
  const evil = { name: 'Batman</script><script>alert(document.cookie)</script>' }
  const out = jsonLdScriptString(evil)
  check('no raw "<" survives', !out.includes('<'))
  check('no raw ">" survives', !out.includes('>'))
  check('no literal </script breakout', !out.toLowerCase().includes('</script'))
  check('escapes < as \\u003c', out.includes('\\u003c'))
  // Round-trips back to the original data (structured data stays valid).
  check('round-trips to original', JSON.parse(out).name === evil.name)

  // Ampersand and line terminators — built via fromCharCode so no literal
  // line-terminator characters appear in this source.
  const LS = String.fromCharCode(0x2028)
  const PS = String.fromCharCode(0x2029)
  const ls = { s: 'a' + LS + 'b' + PS + 'c&d' }
  const out2 = jsonLdScriptString(ls)
  check('escapes U+2028', !out2.includes(LS) && out2.includes('\\u2028'))
  check('escapes U+2029', !out2.includes(PS) && out2.includes('\\u2029'))
  check('escapes &', !out2.includes('&') && out2.includes('\\u0026'))
  check('round-trips with line terminators', JSON.parse(out2).s === ls.s)
}

console.log('clampInt')
{
  check('clamps huge pageSize down to max', clampInt('1000000', 1, 50, 20) === 50)
  check('clamps below min up to min', clampInt('0', 1, 50, 20) === 1)
  check('passes valid value through', clampInt('20', 1, 50, 20) === 20)
  check('NaN falls back', clampInt('abc', 1, 50, 20) === 20)
  check('null falls back', clampInt(null, 1, 50, 20) === 20)
  check('undefined falls back', clampInt(undefined, 1, 50, 20) === 20)
  check('negative falls back to min', clampInt('-5', 1, 50, 20) === 1)
  check('page max applies', clampInt('99999999', 1, 10000, 1) === 10000)
}

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`)
  process.exit(1)
}
console.log('\nAll security-helper checks passed.')
