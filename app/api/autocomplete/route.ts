import { NextRequest, NextResponse } from 'next/server'
import { autocompleteCache }         from '@/lib/cache'
import { cvFetch }                   from '@/lib/comicvine'

// ── Curated dictionary ────────────────────────────────────────────────────────

const MANGA_TITLES = new Set([
  'One Piece', 'Naruto', 'Dragon Ball', 'Dragon Ball Z',
  'Bleach', 'Attack on Titan', 'Demon Slayer',
  'Jujutsu Kaisen', 'Chainsaw Man', 'My Hero Academia',
  'Fullmetal Alchemist', 'Death Note', 'Berserk',
  'Vinland Saga', 'Tokyo Ghoul', 'Hunter x Hunter',
  'One Punch Man', 'Spy x Family', 'Dungeon Meshi',
  'Blue Period', 'Vagabond', 'Slam Dunk',
  'Akira', 'Ghost in the Shell', 'Neon Genesis Evangelion',
  'Cowboy Bebop', 'Inuyasha', 'Rurouni Kenshin',
])

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
  'Ghost World',
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

// ── Levenshtein for spell correction ─────────────────────────────────────────

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

function findSpellingCorrection(query: string): string | null {
  const ql = query.toLowerCase().trim()
  if (ql.length < 3) return null

  let bestMatch: string | null = null
  let bestScore = Infinity

  for (const comic of COMICS) {
    const cl = comic.toLowerCase()
    if (cl.includes(ql) || ql.includes(cl)) continue
    const dist = levenshtein(ql, cl)
    const threshold = Math.max(3, Math.floor(ql.length * 0.4))
    if (dist < bestScore && dist <= threshold) {
      bestScore = dist
      bestMatch = comic
    }
  }

  return bestMatch
}

// ── Autocomplete suggestion builder ──────────────────────────────────────────

interface Suggestion {
  id: number
  name: string
  type: string    // "Manga" | "Series"
  year: string
  publisher: string
  image: string
  count: number
}

function titleType(name: string): string {
  return MANGA_TITLES.has(name) ? 'Manga' : 'Series'
}

export async function GET(req: NextRequest) {
  const q    = req.nextUrl.searchParams.get('q') || ''
  const mode = req.nextUrl.searchParams.get('mode') || 'suggest'

  if (q.length < 2) return NextResponse.json({ results: [], correction: null })

  const ql = q.toLowerCase()

  // ── Spelling correction mode ──────────────────────────────────────────────
  if (mode === 'correct') {
    const cacheKey = `correct:${ql}`
    const cached   = autocompleteCache.get(cacheKey)
    if (cached) return NextResponse.json(cached)
    const correction = findSpellingCorrection(q)
    const body = { correction }
    autocompleteCache.set(cacheKey, body)
    return NextResponse.json(body)
  }

  // ── Autocomplete cache check ──────────────────────────────────────────────
  const suggestCacheKey = `suggest:${ql}`
  const cachedSuggest   = autocompleteCache.get(suggestCacheKey)
  if (cachedSuggest) return NextResponse.json(cachedSuggest)

  // ── Autocomplete mode ─────────────────────────────────────────────────────
  // Separate prefix matches from substring matches so prefix comes first.
  const prefixMatches: Suggestion[] = []
  const substringMatches: Suggestion[] = []
  const seenCurated = new Set<string>()

  for (const title of COMICS) {
    const tl = title.toLowerCase()
    if (!tl.includes(ql)) continue
    if (seenCurated.has(title)) continue
    seenCurated.add(title)

    const suggestion: Suggestion = {
      id: 0, name: title, type: titleType(title),
      year: '', publisher: '', image: '', count: 1,
    }
    if (tl.startsWith(ql)) prefixMatches.push(suggestion)
    else substringMatches.push(suggestion)
  }

  const curatedMatches = [...prefixMatches, ...substringMatches].slice(0, 6)

  // Helper: write to cache then respond — single source of truth
  const respond = (body: { results: Suggestion[]; correction: null }) => {
    autocompleteCache.set(suggestCacheKey, body)
    return NextResponse.json(body)
  }

  if (curatedMatches.length >= 4) {
    return respond({ results: curatedMatches, correction: null })
  }

  // ── Supplement with Comic Vine ────────────────────────────────────────────
  const apiKey = process.env.COMIC_VINE_API_KEY
  if (!apiKey) {
    return respond({ results: curatedMatches, correction: null })
  }

  try {
    const url = `https://comicvine.gamespot.com/api/search/?api_key=${apiKey}&format=json&query=${encodeURIComponent(q)}&resources=volume&limit=10&field_list=id,name,start_year,publisher,image`
    const res  = await cvFetch(url)
    if (!res) return respond({ results: curatedMatches, correction: null })
    const data = await res.json()

    const curatedNames = new Set(curatedMatches.map(c => c.name.toLowerCase()))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const apiSuggestions: Suggestion[] = (data.results || []).map((r: any) => ({
      id:        r.id,
      name:      r.name,
      type:      titleType(r.name),
      year:      r.start_year || '',
      publisher: r.publisher?.name || '',
      image:     r.image?.small_url || '',
      count:     1,
    }))

    // Deduplicate against curated; prefer prefix matches from API too
    const apiPrefix    = apiSuggestions.filter(s => s.name.toLowerCase().startsWith(ql) && !curatedNames.has(s.name.toLowerCase()))
    const apiSubstring = apiSuggestions.filter(s => !s.name.toLowerCase().startsWith(ql) && !curatedNames.has(s.name.toLowerCase()))
    const apiDeduped   = [...apiPrefix, ...apiSubstring]

    const merged = [...curatedMatches, ...apiDeduped].slice(0, 8)
    return respond({ results: merged, correction: null })
  } catch {
    return respond({ results: curatedMatches, correction: null })
  }
}
