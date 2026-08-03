/**
 * amazon-creators-test.ts — bounded live proof of the Amazon Creators API.
 *
 * Six checks, one real API call:
 *   1. Environment variables validate.
 *   2. OAuth authentication succeeds.
 *   3. One real Amazon UK comic is fetched (smallest valid getItems request).
 *   4. The response carries usable product data.
 *   5. The resulting Amazon URL carries the catchcomics-21 affiliate tag.
 *   6. No credential material appears anywhere in this script's own output.
 *
 * Safety:
 *   • READ-ONLY. One SELECT to choose a real ASIN from the catalogue. No
 *     listing is created, updated or deleted. No import, no backfill.
 *   • Never prints tokens, credential ids, or secrets. Check 6 scans this
 *     script's captured output for credential material and fails if any leaks.
 *
 * Run:  npm run amazon:creators:test
 *       npm run amazon:creators:test -- --asin 1607062011
 */

import { PrismaClient } from '@prisma/client'
import {
  authenticate,
  getItems,
  describeTokenState,
  SMOKE_ITEM_RESOURCES,
  DEFAULT_ITEM_RESOURCES,
  AmazonCreatorsAuthError,
  AmazonCreatorsThrottleError,
  AmazonCreatorsApiError,
} from '../lib/amazonCreators'
import {
  describeAmazonCreatorsEnv,
  isAmazonCreatorsConfigured,
  getAmazonCreatorsConfig,
} from '../lib/amazonCreatorsEnv'
import { toBaseListing, isbn13FromAsin, isbn10FromIsbn13 } from '../lib/adapters/amazon-creators'

// ── Output capture (for check 6) ─────────────────────────────────────────────

const captured: string[] = []
const say = (line = '') => {
  captured.push(line)
  console.log(line)
}

