/**
 * amazonCreators.ts — Amazon Creators API client (server-only).
 *
 * Replaces PA-API 5.0, which Amazon retired in May 2026. NOT Rainforest — that
 * provider is permanently retired (CLAUDE.md rule 5); nothing here is a paid
 * proxy API.
 *
 * ── Transport contract ───────────────────────────────────────────────────────
 *   Auth   POST {lwaTokenHost}/auth/o2/token
 *          JSON body: grant_type=client_credentials, client_id, client_secret,
 *          scope=creatorsapi::default  →  { access_token, token_type, expires_in }
 *   API    POST https://creatorsapi.amazon/catalog/v1/getItems
 *          Headers: Authorization: Bearer <token>
 *                   Content-Type: application/json
 *                   x-marketplace: www.amazon.co.uk
 *          Body/response keys are lowerCamelCase (PA-API 5.0 used PascalCase).
 *
 * Credential version selects the Login-with-Amazon region:
 *   3.1 → US/CA/MX/BR    3.2 → UK/DE/FR/IT/ES    3.3 → JP/IN/AU
 * We try the version's region first and fall back to the other LwA hosts, so a
 * mis-set version surfaces as a clear diagnostic rather than a hard failure.
 *
 * ── Security ─────────────────────────────────────────────────────────────────
 *   • Credentials come only from lib/amazonCreatorsEnv.ts. Never inlined.
 *   • Access tokens live in module memory only — never logged, never persisted,
 *     never returned to a caller. describeTokenState() reports expiry only.
 *   • Every error message is scrubbed by redact() before it can reach a log.
 */

import { getAmazonCreatorsConfig, type AmazonCreatorsConfig } from './amazonCreatorsEnv'

// ── Constants ────────────────────────────────────────────────────────────────

const CREATORS_API_BASE = 'https://creatorsapi.amazon/catalog/v1'
const OAUTH_SCOPE = 'creatorsapi::default'

/** Refresh this long before real expiry so an in-flight request cannot age out. */
const TOKEN_SAFETY_BUFFER_MS = 60_000

/** Login-with-Amazon token hosts by region. */
const LWA_HOSTS = {
  na: 'https://api.amazon.com',
  eu: 'https://api.amazon.co.uk',
  fe: 'https://api.amazon.co.jp',
} as const

const MAX_RETRIES = 3
const BASE_BACKOFF_MS = 500
const REQUEST_TIMEOUT_MS = 15_000

/** getItems accepts at most 10 ids per call — Amazon-enforced. */
export const MAX_ITEM_IDS_PER_REQUEST = 10

// ── Errors ───────────────────────────────────────────────────────────────────

export class AmazonCreatorsAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AmazonCreatorsAuthError'
  }
}

export class AmazonCreatorsThrottleError extends Error {
  constructor(message: string, readonly retryAfterMs: number | null) {
    super(message)
    this.name = 'AmazonCreatorsThrottleError'
  }
}

export class AmazonCreatorsApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'AmazonCreatorsApiError'
  }
}

// ── Secret redaction ─────────────────────────────────────────────────────────

/**
 * Strip anything credential-shaped from a string before it can be logged.
 * Defence in depth: we never intentionally log secrets, but an upstream error
 * body could echo one back.
 */
export function redact(input: string): string {
  return input
    .replace(/amzn1\.oa2-cs\.v\d+\.[A-Za-z0-9._-]+/g, 'amzn1.oa2-cs.v*.[REDACTED]')
    .replace(/amzn1\.application-oa2-client\.[A-Za-z0-9._-]+/g, 'amzn1.application-oa2-client.[REDACTED]')
    .replace(/Atza\|[A-Za-z0-9._-]+/g, 'Atza|[REDACTED]')
    .replace(/("access_token"\s*:\s*")[^"]+/g, '$1[REDACTED]')
    .replace(/("client_secret"\s*:\s*")[^"]+/g, '$1[REDACTED]')
    .replace(/(Bearer\s+)[A-Za-z0-9._|-]{16,}/g, '$1[REDACTED]')
}

// ── Token cache ──────────────────────────────────────────────────────────────

interface CachedToken {
  accessToken: string
  /** Epoch ms at which this token must no longer be used. */
  expiresAt: number
  host: string
}

let tokenCache: CachedToken | null = null
/** De-duplicates concurrent refreshes so a burst issues one token request. */
let inFlightToken: Promise<CachedToken> | null = null

