#!/usr/bin/env tsx
/**
 * One-shot probe — check which comic retailer domains expose a supported API.
 * Run: npx dotenv -e .env.local -- tsx scripts/probe-retailers.ts
 */

import { detectPlatform } from '../lib/adapters/platform_auto_detect'

const CANDIDATES: { domain: string; note: string; currency: string; country: string }[] = [
  { domain: 'tfaw.com',                    note: 'Things From Another World (US)',    currency: 'USD', country: 'US' },
  { domain: 'travellingman.com',           note: 'Travelling Man (UK)',                currency: 'GBP', country: 'GB' },
  { domain: 'midtowncomics.com',           note: 'Midtown Comics (US)',                currency: 'USD', country: 'US' },
  { domain: 'forbiddenplanet.com',         note: 'Forbidden Planet (UK)',              currency: 'GBP', country: 'GB' },
  { domain: 'speedyhen.com',               note: 'Speedy Hen (UK)',                    currency: 'GBP', country: 'GB' },
  { domain: 'gosh.london',                 note: 'Gosh! Comics (UK)',                  currency: 'GBP', country: 'GB' },
  { domain: 'comicshop.us',               note: 'Comic Shop (US)',                    currency: 'USD', country: 'US' },
  { domain: 'instocktrades.com',           note: 'In Stock Trades (US)',              currency: 'USD', country: 'US' },
  { domain: 'popinabox.us',               note: 'Pop In A Box (US)',                  currency: 'USD', country: 'US' },
  { domain: 'superherostuff.com',         note: 'Superhero Stuff (US)',               currency: 'USD', country: 'US' },
]

async function main() {
  console.log('\n' + '═'.repeat(70))
  console.log(' Comic Retailer Platform Probe')
  console.log('═'.repeat(70) + '\n')

  const hits: typeof CANDIDATES = []

  for (const c of CANDIDATES) {
    process.stdout.write(`  ${c.domain.padEnd(30)} `)
    try {
      const result = await detectPlatform(c.domain)
      if (result.platform) {
        console.log(`✓ ${result.platform.padEnd(12)} ${result.sample ?? ''}`)
        hits.push(c)
      } else {
        console.log('✗ not detected')
      }
    } catch (e) {
      console.log(`✗ error: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  console.log('\n' + '═'.repeat(70))
  if (hits.length === 0) {
    console.log(' No detectable platforms found.')
  } else {
    console.log(` ${hits.length} detectable retailer(s) — seed commands:`)
    for (const h of hits) {
      console.log(`\n  # ${h.note}`)
      console.log(`  npm run seed:retailer -- --domain ${h.domain} --currency ${h.currency} --country ${h.country}`)
    }
  }
  console.log('═'.repeat(70) + '\n')
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