let failures = 0
/** Set when Amazon refuses product data because the Associates account is not yet eligible. */
let eligibilityBlocked = false
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failures++
  say(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`)
}

// ── ASIN selection ───────────────────────────────────────────────────────────

const argAsin = (() => {
  const i = process.argv.indexOf('--asin')
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1].trim().toUpperCase() : null
})()

/**
 * Curated real UK comic — Saga Volume 1 (ISBN-10 1607062011 = its ASIN).
 * Used by default so the proof is deterministic. The catalogue picker is opt-in
 * via --from-catalogue because canonical_products still carries academic
 * pollution that no available filter (format ENUM, comicvineId, publisher, or
 * even a live priced listing) reliably excludes.
 */
const CURATED_COMIC = { asin: '1607062011', title: 'Saga Volume 1 (curated)' }

const prisma = new PrismaClient()

/**
 * Pick one real comic from our own catalogue. For books an ASIN is the ISBN-10,
 * so this proves the API against data Catch Comics actually sells rather than a
 * synthetic fixture.
 *
 * isbn_10 is null for every comic row, so the ASIN is derived from isbn_13
 * (978-prefixed only) — the same derivation a future import will rely on.
 */
async function pickCatalogueAsin(): Promise<{ asin: string; source: string; title: string } | null> {
  // Neither the format ENUM nor comicvineId is trustworthy evidence that a row
  // is a real comic — both still admit academic-catalogue pollution and
  // cv_match_suspect rows. A live, priced retailer listing is the strongest
  // available signal, and is also exactly the cohort a future import targets.
  const rows = await prisma.canonicalProduct.findMany({
    where: {
      deletedAt: null,
      isbn13: { startsWith: '978' },
      format: { in: ['TPB', 'HARDCOVER', 'OMNIBUS', 'MANGA_VOLUME', 'ABSOLUTE', 'DELUXE'] },
      listings: { some: { deletedAt: null, priceAmount: { gt: 0 } } },
    },
    select: { isbn13: true, isbn10: true, title: true },
    orderBy: { updatedAt: 'desc' },
    take: 25,
  })

  for (const row of rows) {
    const asin = row.isbn10?.toUpperCase() ?? isbn10FromIsbn13(row.isbn13)
    if (asin) {
      return {
        asin,
        source: row.isbn10 ? 'catalogue (isbn_10)' : 'catalogue (isbn_13 → isbn_10 derived)',
        title: row.title,
      }
    }
  }
  return null
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  say('\n═══ AMAZON CREATORS API — BOUNDED LIVE PROOF ═══')
  say('Read-only. No listings created, updated or deleted.\n')

  // ── 1. Environment ────────────────────────────────────────────────────────
  say('1. ENVIRONMENT')
  for (const r of describeAmazonCreatorsEnv()) {
    say(`     ${r.present ? '✓' : r.required ? '✗' : '·'} ${r.name.padEnd(36)} ${r.detail}`)
  }
  check('all required credentials present', isAmazonCreatorsConfigured())
  if (!isAmazonCreatorsConfigured()) {
    say('\nAborting — credentials missing. Run: npm run amazon:creators:check')
    return
  }

  const cfg = getAmazonCreatorsConfig()
  check('marketplace is a bare host (no scheme/slash)', /^[a-z0-9.-]+$/i.test(cfg.marketplace), cfg.marketplace)
  check('associate tag is the UK tag', cfg.associateTag === 'catchcomics-21', cfg.associateTag)

  // ── 2. Authentication ─────────────────────────────────────────────────────
  say('\n2. AUTHENTICATION (OAuth 2.0 client_credentials)')
  let authOk = false
  try {
    const auth = await authenticate()
    authOk = true
    check('token acquired', true, `host=${auth.tokenHost} expires_in≈${auth.expiresInSeconds}s len=${auth.tokenLength} (value withheld)`)

    // Prove the cache: a second call must not hit the network.
    const again = await authenticate()
    check('token cached for its lifetime', again.reusedFromCache, `cache=${describeTokenState().secondsRemaining}s remaining`)
  } catch (err) {
    const kind = err instanceof AmazonCreatorsAuthError ? 'auth' : 'unexpected'
    check('token acquired', false, `${kind}: ${err instanceof Error ? err.message : String(err)}`)
  }

  if (!authOk) {
    say('\nAborting — authentication failed. The product call cannot be attempted.')
    return
  }

  // ── 3. Fetch one real comic ───────────────────────────────────────────────
  say('\n3. PRODUCT FETCH (getItems — 1 ASIN, smallest valid request)')

  let picked: { asin: string; source: string; title: string } | null = null
  if (argAsin) {
    picked = { asin: argAsin, source: 'CLI --asin', title: '(supplied)' }
  } else if (process.argv.includes('--from-catalogue')) {
    picked = await pickCatalogueAsin()
  }
  if (!picked) picked = { ...CURATED_COMIC, source: 'curated comic (default)' }

  say(`     ASIN ${picked.asin} — from ${picked.source}`)
  say(`     catalogue title: ${picked.title}`)
  say(`     resources: ${SMOKE_ITEM_RESOURCES.join(', ')} (minimal)`)

  let smokeOk = false
  try {
    const smoke = await getItems([picked.asin], { resources: SMOKE_ITEM_RESOURCES })
    smokeOk = smoke.items.length > 0
    check('minimal getItems returned an item', smokeOk,
      smokeOk ? `asin=${smoke.items[0].asin}` : `missing=${smoke.missingAsins.join(',')} errors=${smoke.errors.map(e => e.code).join(',') || 'none'}`)
    for (const e of smoke.errors) say(`     API error: ${e.code} — ${e.message}`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)

    // Amazon gates product data behind Associates eligibility (~10 qualifying
    // sales in the trailing 30 days). That is an ACCOUNT state, not a defect —
    // report it distinctly so a green build is never confused with a broken one.
    if (/AssociateNotEligible|eligibility requirements/i.test(message)) {
      eligibilityBlocked = true
      say('  ⏳ getItems refused — AssociateNotEligible')
      say('     Amazon: "Your account does not currently meet the eligibility requirements."')
      say('     This is the documented Associates eligibility gate (≈10 qualifying')
      say('     sales in the trailing 30 days), not an integration fault. Credentials,')
      say('     OAuth and transport are all proven working by step 2 above.')
    } else {
      const kind =
        err instanceof AmazonCreatorsThrottleError ? 'throttled'
        : err instanceof AmazonCreatorsAuthError ? 'auth'
        : err instanceof AmazonCreatorsApiError ? `api(${err.status})`
        : 'unexpected'
      check('minimal getItems returned an item', false, `${kind}: ${message}`)
    }
  }

  // ── 4. Usable product data ────────────────────────────────────────────────
  say('\n4. PRODUCT DATA (full resource set)')
  let listingUrl: string | null = null

  if (smokeOk) {
    try {
      const full = await getItems([picked.asin], { resources: DEFAULT_ITEM_RESOURCES })
      const item = full.items[0]
      if (!item) {
        check('product data usable', false, 'no item on full-resource call')
      } else {
        say(`     title       : ${item.title ?? '(none)'}`)
        say(`     asin        : ${item.asin}`)
        say(`     marketplace : ${full.marketplace}`)
        say(`     price       : ${item.priceAmount ? `${item.priceAmount} ${item.priceCurrency ?? ''}`.trim() : '(no live offer)'}`)
        say(`     availability: ${item.availability ?? '(none)'}`)
        say(`     condition   : ${item.condition ?? '(none)'}`)
        say(`     isbn13      : ${item.isbn13 ?? isbn13FromAsin(item.asin) ?? '(none)'}`)
        say(`     image       : ${item.imageUrl ? 'present' : '(none)'}`)

        check('has a title', Boolean(item.title))
        check('has the requested ASIN', item.asin.toUpperCase() === picked.asin.toUpperCase())
        check('maps to an ISBN-13', Boolean(item.isbn13 ?? isbn13FromAsin(item.asin)))

        // ── 5. Affiliate tag ────────────────────────────────────────────────
        const listing = toBaseListing(item, { marketplace: cfg.marketplace, associateTag: cfg.associateTag })
        listingUrl = listing.retailerUrl
        say('\n5. AFFILIATE TAG')
        say(`     url: ${listing.retailerUrl}`)
        const parsed = new URL(listing.retailerUrl)
        check('URL carries tag=catchcomics-21', parsed.searchParams.get('tag') === 'catchcomics-21')
        check('URL points at the configured marketplace', parsed.hostname.endsWith(cfg.marketplace.replace(/^www\./, '')))
        check('listing normalises into the shared RetailerListing shape',
          typeof listing.retailerSku === 'string' && typeof listing.priceAmount === 'string')
      }
    } catch (err) {
      check('product data usable', false, err instanceof Error ? err.message : String(err))
    }
  } else {
    say('     skipped — minimal fetch did not succeed')
    say('\n5. AFFILIATE TAG')
    // Tag wrapping is pure, so prove it regardless of API availability.
    const url = new URL(
      toBaseListing(
        { asin: picked.asin, title: 'offline check', detailPageUrl: null, imageUrl: null, priceAmount: null, priceCurrency: null, availability: null, condition: null, isbn13: null, ean: null },
        { marketplace: cfg.marketplace, associateTag: cfg.associateTag },
      ).retailerUrl,
    )
    listingUrl = url.toString()
    say(`     url: ${url.toString()} (constructed offline)`)
    check('URL carries tag=catchcomics-21', url.searchParams.get('tag') === 'catchcomics-21')
  }

  // ── 6. No credential leakage ──────────────────────────────────────────────
  say('\n6. CREDENTIAL HYGIENE')
  const blob = captured.join('\n') + (listingUrl ?? '')
  const needles: Array<[string, string | undefined]> = [
    ['AMAZON_CREATORS_CLIENT_ID', process.env.AMAZON_CREATORS_CLIENT_ID],
    ['AMAZON_CREATORS_CLIENT_SECRET', process.env.AMAZON_CREATORS_CLIENT_SECRET],
  ]
  for (const [name, value] of needles) {
    const leaked = Boolean(value && value.length > 8 && blob.includes(value))
    check(`${name} absent from output`, !leaked)
  }
  check('no bearer token in output', !/Atza\|/.test(blob))
  check('no credential-secret pattern in output', !/amzn1\.oa2-cs\./.test(blob))
  check('no client-id pattern in output', !/amzn1\.application-oa2-client\./.test(blob))

  say('')
  if (failures > 0) {
    say(`AMAZON CREATORS: FAIL — ${failures} check(s) above`)
  } else if (eligibilityBlocked) {
    say('AMAZON CREATORS: BLOCKED (Amazon-side eligibility)')
    say('  Integration verified as far as Amazon permits:')
    say('    ✓ credentials valid   ✓ OAuth succeeds   ✓ token cached   ✓ affiliate tag correct')
    say('    ⏳ product data withheld until the Associates account qualifies')
    say('  No code change will lift this. Re-run this command after qualifying sales land.')
  } else {
    say('AMAZON CREATORS: PASS')
  }
}

main()
  .catch(err => {
    failures++
    console.error(`\nFATAL: ${err instanceof Error ? err.message : String(err)}`)
  })
  .finally(async () => {
    await prisma.$disconnect()
    // Exit 2 = blocked upstream (not a build failure); 1 = genuine failure.
    process.exit(failures > 0 ? 1 : eligibilityBlocked ? 2 : 0)
  })
