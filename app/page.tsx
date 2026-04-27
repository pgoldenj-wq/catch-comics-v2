'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function HomePage() {
  const [query, setQuery] = useState('')
  const [market, setMarket] = useState<'uk' | 'us'>('uk')
  const router = useRouter()

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    if (query.trim()) {
      router.push('/search?q=' + encodeURIComponent(query.trim()) + '&market=' + market)
    }
  }

  return (
    <main className="min-h-screen bg-white flex flex-col items-center justify-center px-4">

      <div className="mb-8 text-center">
        <img
          src="/logo.png"
          alt="Catch Comics"
          className="h-16 md:h-20 w-auto"
        />
      </div>

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

        <div className="flex items-center justify-center gap-3 mt-4">
          <p className="text-sm text-[#6B7280]">Show prices for:</p>
          <button
            type="button"
            onClick={() => setMarket('uk')}
            className={'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all border-2 ' + (market === 'uk' ? 'border-[#E8272A] text-[#E8272A] bg-white' : 'border-[#E5E7EB] text-[#6B7280] bg-white hover:border-[#E8272A] hover:text-[#E8272A]')}
          >
            <img src="https://flagcdn.com/w40/gb.png" alt="UK" className="w-7 h-auto rounded-sm" />
            UK
          </button>
          <button
            type="button"
            onClick={() => setMarket('us')}
            className={'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all border-2 ' + (market === 'us' ? 'border-[#E8272A] text-[#E8272A] bg-white' : 'border-[#E5E7EB] text-[#6B7280] bg-white hover:border-[#E8272A] hover:text-[#E8272A]')}
          >
            <img src="https://flagcdn.com/w40/us.png" alt="US" className="w-7 h-auto rounded-sm" />
            US
          </button>
        </div>

        <p className="mt-3 text-center text-sm text-[#6B7280]">
          Find the lowest price instantly — new and used, all in one place
        </p>
      </form>

    </main>
  )
}