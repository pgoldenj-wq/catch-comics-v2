import { NextRequest, NextResponse } from 'next/server'

// Full curated comic dictionary — used for both autocomplete AND spell correction
const COMICS: string[] = [
  // Batman
  'Batman', 'Batman Year One', 'Batman The Long Halloween',
  'Batman Knightfall', 'Batman No Man\'s Land', 'Batman Hush',
  'Batman Court of Owls', 'Batman Dark Knight Returns',
  'Batman Killing Joke', 'Batman Arkham Asylum',
  'Batman Zero Year', 'Batman Dark Victory',
  'Batman Cataclysm', 'Batman Contagion',
  // Superman
  'Superman', 'Superman Red Son', 'All-Star Superman',
  'Superman For All Seasons', 'Superman Birthright',
  // Wonder Woman
  'Wonder Woman', 'Wonder Woman Year One',
  'Wonder Woman Historia', 'Wonder Woman Earth One',
  // Supergirl
  'Supergirl', 'Supergirl Woman of Tomorrow', 'Supergirl Cosmic Adventures',
  // Spider-Man
  'Amazing Spider-Man', 'Ultimate Spider-Man',
  'Spider-Man Kraven\'s Last Hunt', 'Spider-Man Blue',
  'Spider-Man Life Story', 'Miles Morales Spider-Man',
  // X-Men
  'X-Men', 'X-Men Dark Phoenix Saga', 'X-Men Days of Future Past',
  'Uncanny X-Men', 'New X-Men', 'X-Force', 'X-Factor',
  // Other Marvel
  'Avengers', 'Iron Man', 'Thor', 'Captain America',
  'Daredevil Born Again', 'Punisher MAX', 'Hawkeye',
  'Ms Marvel', 'Black Panther', 'Moon Knight',
  'Fantastic Four', 'Silver Surfer', 'Wolverine',
  'Deadpool', 'She-Hulk',
  // DC other
  'Flash', 'Green Lantern', 'Aquaman',
  'Swamp Thing', 'Animal Man', 'Doom Patrol',
  'Justice League', 'Teen Titans',
  // Vertigo / Mature
  'Watchmen', 'V for Vendetta', 'The Sandman',
  'Preacher', 'Transmetropolitan', 'Y The Last Man',
  'Fables', 'Lucifer', 'Hellblazer', 'Invisibles',
  '100 Bullets', 'Scalped', 'DMZ',
  // Image / Indie
  'Saga', 'Invincible', 'The Boys',
  'Walking Dead', 'Spawn', 'Witchblade',
  'East of West', 'Low', 'Black Science',
  'Paper Girls', 'Monstress', 'Lazarus',
  // Dark Horse
  'Hellboy', 'BPRD', 'Sin City', '300',
  'From Hell', 'Aliens', 'Predator',
  // Other
  'Bone', 'Maus', 'Persepolis',
  'League of Extraordinary Gentlemen',
  'From Hell', 'Ghost World',
  // Manga
  'One Piece', 'Naruto', 'Dragon Ball', 'Dragon Ball Z',
  'Bleach', 'Attack on Titan', 'Demon Slayer',
  'Jujutsu Kaisen', 'Chainsaw Man', 'My Hero Academia',
  'Fullmetal Alchemist', 'Death Note', 'Berserk',
  'Vinland Saga', 'Tokyo Ghoul', 'Hunter x Hunter',
  'One Punch Man', 'Spy x Family', 'Dungeon Meshi',
  'Blue Period', 'Vagabond', 'Slam Dunk',
  'Akira', 'Ghost in the Shell', 'Neon Genesis Evangelion',
  'Cowboy Bebop', 'Inuyasha', 'Rurouni Kenshin',
]

// Simple Levenshtein distance for spell correction
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0)
  )
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1])
    }
  }
  return dp[m][n]
}

// Find best comic-aware spelling correction
function findSpellingCorrection(query: string): string | null {
  const ql = query.toLowerCase().trim()
  if (ql.length < 3) return null

  let bestMatch: string | null = null
  let bestScore = Infinity

  for (const comic of COMICS) {
    const cl = comic.toLowerCase()
    // Exact substring — no correction needed
    if (cl.includes(ql) || ql.includes(cl)) continue

    const dist = levenshtein(ql, cl)
    // Allow up to ~20% error rate relative to query length
    const threshold = Math.max(3, Math.floor(ql.length * 0.4))
    if (dist < bestScore && dist <= threshold) {
      bestScore = dist
      bestMatch = comic
    }
  }

  return bestMatch
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q') || ''
  const mode = req.nextUrl.searchParams.get('mode') || 'suggest' // 'suggest' | 'correct'

  if (q.length < 2) return NextResponse.json({ results: [], correction: null })

  const ql = q.toLowerCase()

  // Spelling correction mode — return best comic match for "did you mean"
  if (mode === 'correct') {
    const correction = findSpellingCorrection(q)
    return NextResponse.json({ correction })
  }

  // Autocomplete mode — curated matches first
  const curatedMatches = COMICS
    .filter(title => title.toLowerCase().includes(ql))
    .slice(0, 6)
    .map(title => ({ id: 0, name: title, year: '', publisher: '', image: '', count: 1 }))

  if (curatedMatches.length >= 4) {
    return NextResponse.json({ results: curatedMatches, correction: null })
  }

  // Supplement with Comic Vine
  const apiKey = process.env.COMIC_VINE_API_KEY
  try {
    const url = `https://comicvine.gamespot.com/api/search/?api_key=${apiKey}&format=json&query=${encodeURIComponent(q)}&resources=volume&limit=8&field_list=id,name,start_year,publisher,image`
    const res = await fetch(url, { headers: { 'User-Agent': 'CatchComics/1.0' } })
    const data = await res.json()
    const apiResults = (data.results || []).map((r: any) => ({
      id: r.id, name: r.name, year: r.start_year,
      publisher: r.publisher?.name || '', image: r.image?.small_url || '', count: 1,
    }))
    const curatedNames = new Set(curatedMatches.map(c => c.name.toLowerCase()))
    const merged = [
      ...curatedMatches,
      ...apiResults.filter((r: {name: string}) => !curatedNames.has(r.name.toLowerCase()))
    ].slice(0, 6)
    return NextResponse.json({ results: merged, correction: null })
  } catch {
    return NextResponse.json({ results: curatedMatches, correction: null })
  }
}