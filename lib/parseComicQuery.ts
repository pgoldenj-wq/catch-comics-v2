/**
 * parseComicQuery — extract structured intent from a free-text comic query.
 *
 * Examples:
 *   "Batman #1"                  → { cleanTitle:"Batman",          issue:"1",  vol:"" }
 *   "Absolute Batman #019"       → { cleanTitle:"Absolute Batman",  issue:"19", vol:"" }
 *   "Batman issue 5"             → { cleanTitle:"Batman",          issue:"5",  vol:"" }
 *   "Absolute Batman 19 Cover A" → { cleanTitle:"Absolute Batman",  issue:"19", vol:"" }
 *   "One Piece Vol 1"            → { cleanTitle:"One Piece",        issue:"",   vol:"1" }
 *   "One Piece Volume 3"         → { cleanTitle:"One Piece",        issue:"",   vol:"3" }
 *   "Batman Year One"            → { cleanTitle:"Batman Year One",  issue:"",   vol:"" }
 *   "Watchmen"                   → { cleanTitle:"Watchmen",         issue:"",   vol:"" }
 *   "300"                        → { cleanTitle:"300",              issue:"",   vol:"" }
 */

export interface ParsedQuery {
  /** Series/volume title with issue/volume artifacts stripped */
  cleanTitle: string
  /** Normalised issue number ("19" not "019"). Empty when absent. */
  issueNumber: string
  /** Normalised volume number ("1" from "Vol 1"). Empty when absent. */
  volumeNumber: string
  /** True when the query explicitly targets a specific issue */
  hasIssueIntent: boolean
  /** True when the query explicitly requests a volume number */
  hasVolumeIntent: boolean
  /** Original unmodified query */
  raw: string
}

export function parseComicQuery(query: string): ParsedQuery {
  let q = query.trim()

  // ── Pre-clean: strip collector suffixes that don't affect identity ─────────
  q = q
    .replace(/\bcover\s+[a-z]\b/gi, '')                      // "Cover A"
    .replace(/\b\d+(?:st|nd|rd|th)\s+print(?:ing)?\b/gi, '') // "2nd Printing"
    .replace(/\bvariant\b/gi, '')                             // "Variant"
    .replace(/\s{2,}/g, ' ')
    .trim()

  // ── Pattern 1: explicit # — "Batman #1", "Absolute Batman #019" ───────────
  const hashMatch = q.match(/#0*(\d+)/)
  if (hashMatch) {
    const issueNumber = String(parseInt(hashMatch[1], 10))
    const cleanTitle  = q.slice(0, hashMatch.index).trim()
    return { cleanTitle, issueNumber, volumeNumber: '', hasIssueIntent: true, hasVolumeIntent: false, raw: query }
  }

  // ── Pattern 2: "issue" keyword — "Batman issue 5", "Batman Issue #5" ──────
  const issueKwMatch = q.match(/\bissue\s+#?0*(\d+)\b/i)
  if (issueKwMatch) {
    const issueNumber = String(parseInt(issueKwMatch[1], 10))
    const cleanTitle  = q.replace(issueKwMatch[0], '').trim()
    return { cleanTitle, issueNumber, volumeNumber: '', hasIssueIntent: true, hasVolumeIntent: false, raw: query }
  }

  // ── Pattern 3: "Vol N" / "Volume N" — "One Piece Vol 1" ──────────────────
  // Must be checked BEFORE trailing-number so "One Piece Vol 1" is volume intent,
  // not issue intent.
  const volMatch = q.match(/\bvol(?:ume)?\.?\s*0*(\d+)\b/i)
  if (volMatch) {
    const volumeNumber = String(parseInt(volMatch[1], 10))
    const cleanTitle   = q.replace(volMatch[0], '').trim()
    return { cleanTitle, issueNumber: '', volumeNumber, hasIssueIntent: false, hasVolumeIntent: true, raw: query }
  }

  // ── Pattern 4: trailing bare number — "Batman 1", "Absolute Batman 19" ────
  // Require the title part to contain at least one alpha char so that
  // standalone numeric titles like "300" or "1984" are NOT mis-parsed.
  const trailingNumMatch = q.match(/^(.+?)\s+0*(\d{1,4})$/)
  if (trailingNumMatch) {
    const titlePart = trailingNumMatch[1].trim()
    if (/[a-z]/i.test(titlePart)) {
      const issueNumber = String(parseInt(trailingNumMatch[2], 10))
      return { cleanTitle: titlePart, issueNumber, volumeNumber: '', hasIssueIntent: true, hasVolumeIntent: false, raw: query }
    }
  }

  return { cleanTitle: q, issueNumber: '', volumeNumber: '', hasIssueIntent: false, hasVolumeIntent: false, raw: query }
}

// ── Title similarity: 0–40 ────────────────────────────────────────────────────
export function titleMatchScore(resultTitle: string, cleanTitle: string): number {
  const r = resultTitle.toLowerCase().trim()
  const q = cleanTitle.toLowerCase().trim()
  if (!r || !q) return 0
  if (r === q) return 40
  if (r.startsWith(q) || q.startsWith(r)) return 25
  if (r.includes(q) || q.includes(r)) return 15
  const words   = q.split(/\s+/).filter(w => w.length > 2)
  if (!words.length) return 0
  const matched = words.filter(w => r.includes(w)).length
  return Math.round((matched / words.length) * 10)
}

/**
 * Score a raw Comic Vine issue result against the parsed query.
 * Higher = better. Kept for external use.
 */
export function scoreIssueResult(
  r: { issue_number?: string; volume?: { name?: string } },
  parsed: ParsedQuery
): number {
  let score = parsed.hasIssueIntent ? 60 : 10
  if (parsed.hasIssueIntent && parsed.issueNumber) {
    const resultNum = String(parseInt(r.issue_number || '0', 10))
    if (resultNum === parsed.issueNumber) score += 60
  }
  score += titleMatchScore(r.volume?.name || '', parsed.cleanTitle)
  return score
}
