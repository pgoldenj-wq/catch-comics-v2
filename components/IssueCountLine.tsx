'use client'

/**
 * IssueCountLine — renders "N issues in this series" in the hero block of a
 * collected-edition product page. Co-exists with CVIssuesGrid; both hit
 * the same KV-cached CV endpoints so the duplicate fetch is effectively
 * free.
 *
 * The count is the CV volume's TOTAL issue count — the ongoing series, not
 * the contents of this collected edition. The old "Collects N issues" label
 * overstated the data (CC-028: Absolute Batman Vol 1 claimed "Collects 21
 * issues" when the hardcover collects ~6). Wrong data is worse than missing
 * data — the label now says exactly what the number is.
 *
 * Why a separate component rather than wiring CVIssuesGrid's onLoaded
 * callback back up to the hero: the product page is a server component
 * and can't hold the useState that the callback would need to update.
 * This client island fetches the count itself.
 */

import { useState, useEffect } from 'react'

interface Props {
  /** CV volume id from the DB (or cv_metadata.cv_volume_id for SINGLE_ISSUE). */
  comicvineId: string | null
  /** Fallback search term when comicvineId is null. */
  searchTitle: string | null
  /** Only render on collected editions. Single-issue pages pass false. */
  enabled:     boolean
  /** Tailwind className for the wrapper. Default suits a light bg; pass
   *  a dark-bg variant like "text-white/70" for the new dark hero. */
  className?:  string
}

export default function IssueCountLine({ comicvineId, searchTitle, enabled, className }: Props) {
  const [count, setCount] = useState<number | null>(null)

  useEffect(() => {
    if (!enabled) return
    if (!comicvineId && !searchTitle) return

    let cancelled = false
    async function load() {
      // Mirror CVIssuesGrid's resolution order: comicvineId direct → fallback
      // to /api/comic/search if missing.
      let volumeId: string | null = comicvineId ?? null

      if (!volumeId && searchTitle) {
        try {
          const r = await fetch(`/api/comic/search?q=${encodeURIComponent(searchTitle)}`)
          if (r.ok) {
            const data = await r.json() as { volumeId: string | null }
            volumeId = data.volumeId ?? null
          }
        } catch { /* silent */ }
      }
      if (!volumeId || cancelled) return

      try {
        const r = await fetch(`/api/comic/${volumeId}/issues`)
        if (!r.ok || cancelled) return
        const data = await r.json() as { issues?: unknown[] }
        const c = Array.isArray(data.issues) ? data.issues.length : 0
        if (!cancelled && c > 0) setCount(c)
      } catch { /* silent */ }
    }
    load()
    return () => { cancelled = true }
  }, [comicvineId, searchTitle, enabled])

  if (!enabled || count === null) return null
  return (
    <p className={className ?? 'text-[13px] text-gray-500 mt-2'}>
      {count} issue{count === 1 ? '' : 's'} in this series
    </p>
  )
}
