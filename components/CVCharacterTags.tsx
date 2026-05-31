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
}

export default function CVCharacterTags({ comicvineId, darkBg = false }: Props) {
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
  const overflow = chars.length - VISIBLE

  // Two style sets — light-bg (default) for the white sections, dark-bg for
  // the hero band where the labeled row presents chips on a near-black panel.
  const chipCls = darkBg
    ? 'inline-block text-xs font-medium px-2.5 py-1 rounded-full bg-white/10 text-white/85 hover:bg-white/20 hover:text-white transition-colors'
    : 'inline-block text-xs font-medium px-2.5 py-1 rounded-full bg-gray-100 text-gray-600 hover:bg-[#E8272A]/10 hover:text-[#E8272A] transition-colors'
  const moreCls = darkBg ? 'text-xs text-white/40 self-center' : 'text-xs text-gray-400 self-center'
  const wrapCls = darkBg ? 'flex flex-wrap gap-1.5' : 'flex flex-wrap gap-1.5 mt-3'

  return (
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
      {overflow > 0 && (
        <span className={moreCls}>+{overflow} more</span>
      )}
    </div>
  )
}
