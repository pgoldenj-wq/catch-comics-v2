/**
 * check-amazon-creators-env.ts — confirms the Amazon Creators credentials were
 * entered correctly, WITHOUT revealing them.
 *
 * Prints presence and character counts only. A credential value is never
 * printed, logged, or written anywhere by this script.
 *
 * Run: npm run amazon:creators:check
 */

import {
  describeAmazonCreatorsEnv,
  isAmazonCreatorsConfigured,
  missingAmazonCreatorsVars,
} from '../lib/amazonCreatorsEnv'

const rows = describeAmazonCreatorsEnv()

console.log('\nAmazon Creators API — environment check')
console.log('(values are never printed; only presence and length)\n')

for (const r of rows) {
  const mark = r.present ? '✓' : r.required ? '✗' : '·'
  console.log(`  ${mark} ${r.name.padEnd(36)} ${r.detail}`)
}

// Common paste mistakes — detected without inspecting the value itself.
const warnings: string[] = []
for (const name of ['AMAZON_CREATORS_CLIENT_ID', 'AMAZON_CREATORS_CLIENT_SECRET', 'AMAZON_CREATORS_CREDENTIAL_VERSION']) {
  const raw = process.env[name]
  if (raw === undefined) continue
  if (raw !== raw.trim()) warnings.push(`${name} has leading/trailing whitespace — remove it.`)
  if (/^["'].*["']$/.test(raw.trim())) warnings.push(`${name} is wrapped in quotes — .env values must be unquoted.`)
  if (/\s/.test(raw.trim())) warnings.push(`${name} contains a space or line break — it must be one unbroken value.`)
}
if (process.env.NEXT_PUBLIC_AMAZON_CREATORS_CLIENT_SECRET !== undefined) {
  warnings.push('NEXT_PUBLIC_AMAZON_CREATORS_CLIENT_SECRET is set — DELETE IT. A NEXT_PUBLIC_ secret is exposed to every visitor.')
}

if (warnings.length > 0) {
  console.log('\nWarnings:')
  warnings.forEach(w => console.log(`  ! ${w}`))
}

if (isAmazonCreatorsConfigured()) {
  console.log('\nAMAZON CREATORS ENV: READY (credentials present — not yet used by any code path)')
  process.exit(warnings.length > 0 ? 1 : 0)
}

console.log(`\nAMAZON CREATORS ENV: NOT CONFIGURED — missing ${missingAmazonCreatorsVars().join(', ')}`)
console.log('Add them to .env.local (see .env.example for the CSV column mapping).')
process.exit(1)