/** Order of LwA hosts to try, most likely first, based on credential version. */
function tokenHostsFor(version: string): string[] {
  const v = version.trim().replace(/^v/i, '')
  if (v.startsWith('3.1')) return [LWA_HOSTS.na, LWA_HOSTS.eu, LWA_HOSTS.fe]
  if (v.startsWith('3.2')) return [LWA_HOSTS.eu, LWA_HOSTS.na, LWA_HOSTS.fe]
  if (v.startsWith('3.3')) return [LWA_HOSTS.fe, LWA_HOSTS.na, LWA_HOSTS.eu]
  // 2.x (Cognito) or unknown — try all, most common first.
  return [LWA_HOSTS.na, LWA_HOSTS.eu, LWA_HOSTS.fe]
}

/** Env escape hatch: pin the token host if Amazon moves it. */
function overriddenTokenHost(): string | null {
  const raw = (process.env.AMAZON_CREATORS_TOKEN_ENDPOINT ?? '').trim()
  return raw ? raw.replace(/\/+$/, '') : null
}

function timeoutSignal(ms: number): AbortSignal {
  return AbortSignal.timeout(ms)
}

async function requestTokenFrom(host: string, cfg: AmazonCreatorsConfig): Promise<CachedToken> {
  const res = await fetch(`${host}/auth/o2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      scope: OAUTH_SCOPE,
    }),
    signal: timeoutSignal(REQUEST_TIMEOUT_MS),
  })

  const bodyText = await res.text()

  if (!res.ok) {
    throw new AmazonCreatorsAuthError(
      `token request to ${host} failed with HTTP ${res.status}: ${redact(bodyText).slice(0, 300)}`,
    )
  }

  let parsed: { access_token?: string; expires_in?: number; token_type?: string }
  try {
    parsed = JSON.parse(bodyText) as typeof parsed
  } catch {
    throw new AmazonCreatorsAuthError(`token response from ${host} was not valid JSON`)
  }

  if (!parsed.access_token) {
    throw new AmazonCreatorsAuthError(`token response from ${host} contained no access_token`)
  }

  const lifetimeMs = (parsed.expires_in ?? 3600) * 1000
  return {
    accessToken: parsed.access_token,
    expiresAt: Date.now() + lifetimeMs - TOKEN_SAFETY_BUFFER_MS,
    host,
  }
}

/**
 * Return a valid access token, reusing the cached one until it nears expiry.
 * The token itself is never logged or exposed outside this module's callers.
 */
async function getAccessToken(cfg: AmazonCreatorsConfig): Promise<CachedToken> {
  if (tokenCache && Date.now() < tokenCache.expiresAt) return tokenCache
  if (inFlightToken) return inFlightToken

  inFlightToken = (async () => {
    const override = overriddenTokenHost()
    const hosts = override ? [override] : tokenHostsFor(cfg.credentialVersion)
    const failures: string[] = []

    for (const host of hosts) {
      try {
        const token = await requestTokenFrom(host, cfg)
        tokenCache = token
        return token
      } catch (err) {
        failures.push(err instanceof Error ? err.message : String(err))
      }
    }

    throw new AmazonCreatorsAuthError(
      `Amazon Creators authentication failed on all ${hosts.length} endpoint(s). ` +
        redact(failures.join(' | ')),
    )
  })()

  try {
    return await inFlightToken
  } finally {
    inFlightToken = null
  }
}

/** Log-safe view of the token cache. Never includes the token. */
export function describeTokenState(): { cached: boolean; secondsRemaining: number; host: string | null } {
  if (!tokenCache) return { cached: false, secondsRemaining: 0, host: null }
  return {
    cached: true,
    secondsRemaining: Math.max(0, Math.round((tokenCache.expiresAt - Date.now()) / 1000)),
    host: tokenCache.host,
  }
}

/** Drop the cached token — used by tests and after a 401. */
export function clearTokenCache(): void {
  tokenCache = null
}

/**
 * Obtain (or reuse) an access token and report the outcome in log-safe form.
 * Returns metadata only — the token never leaves this module.
 */
export async function authenticate(): Promise<{
  ok: true
  tokenHost: string
  expiresInSeconds: number
  tokenLength: number
  reusedFromCache: boolean
}> {
  const cfg = getAmazonCreatorsConfig()
  const wasCached = tokenCache !== null && Date.now() < tokenCache.expiresAt
  const token = await getAccessToken(cfg)
  return {
    ok: true,
    tokenHost: token.host,
    expiresInSeconds: Math.max(0, Math.round((token.expiresAt - Date.now()) / 1000)),
    tokenLength: token.accessToken.length,
    reusedFromCache: wasCached,
  }
}

// ── Core request with retry / throttle handling ──────────────────────────────

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null
  const seconds = Number(header)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const date = Date.parse(header)
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null
}

async function creatorsRequest<T>(operation: string, body: unknown): Promise<T> {
  const cfg = getAmazonCreatorsConfig()
  let lastError: Error | null = null

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const token = await getAccessToken(cfg)

    let res: Response
    try {
      res = await fetch(`${CREATORS_API_BASE}/${operation}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token.accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'x-marketplace': cfg.marketplace,
        },
        body: JSON.stringify(body),
        signal: timeoutSignal(REQUEST_TIMEOUT_MS),
      })
    } catch (err) {
      // Network error / timeout — retry with backoff.
      lastError = new AmazonCreatorsApiError(
        `network error calling ${operation}: ${redact(err instanceof Error ? err.message : String(err))}`,
        0,
      )
      if (attempt < MAX_RETRIES) {
        await sleep(BASE_BACKOFF_MS * 2 ** attempt + Math.random() * 250)
        continue
      }
      throw lastError
    }

    // Expired or revoked token — clear the cache and retry once with a fresh one.
    if (res.status === 401 || res.status === 403) {
      clearTokenCache()
      const text = redact(await res.text()).slice(0, 300)
      lastError = new AmazonCreatorsAuthError(`${operation} rejected with HTTP ${res.status}: ${text}`)
      if (attempt < MAX_RETRIES) continue
      throw lastError
    }

    // Throttled — honour Retry-After when present.
    if (res.status === 429) {
      const retryAfterMs = parseRetryAfter(res.headers.get('retry-after'))
      lastError = new AmazonCreatorsThrottleError(`${operation} throttled (HTTP 429)`, retryAfterMs)
      if (attempt < MAX_RETRIES) {
        await sleep(retryAfterMs ?? BASE_BACKOFF_MS * 2 ** attempt + Math.random() * 250)
        continue
      }
      throw lastError
    }

    if (res.status >= 500) {
      lastError = new AmazonCreatorsApiError(`${operation} upstream error HTTP ${res.status}`, res.status)
      if (attempt < MAX_RETRIES) {
        await sleep(BASE_BACKOFF_MS * 2 ** attempt + Math.random() * 250)
        continue
      }
      throw lastError
    }

    const text = await res.text()

    if (!res.ok) {
      throw new AmazonCreatorsApiError(
        `${operation} failed with HTTP ${res.status}: ${redact(text).slice(0, 300)}`,
        res.status,
      )
    }

    try {
      return JSON.parse(text) as T
    } catch {
      throw new AmazonCreatorsApiError(`${operation} returned malformed JSON`, res.status)
    }
  }

  throw lastError ?? new AmazonCreatorsApiError(`${operation} failed after ${MAX_RETRIES} retries`, 0)
}

