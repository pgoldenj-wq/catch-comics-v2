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
}

export default function CVCharacterTags({ comicvineId }: Props) {
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

  // Still loading or empty
  if (!chars || chars.length === 0) return null

  const VISIBLE  = 8
  const visible  = chars.slice(0, VISIBLE)
  const overflow = chars.length - VISIBLE

  return (
    <div className="flex flex-wrap gap-1.5 mt-3">
      {visible.map(c => (
        <a
          key={c.id}
          href={`/search?q=${encodeURIComponent(c.name)}`}
          className="inline-block text-xs font-medium px-2.5 py-1 rounded-full bg-gray-100 text-gray-600 hover:bg-[#E8272A]/10 hover:text-[#E8272A] transition-colors"
        >
          {c.name}
        </a>
      ))}
      {overflow > 0 && (
        <span className="text-xs text-gray-400 self-center">+{overflow} more</span>
      )}
    </div>
  )
}
