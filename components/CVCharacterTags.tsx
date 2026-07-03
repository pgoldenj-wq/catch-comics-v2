'use client'

/**
 * CVCharacterTags — fetches character data from the live Comic Vine API
 * (via /api/comic/[id]) and renders clickable pill tags for each character.
 *
 * Only mounts when a comicvineId is available on the canonical product.
 * Renders nothing if CV returns no characters or the fetch fails.
 */

import { useState, useEffect } from 'react'

interface Props {
  comicvineId: string
  /** Switch chip styling for placement on the dark hero band. */
  darkBg?:     boolean
  /** Render the full labeled hero row (dt/dd) around the chips. The row only
      exists when characters resolve — no orphaned "Character Tags:" label on
      issues without character data. Markup mirrors LabeledRow on the product page. */
  withRow?:    boolean
}

export default function CVCharacterTags({ comicvineId, darkBg = false, withRow = false }: Props) {
  const [chars, setChars] = useState<Array<{ id: number; name: string }> | null>(null)

  useEffect(() => {
    fetch(`/api/comic/${comicvineId}`)
      .then(r => r.json())
      .then(data => {
        const characters = data.comic?.characters
        setChars(Array.isArray(characters) ? characters : [])
      })
      .catch(() => setChars([]))
  }, [comicvineId])

  if (!chars || chars.length === 0) return null

  const VISIBLE  = 8
  const visible  = chars.slice(0, VISIBLE)

  // Two style sets — light-bg (default) for the white sections, dark-bg for
  // the hero band where the labeled row presents chips on a near-black panel.
  const chipCls = darkBg
    ? 'inline-block text-xs font-medium px-2.5 py-1 rounded-full bg-white/10 text-white/85 hover:bg-white/20 hover:text-white transition-colors'
    : 'inline-block text-xs font-medium px-2.5 py-1 rounded-full bg-gray-100 text-gray-600 hover:bg-[#E8272A]/10 hover:text-[#E8272A] transition-colors'
  const wrapCls = darkBg ? 'flex flex-wrap gap-1.5' : 'flex flex-wrap gap-1.5 mt-3'

  const chips = (
    <div className={wrapCls}>
      {visible.map(c => (
        <a
          key={c.id}
          href={`/search?q=${encodeURIComponent(c.name)}`}
          className={chipCls}
        >
          {c.name}
        </a>
      ))}
    </div>
  )

  if (!withRow) return chips

  return (
    <div className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-3">
      <dt className="text-white font-bold text-sm sm:w-[120px] sm:flex-shrink-0">
        Character Tags:
      </dt>
      <dd className="text-white/85 text-sm min-w-0 flex-1">
        {chips}
      </dd>
    </div>
  )
}