// ── getItems ─────────────────────────────────────────────────────────────────

/** Minimal resource set — title + identifiers + price + availability + image. */
export const DEFAULT_ITEM_RESOURCES = [
  'itemInfo.title',
  'itemInfo.externalIds',
  'images.primary.large',
  'offersV2.listings.price',
  'offersV2.listings.availability',
  'offersV2.listings.condition',
] as const

/** Smallest resource set that still proves a live product lookup. */
export const SMOKE_ITEM_RESOURCES = ['itemInfo.title'] as const

interface RawItem {
  asin?: string
  detailPageURL?: string
  detailPageUrl?: string
  itemInfo?: {
    title?: { displayValue?: string }
    externalIds?: {
      eans?: { displayValues?: string[] }
      isbns?: { displayValues?: string[] }
      upcs?: { displayValues?: string[] }
    }
  }
  images?: { primary?: { large?: { url?: string } } }
  offersV2?: {
    listings?: Array<{
      price?: { money?: { amount?: number; currency?: string; displayAmount?: string }; displayAmount?: string; amount?: number; currency?: string }
      availability?: { type?: string; message?: string }
      condition?: { value?: string }
    }>
  }
}

interface RawGetItemsResponse {
  errors?: Array<{ code?: string; message?: string }>
  itemResults?: { items?: RawItem[] }
  /** Some responses nest differently; tolerated for resilience. */
  items?: RawItem[]
}

