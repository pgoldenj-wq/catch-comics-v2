/**
 * parseComicQuery — extract a clean title and issue number from a free-text query.
 *
 * Handles:
 *   "Batman #1"                → { cleanTitle: "Batman",           issueNumber: "1"  }
 *   "Absolute Batman #019"     → { cleanTitle: "Absolute Batman",  issueNumber: "19" }
 *   "Batman issue 1"           → { cleanTitle: "Batman",           issueNumber: "1"  }
 *   "Batman Issue #5"          → { cleanTitle: "Batman",           issueNumber: "5"  }
 *   "Absolute Batman 19 Cover A" → { cleanTitle: "Absolute Batman", issueNumber: "19" }
 *   "Batman 1"                 → { cleanTitle: "Batman",           issueNumber: "1"  }
 *   "Watchmen"                 → { cleanTitle: "Watchmen",         issueNumber: ""   }
 *   "Batman Year One"          → { cleanTitle: "Batman Year One",  issueNumber: ""   }
 *   "300"                      → { cleanTitle: "300",              issueNumber: ""   }
 */

export interface ParsedQuery {
  /** Series/volume title with issue artifacts stripped */
  cleanTitle: string
  /** Normalised issue number string ("19" not "019"). Empty string when absent. */
  issueNumber: string
  /** True when the query clearly targets a specific issue */
  hasIssueIntent: boolean
  /** Original unmodified query */
  raw: string
}

export function parseComicQuery(query: string): ParsedQuery {
  let q = query.trim()

  // ── Pre-clean: strip common collector suffixes that don't affect identity ──
  q = q
    .replace(/\bcover\s+[a-z]\b/gi, '')           // "Cover A", "Cover B"
    .replace(/\b\d+(?:st|nd|rd|th)\s+print(?:ing)?\b/gi, '') // "2nd Printing"
    .replace(/\bvariant\b/gi, '')                  // "Variant"
    .replace(/\s{2,}/g, ' ')
    .trim()

  // ── Pattern 1: explicit # — "Batman #1", "Absolute Batman #019" ───────────
  const hashMatch = q.match(/#0*(\d+)/)
  if (hashMatch) {
    const issueNumber = String(parseInt(hashMatch[1], 10))
    const cleanTitle  = q.slice(0, hashMatch.index).trim()
    return { cleanTitle, issueNumber, hasIssueIntent: true, raw: query }
  }

  // ── Pattern 2: "issue" keyword — "Batman issue 5", "Batman Issue #5" ──────
  const issueKwMatch = q.match(/\bissue\s+#?0*(\d+)\b/i)
  if (issueKwMatch) {
    const issueNumber = String(parseInt(issueKwMatch[1], 10))
    const cleanTitle  = q.replace(issueKwMatch[0], '').trim()
    return { cleanTitle, issueNumber, hasIssueIntent: true, raw: query }
  }

  // ── Pattern 3: trailing bare number — "Batman 1", "Absolute Batman 19" ────
  // Require the title part to contain at least one alpha character so that
  // standalone titles like "300" or "1984" are not mis-parsed.
  const trailingNumMatch = q.match(/^(.+?)\s+0*(\d{1,4})$/)
  if (trailingNumMatch) {
    const titlePart = trailingNumMatch[1].trim()
    if (/[a-z]/i.test(titlePart)) {
      const issueNumber = String(parseInt(trailingNumMatch[2], 10))
      return { cleanTitle: titlePart, issueNumber, hasIssueIntent: true, raw: query }
    }
  }

  return { cleanTitle: q, issueNumber: '', hasIssueIntent: false, raw: query }
}

/**
 * Score a raw Comic Vine issue result against the parsed query.
 * Higher is better. Used to re-rank CV results before returning.
 */
export function scoreIssueResult(
  r: { issue_number?: string; volume?: { name?: string } },
  parsed: ParsedQuery
): number {
  let score = 0

  // ── Issue number match ────────────────────────────────────────────────────
  if (parsed.issueNumber) {
    const resultNum = String(parseInt(r.issue_number || '0', 10))
    if (resultNum === parsed.issueNumber) score += 60
  }

  // ── Title match ───────────────────────────────────────────────────────────
  const volName   = (r.volume?.name || '').toLowerCase().trim()
  const cleanLow  = parsed.cleanTitle.toLowerCase().trim()

  if (volName && cleanLow) {
    if (volName === cleanLow) {
      score += 40                                            // exact
    } else if (volName.startsWith(cleanLow) || cleanLow.startsWith(volName)) {
      score += 30                                            // prefix
    } else if (volName.includes(cleanLow) || cleanLow.includes(volName)) {
      score += 20                                            // substring
    } else {
      // Word-overlap fallback
      const words   = cleanLow.split(/\s+/).filter(w => w.length > 2)
      const matched = words.filter(w => volName.includes(w)).length
      if (words.length > 0) score += Math.round((matched / words.length) * 15)
    }
  }

  return score
}
