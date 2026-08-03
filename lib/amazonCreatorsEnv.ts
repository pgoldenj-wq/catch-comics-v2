/**
 * amazonCreatorsEnv.ts — server-only accessor + validation for the Amazon
 * Creators API credentials.
 *
 * Scope: environment only. No network calls, no import, no backfill — the
 * Creators integration itself is deliberately not built yet. This module exists
 * so that when it is, there is exactly one validated place to read from.
 *
 * Security contract:
 *   • CLIENT_ID / CLIENT_SECRET / CREDENTIAL_VERSION are SECRETS. No
 *     NEXT_PUBLIC_ prefix, and this module must never be imported from a
 *     'use client' component. scripts/test-secret-hygiene.ts enforces both.
 *   • Nothing here returns, throws, or logs a raw credential value. Error
 *     messages name the missing VARIABLE, never its contents.
 *     describeAmazonCreatorsEnv() reports presence and length only.
 *
 * The associate tag is NOT a secret (it appears in every affiliate URL), so it
 * falls back to the existing public var rather than being entered twice — same
 * pattern as BOOKSHOP_UK_API_KEY ?? BOOKSHOP_API_KEY in adapters/bookshop.ts.
 */

export interface AmazonCreatorsConfig {
  clientId: string
  clientSecret: string
  credentialVersion: string
  /** Marketplace host, e.g. 'www.amazon.co.uk' — no scheme, no trailing slash. */
  marketplace: string
  /** UK associate tag, e.g. 'catchcomics-21'. Public by design. */
  associateTag: string
}

const DEFAULT_MARKETPLACE = 'www.amazon.co.uk'

/** The three vars that must be present for the Creators API to be usable. */
const REQUIRED_VARS = [
  'AMAZON_CREATORS_CLIENT_ID',
  'AMAZON_CREATORS_CLIENT_SECRET',
  'AMAZON_CREATORS_CREDENTIAL_VERSION',
] as const

/**
 * Trim surrounding whitespace and any quote pair a copy-paste may have carried
 * in from the CSV. A credential is never legitimately quoted in a .env file.
 */
function clean(raw: string | undefined): string {
  const v = (raw ?? '').trim()
  if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) {
    return v.slice(1, -1).trim()
  }
  return v
}

/** Strip scheme and trailing slash so 'https://www.amazon.co.uk/' → 'www.amazon.co.uk'. */
function normaliseMarketplace(raw: string | undefined): string {
  const v = clean(raw).replace(/^https?:\/\//i, '').replace(/\/+$/, '')
  return v || DEFAULT_MARKETPLACE
}

function associateTag(): string {
  return clean(process.env.AMAZON_UK_ASSOCIATE_TAG) || clean(process.env.NEXT_PUBLIC_AMAZON_UK_ASSOCIATE_TAG)
}

/** Hard stop if this module is ever pulled into a client bundle. */
function assertServer(caller: string): void {
  if (typeof window !== 'undefined') {
    throw new Error(
      `${caller}() is server-only — Amazon Creators credentials must never reach the client bundle.`,
    )
  }
}

/**
 * Names of the required vars that are missing or blank. Empty array = ready.
 * Returns NAMES only — never values.
 */
export function missingAmazonCreatorsVars(): string[] {
  assertServer('missingAmazonCreatorsVars')
  return REQUIRED_VARS.filter(name => clean(process.env[name]).length === 0)
}

/** True when all three credential vars are present and non-blank. */
export function isAmazonCreatorsConfigured(): boolean {
  return missingAmazonCreatorsVars().length === 0
}

/**
 * Full config, or a throw naming the missing variables. Call this at the top of
 * any future Creators code path — it fails loudly at the boundary rather than
 * sending an unauthenticated request.
 */
export function getAmazonCreatorsConfig(): AmazonCreatorsConfig {
  assertServer('getAmazonCreatorsConfig')

  const missing = missingAmazonCreatorsVars()
  if (missing.length > 0) {
    throw new Error(
      `Amazon Creators API is not configured — missing ${missing.join(', ')}. ` +
        'Set these in .env.local (local) and Vercel → Settings → Environment Variables (deployed). ' +
        'See .env.example for which CSV column maps to which variable.',
    )
  }

  const tag = associateTag()
  if (!tag) {
    throw new Error(
      'Amazon Creators API is configured but no associate tag is set — ' +
        'set AMAZON_UK_ASSOCIATE_TAG (or NEXT_PUBLIC_AMAZON_UK_ASSOCIATE_TAG).',
    )
  }

  return {
    clientId: clean(process.env.AMAZON_CREATORS_CLIENT_ID),
    clientSecret: clean(process.env.AMAZON_CREATORS_CLIENT_SECRET),
    credentialVersion: clean(process.env.AMAZON_CREATORS_CREDENTIAL_VERSION),
    marketplace: normaliseMarketplace(process.env.AMAZON_CREATORS_MARKETPLACE),
    associateTag: tag,
  }
}

export interface EnvVarStatus {
  name: string
  present: boolean
  required: boolean
  /** Safe to log — presence, length, or a non-secret value. Never a secret. */
  detail: string
}

/**
 * Log-safe description of the Amazon Creators environment. Secret vars report
 * only a character count; non-secret vars (marketplace, associate tag) report
 * their actual value because both appear in public URLs anyway.
 */
export function describeAmazonCreatorsEnv(): EnvVarStatus[] {
  assertServer('describeAmazonCreatorsEnv')

  const secretStatus = (name: string): EnvVarStatus => {
    const len = clean(process.env[name]).length
    return {
      name,
      present: len > 0,
      required: true,
      detail: len > 0 ? `set (${len} chars, value withheld)` : 'MISSING',
    }
  }

  const tag = associateTag()
  const tagSource = clean(process.env.AMAZON_UK_ASSOCIATE_TAG)
    ? 'AMAZON_UK_ASSOCIATE_TAG'
    : 'NEXT_PUBLIC_AMAZON_UK_ASSOCIATE_TAG (fallback)'

  return [
    ...REQUIRED_VARS.map(secretStatus),
    {
      name: 'AMAZON_CREATORS_MARKETPLACE',
      present: clean(process.env.AMAZON_CREATORS_MARKETPLACE).length > 0,
      required: false,
      detail: `${normaliseMarketplace(process.env.AMAZON_CREATORS_MARKETPLACE)}${
        clean(process.env.AMAZON_CREATORS_MARKETPLACE) ? '' : ` (default)`
      }`,
    },
    {
      name: 'AMAZON_UK_ASSOCIATE_TAG',
      present: tag.length > 0,
      required: false,
      detail: tag ? `${tag} — via ${tagSource}` : 'MISSING (no associate tag from either var)',
    },
  ]
}