/** Normalised, log-safe product record. Contains no credential material. */
export interface AmazonCreatorsItem {
  asin: string
  title: string | null
  detailPageUrl: string | null
  imageUrl: string | null
  /** Fixed-precision string, e.g. "12.99". Null when Amazon returned no offer. */
  priceAmount: string | null
  priceCurrency: string | null
  availability: string | null
  condition: string | null
  isbn13: string | null
  ean: string | null
}

/** Per-ASIN errors Amazon reports without failing the whole request. */
export interface AmazonCreatorsItemError {
  code: string
  message: string
}

export interface GetItemsResult {
  items: AmazonCreatorsItem[]
  errors: AmazonCreatorsItemError[]
  marketplace: string
  /** ASINs requested but absent from the response — unavailable or invalid. */
  missingAsins: string[]
}

function firstString(values: string[] | undefined): string | null {
  return values && values.length > 0 ? values[0] : null
}

function normaliseItem(raw: RawItem): AmazonCreatorsItem | null {
  if (!raw.asin) return null

  const listing = raw.offersV2?.listings?.[0]
  const money = listing?.price?.money
  const amountNumber = money?.amount ?? listing?.price?.amount
  const currency = money?.currency ?? listing?.price?.currency ?? null

  const isbnRaw = firstString(raw.itemInfo?.externalIds?.isbns?.displayValues)
  const eanRaw = firstString(raw.itemInfo?.externalIds?.eans?.displayValues)
  const isbnDigits = isbnRaw ? isbnRaw.replace(/\D/g, '') : null
  const eanDigits = eanRaw ? eanRaw.replace(/\D/g, '') : null

  return {
    asin: raw.asin,
    title: raw.itemInfo?.title?.displayValue ?? null,
    detailPageUrl: raw.detailPageURL ?? raw.detailPageUrl ?? null,
    imageUrl: raw.images?.primary?.large?.url ?? null,
    priceAmount: typeof amountNumber === 'number' ? amountNumber.toFixed(2) : null,
    priceCurrency: currency,
    availability: listing?.availability?.type ?? listing?.availability?.message ?? null,
    condition: listing?.condition?.value ?? null,
    isbn13: isbnDigits && isbnDigits.length === 13 ? isbnDigits : null,
    ean: eanDigits && eanDigits.length === 13 && !eanDigits.startsWith('97') ? eanDigits : null,
  }
}

/**
 * Look up up to 10 ASINs on the configured marketplace.
 *
 * Products that are unavailable, invalid, or region-restricted come back in
 * `errors` / `missingAsins` rather than throwing — a partial result is normal
 * and callers should treat a missing ASIN as "no offer", never as a failure.
 */
export async function getItems(
  asins: string[],
  opts: { resources?: readonly string[] } = {},
): Promise<GetItemsResult> {
  const cfg = getAmazonCreatorsConfig()
  const ids = [...new Set(asins.map(a => a.trim().toUpperCase()).filter(Boolean))]

  if (ids.length === 0) throw new Error('getItems requires at least one ASIN')
  if (ids.length > MAX_ITEM_IDS_PER_REQUEST) {
    throw new Error(`getItems accepts at most ${MAX_ITEM_IDS_PER_REQUEST} ASINs per call (got ${ids.length})`)
  }

  const raw = await creatorsRequest<RawGetItemsResponse>('getItems', {
    itemIds: ids,
    itemIdType: 'ASIN',
    resources: opts.resources ?? DEFAULT_ITEM_RESOURCES,
    partnerTag: cfg.associateTag,
    partnerType: 'Associates',
    marketplace: cfg.marketplace,
  })

  const rawItems = raw.itemResults?.items ?? raw.items ?? []
  const items = rawItems.map(normaliseItem).filter((i): i is AmazonCreatorsItem => i !== null)
  const returned = new Set(items.map(i => i.asin))

  return {
    items,
    errors: (raw.errors ?? []).map(e => ({
      code: e.code ?? 'Unknown',
      message: redact(e.message ?? 'no message'),
    })),
    marketplace: cfg.marketplace,
    missingAsins: ids.filter(id => !returned.has(id)),
  }
}
