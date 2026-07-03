import { NextRequest, NextResponse } from 'next/server'
import { autocompleteCache }         from '@/lib/cache'
import { cvFetch }                   from '@/lib/comicvine'
import { prisma }                    from '@/lib/prisma'

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

// ── Volume discovery (CC-013) ─────────────────────────────────────────────────
// Collectors type "Saga Vol" / "Saga Vol 3" expecting individual volumes, not
// just the parent series. When the query ends with a vol/volume token, surface
// real volumes from the LOCAL catalogue (never CV — suggestions must only offer
// things our search can actually deliver).

const VOL_TITLE_RE = /\bvol(?:ume)?\.?\s*0*(\d+)\b/i

async function volumeSuggestions(q: string): Promise<Suggestion[]> {
  const m = q.match(/^(.{2,}?)\s+vol(?:ume)?\.?\s*(\d*)\s*$/i)
  if (!m) return []
  const series  = m[1].trim()
  const typedNo = m[2] // '' when the user stopped at "vol"

  try {
    const rows = await prisma.canonicalProduct.findMany({
      where: {
        deletedAt: null,
        format:    { not: 'SINGLE_ISSUE' },
        OR: [
          { seriesName: { equals: series, mode: 'insensitive' } },
          { title:      { startsWith: series, mode: 'insensitive' } },
        ],
      },
      select: { title: true, publisher: true, volumeNumber: true, seriesName: true },
      take: 60,
    })

    // Pick the best representative per volume number: exact series match beats
    // startsWith spin-offs ("Invincible" beats "Invincible Universe: Capes"),
    // then shortest title (closest to the plain main-series naming).
    const sl = series.toLowerCase()
    rows.sort((a, b) => {
      const aExact = (a.seriesName ?? '').toLowerCase() === sl ? 0 : 1
      const bExact = (b.seriesName ?? '').toLowerCase() === sl ? 0 : 1
      return aExact - bExact || a.title.length - b.title.length
    })

    // volumeNumber column is often NULL — fall back to parsing from the title.
    const byVol = new Map<number, { title: string; publisher: string | null }>()
    for (const r of rows) {
      const parsed = r.volumeNumber ?? (() => {
        const t = r.title.match(VOL_TITLE_RE)
        return t ? parseInt(t[1], 10) : null
      })()
      if (parsed === null || Number.isNaN(parsed)) continue
      if (typedNo && !String(parsed).startsWith(typedNo)) continue
      if (!byVol.has(parsed)) byVol.set(parsed, { title: r.title, publisher: r.publisher })
    }

    return [...byVol.entries()]
      .sort((a, b) => a[0] - b[0])
      .slice(0, 5)
      .map(([, v]) => ({
        id: 0, name: v.title, type: 'Volume',
        year: '', publisher: v.publisher ?? '', image: '', count: 1,
      }))
  } catch {
    return [] // DB hiccup — autocomplete degrades to series suggestions
  }
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

  // Local-catalogue volumes lead when the query carries volume intent —
  // "Saga Vol" should offer Saga Vol 1/2/3…, not just the Saga series row.
  const volumes = await volumeSuggestions(q)

  // Helper: write to cache then respond — single source of truth
  const respond = (body: { results: Suggestion[]; correction: null }) => {
    autocompleteCache.set(suggestCacheKey, body)
    return NextResponse.json(body)
  }

  if (volumes.length + curatedMatches.length >= 4) {
    return respond({ results: [...volumes, ...curatedMatches].slice(0, 8), correction: null })
  }

  // ── Supplement with Comic Vine ────────────────────────────────────────────
  const apiKey = process.env.COMIC_VINE_API_KEY
  if (!apiKey) {
    return respond({ results: [...volumes, ...curatedMatches].slice(0, 8), correction: null })
  }

  try {
    const url = `https://comicvine.gamespot.com/api/search/?api_key=${apiKey}&format=json&query=${encodeURIComponent(q)}&resources=volume&limit=10&field_list=id,name,start_year,publisher,image`
    const res  = await cvFetch(url)
    if (!res) return respond({ results: curatedMatches, correction: null })
    const data = await res.json()

    // Dedupe by normalised name against curated/volume rows AND within the CV
    // results themselves — CV returns every international edition as its own
    // volume, so a query like "saga vol" yields six identical "Saga" entries
    // that ate the suggestion slots before this pass (CC-026 'repetitious').
    const seenNames = new Set([
      ...curatedMatches.map(c => c.name.toLowerCase()),
      ...volumes.map(v => v.name.toLowerCase()),
    ])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const apiSuggestions: Suggestion[] = (data.results || [])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((r: any) => {
        const k = (r.name || '').toLowerCase().trim()
        if (!k || seenNames.has(k)) return false
        seenNames.add(k)
        return true
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((r: any) => ({
        id:        r.id,
        name:      r.name,
        type:      titleType(r.name),
        year:      r.start_year || '',
        publisher: r.publisher?.name || '',
        image:     r.image?.small_url || '',
        count:     1,
      }))

    // Prefer prefix matches from API too
    const apiPrefix    = apiSuggestions.filter(s => s.name.toLowerCase().startsWith(ql))
    const apiSubstring = apiSuggestions.filter(s => !s.name.toLowerCase().startsWith(ql))
    const apiDeduped   = [...apiPrefix, ...apiSubstring]

    const merged = [...volumes, ...curatedMatches, ...apiDeduped].slice(0, 8)
    return respond({ results: merged, correction: null })
  } catch {
    return respond({ results: [...volumes, ...curatedMatches].slice(0, 8), correction: null })
  }
}
