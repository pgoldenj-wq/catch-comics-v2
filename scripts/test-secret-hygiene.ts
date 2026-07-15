/**
 * test-secret-hygiene.ts — proves committed source contains no embedded
 * credentials and no server secret can reach a client bundle (Wave 4 Phase 1).
 *
 * Checks (all against git-TRACKED files only — .env.local is gitignored):
 *   1. No literal key inside an AWIN productdata URL (apikey/<value> must be
 *      an interpolation, never a literal).
 *   2. No assignment of a real-looking value to known secret env names.
 *   3. No AWIN_* / COMIC_VINE / EBAY_CLIENT / DATABASE_URL reference inside
 *      client-bundled code (app/**, components/**) except NEXT_PUBLIC_ vars.
 *   4. No long hex/base64 literals adjacent to KEY/SECRET/TOKEN identifiers.
 *   5. No Rainforest API key patterns anywhere (provider retired).
 *
 * Run: npm run test:secrets   (plain grep-style scan, no network, no DB)
 */

import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

let failures = 0
const fail = (msg: string, hits: string[]) => {
  failures++
  console.error(`✗ ${msg}`)
  hits.slice(0, 5).forEach(h => console.error(`    ${h}`))
}
const pass = (msg: string) => console.log(`✓ ${msg}`)

const SCAN_EXT = /\.(ts|tsx|js|mjs|cjs|json|md|html|yml|yaml|ps1|cmd|bat)$/
const tracked = execSync('git ls-files', { encoding: 'utf8' })
  .split('\n').filter(f => f && SCAN_EXT.test(f) && !f.startsWith('node_modules'))

interface Hit { file: string; line: number; text: string }
function scan(re: RegExp, files: string[], exclude?: (f: string) => boolean): Hit[] {
  const hits: Hit[] = []
  for (const f of files) {
    if (exclude?.(f)) continue
    let body: string
    try { body = readFileSync(f, 'utf8') } catch { continue }
    body.split('\n').forEach((ln, i) => {
      if (re.test(ln)) hits.push({ file: f, line: i + 1, text: ln.trim().slice(0, 90) })
    })
  }
  return hits
}
const show = (h: Hit) => `${h.file}:${h.line} — ${h.text}`

// ── 1. Literal keys inside AWIN datafeed URLs ────────────────────────────────
// A legitimate use interpolates: apikey/${apiKey}. A leak looks like a bare
// alphanumeric value of 10+ chars in the apikey path segment.
{
  const hits = scan(/apikey\/(?!\$\{)[A-Za-z0-9]{10,}/, tracked)
  hits.length ? fail('Literal key embedded in an AWIN datafeed URL', hits.map(show))
              : pass('No literal AWIN datafeed keys in tracked source')
}

// ── 2. Secret env names assigned real-looking values ────────────────────────
{
  const re = /(AWIN_DATAFEED_KEY|AWIN_API_KEY|COMIC_VINE_API_KEY|EBAY_CLIENT_SECRET|DATABASE_URL)\s*[=:]\s*['"]?[A-Za-z0-9+/_-]{12,}/
  const hits = scan(re, tracked)
  hits.length ? fail('Secret env var assigned a literal value in tracked source', hits.map(show))
              : pass('No secret env vars assigned literal values')
}

// ── 3. Server secrets referenced from client-bundled code ───────────────────
// Anything under app/ or components/ compiled for the client must only touch
// NEXT_PUBLIC_ vars. (Server components under app/ may legitimately read
// server env — restrict the check to files carrying the 'use client' pragma.)
{
  const clientFiles = tracked.filter(f =>
    (f.startsWith('app/') || f.startsWith('components/')) && /\.(ts|tsx)$/.test(f)
      && (() => { try { return /^\s*['"]use client['"]/.test(readFileSync(f, 'utf8')) } catch { return false } })())
  const re = /process\.env\.(?!NEXT_PUBLIC_)(AWIN_|COMIC_VINE|EBAY_CLIENT|DATABASE_URL|KV_REST)/
  const hits = scan(re, clientFiles)
  hits.length ? fail("Server secret referenced in a 'use client' file (would be undefined or leak intent)", hits.map(show))
              : pass(`No server secrets referenced in ${clientFiles.length} client components`)
}

// ── 4. Long opaque literals adjacent to KEY/SECRET/TOKEN identifiers ────────
{
  const re = /(key|secret|token)\s*[:=]\s*['"][A-Fa-f0-9]{24,}['"]/i
  const hits = scan(re, tracked, f => f === 'scripts/test-secret-hygiene.ts')
  hits.length ? fail('Long hex literal assigned to a key/secret/token identifier', hits.map(show))
              : pass('No opaque hex literals bound to key/secret/token names')
}

// ── 5. Rainforest is retired — no live key patterns or call paths ────────────
{
  const re = /RAINFOREST_API_KEY\s*[=:]\s*['"]?[A-Za-z0-9]{8,}/
  const hits = scan(re, tracked)
  hits.length ? fail('Rainforest key material present (provider is retired)', hits.map(show))
              : pass('No Rainforest key material in tracked source')
}

console.log(failures === 0
  ? '\nSECRET HYGIENE: PASS'
  : `\nSECRET HYGIENE: FAIL — ${failures} problem group(s) above`)
process.exit(failures === 0 ? 0 : 1)
