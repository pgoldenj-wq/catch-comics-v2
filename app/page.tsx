'use client'

import type { Metadata } from 'next'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function HomePage() {
  const [query, setQuery] = useState('')
  const router = useRouter()

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    if (query.trim()) {
      router.push(`/search?q=${encodeURIComponent(query.trim())}`)
    }
  }

  return (
    <main className="min-h-screen bg-white flex flex-col items-center justify-center px-4">
      
      {/* Logo */}
      <div className="mb-8 text-center">
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight">
          <span className="text-[#E8272A]">Catch</span>
          <span className="text-[#0A0A0A]"> Comics</span>
        </h1>
      </div>

      {/* Search Form */}
      <form onSubmit={handleSearch} className="w-full max-w-2xl">
        <div className="relative flex items-center">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search any comic, graphic novel or manga..."
            className="w-full h-14 px-6 pr-14 text-base text-[#0A0A0A] bg-white border border-[#E5E7EB] rounded-2xl shadow-sm focus:outline-none focus:border-[#E8272A] focus:ring-2 focus:ring-[#E8272A]/10 transition-all placeholder:text-[#6B7280]"
            autoFocus
          />
          {/* Search Button */}
          <button
            type="submit"
            className="absolute right-2 flex items-center justify-center w-10 h-10 bg-[#E8272A] rounded-xl hover:bg-[#c41f22] transition-colors"
            aria-label="Search"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="w-5 h-5 text-white"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z"
              />
            </svg>
          </button>
        </div>

        {/* Tagline */}
        <p className="mt-4 text-center text-sm text-[#6B7280]">
          Find the lowest price instantly — new and used, all in one place
        </p>
      </form>

    </main>
  )
}